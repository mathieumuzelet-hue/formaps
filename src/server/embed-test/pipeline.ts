/**
 * Orchestrates one embed-test run. Emits typed SSE events via the `emit`
 * callback; never throws for per-config failures (config marked failed, run
 * continues). Extraction/analysis failures are fatal (error event, stop).
 */
import { chunkDocument, type Chunk } from '@/lib/embed-test/chunker'
import {
  analyzePagesStructure,
  diagnosticPromptSummary,
} from '@/lib/embed-test/diagnostics'
import { formatDifySettings } from '@/lib/embed-test/dify-settings'
import type {
  ConfigResult,
  EmbedTestEvent,
  EmbedTestModelKey,
  OcrVerdict,
  RefinePayload,
} from '@/lib/embed-test/types'
import {
  createAnthropicClient,
  EMBED_TEST_MODELS,
  judgeConfig,
  ocrCompare,
  proposeConfigs,
  type Usage,
} from '@/server/embed-test/claude'
import {
  buildPdfSample,
  extractPages,
  PdfUnreadableError,
  samplePageIndices,
} from '@/server/embed-test/extract'

// Cost guardrails (spec §3)
const MAX_VISION_PAGES = 5
const MAX_ANALYSIS_CHARS = 80_000
const MAX_JUDGED_CHUNKS = 15

/** First/middle/last sampling so the judge sees the whole document's shape. */
export function sampleChunks(chunks: Chunk[], max = MAX_JUDGED_CHUNKS): Chunk[] {
  if (chunks.length <= max) return chunks
  const third = Math.floor(max / 3)
  const head = chunks.slice(0, third)
  const midStart = Math.floor(chunks.length / 2 - third / 2)
  const middle = chunks.slice(midStart, midStart + third)
  const tail = chunks.slice(chunks.length - (max - 2 * third))
  return [...head, ...middle, ...tail]
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export async function runEmbedTest(
  buffer: Uint8Array,
  modelKey: EmbedTestModelKey,
  emit: (event: EmbedTestEvent) => void,
  refine?: RefinePayload,
): Promise<void> {
  const model = EMBED_TEST_MODELS[modelKey]
  const client = createAnthropicClient()
  const total: Usage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: Usage) => {
    total.inputTokens += u.inputTokens
    total.outputTokens += u.outputTokens
  }

  // 1. Native text extraction
  emit({ type: 'step', id: 'extract', label: 'Extraction du texte du PDF…' })
  let pages: string[]
  let totalPages: number
  try {
    const extracted = await extractPages(buffer)
    pages = extracted.pages
    totalPages = extracted.totalPages
  } catch (err) {
    emit({
      type: 'error',
      code: err instanceof PdfUnreadableError ? 'pdf_unreadable' : 'extract_failed',
      message: 'PDF illisible — protégé, corrompu ou non valide.',
    })
    return
  }
  const fullText = pages.join('\n\n')

  // 1b. Deterministic structure diagnostic (emitted on every run)
  const diagnostic = analyzePagesStructure(pages)
  emit({ type: 'diagnostic', diagnostic })

  // 2. OCR verdict on sampled pages (vision vs native text layer).
  // On a refine run the verdict from the previous round is reused (no vision call).
  let ocr: OcrVerdict
  if (refine) {
    emit({ type: 'step', id: 'ocr', label: 'Verdict OCR réutilisé (tour précédent)' })
    ocr = refine.ocr
  } else {
    emit({ type: 'step', id: 'ocr', label: 'Comparaison OCR vs extraction texte…' })
    const indices = samplePageIndices(totalPages, MAX_VISION_PAGES)
    try {
      const samplePdf = await buildPdfSample(buffer, indices)
      const nativeSample = indices.map((i) => pages[i] ?? '').join('\n\n--- PAGE ---\n\n')
      const res = await ocrCompare(client, model, toBase64(samplePdf), nativeSample)
      add(res.usage)
      ocr = res.data
    } catch (err) {
      console.error('[embed-test] OCR compare a échoué:', err)
      if (err instanceof PdfUnreadableError) {
        // buildPdfSample (pdf-lib) can fail on PDFs unpdf could still read
        // (e.g. encrypted) — report as unreadable, not as a Claude API failure.
        emit({
          type: 'error',
          code: 'pdf_unreadable',
          message: 'PDF illisible — protégé, corrompu ou non valide.',
        })
        return
      }
      emit({
        type: 'error',
        code: 'ocr_compare_failed',
        message: "L'analyse OCR via l'API Claude a échoué. Réessayez.",
      })
      return
    }
  }

  // 3. Claude proposes configs from document structure
  emit({
    type: 'step',
    id: 'propose',
    label: 'Claude analyse la structure et propose des configurations…',
  })
  let configs
  try {
    const res = await proposeConfigs(
      client,
      model,
      fullText.slice(0, MAX_ANALYSIS_CHARS),
      { totalPages, totalChars: fullText.length },
      { diagnosticSummary: diagnosticPromptSummary(diagnostic), tested: refine?.tested },
    )
    add(res.usage)
    configs = res.data
  } catch (err) {
    console.error('[embed-test] proposeConfigs a échoué:', err)
    emit({
      type: 'error',
      code: 'propose_failed',
      message: "La proposition de configurations via l'API Claude a échoué. Réessayez.",
    })
    return
  }
  emit({ type: 'configs', items: configs })

  // 4. Local chunking + judge, sequential, failures non-fatal
  const results: ConfigResult[] = []
  for (let i = 0; i < configs.length; i++) {
    emit({
      type: 'step',
      id: `judge:${i}`,
      label: `Jugement de la config ${i + 1}/${configs.length}…`,
    })
    const chunks = chunkDocument(fullText, configs[i])
    let result: ConfigResult
    if (chunks.length === 0) {
      // Nothing to judge (e.g. scanned PDF with an empty text layer) — skip
      // the Claude call entirely instead of judging an empty rendering.
      result = {
        index: i,
        score: 0,
        issues: [],
        summary: 'Aucun chunk produit (texte vide ?)',
        chunkCount: 0,
        failed: true,
      }
      results.push(result)
      emit({ type: 'config-result', result })
      continue
    }
    try {
      const res = await judgeConfig(client, model, configs[i].label, sampleChunks(chunks))
      add(res.usage)
      result = { index: i, ...res.data, chunkCount: chunks.length }
    } catch (err) {
      console.error(`[embed-test] judgeConfig ${i + 1}/${configs.length} a échoué:`, err)
      result = {
        index: i,
        score: 0,
        issues: [],
        summary: 'Échec du jugement (API)',
        chunkCount: chunks.length,
        failed: true,
      }
    }
    results.push(result)
    emit({ type: 'config-result', result })
  }

  // 5. Report
  emit({ type: 'step', id: 'report', label: 'Construction du rapport…' })
  const ranked = results
    .filter((r) => !r.failed)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.index)
  if (ranked.length === 0) {
    emit({
      type: 'error',
      code: 'all_judges_failed',
      message: "Aucune configuration n'a pu être jugée. Réessayez.",
    })
    return
  }
  const bestIndex = ranked[0]
  emit({
    type: 'report',
    report: {
      ocr,
      ranking: ranked,
      recommendation: {
        configIndex: bestIndex,
        difySettings: formatDifySettings(configs[bestIndex], ocr),
        rationale: results.find((r) => r.index === bestIndex)?.summary ?? '',
      },
      usage: total,
    },
  })
}
