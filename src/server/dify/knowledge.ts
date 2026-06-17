/**
 * Server-only Dify KNOWLEDGE (dataset) API client. Distinct de l'App API
 * (client.ts) : clé dataset séparée. fetchImpl est injectable pour les tests.
 */
import type { DifyQaSegment } from '@/lib/dify/faq-segments'

export const KNOWLEDGE_TIMEOUT_MS = 30_000

export class DifyKnowledgeError extends Error {
  constructor(public status: number, public body: string) {
    super(`Dify knowledge API failed: ${status}`)
    this.name = 'DifyKnowledgeError'
  }
}

/** Resolves base URL (no trailing slash/v1) + dataset key. Throws if unset. */
export function knowledgeConfig(): { base: string; datasetKey: string } {
  const apiUrl = process.env.DIFY_API_URL
  const datasetKey = process.env.DIFY_DATASET_API_KEY
  if (!apiUrl || !datasetKey) {
    throw new Error('DIFY_API_URL and DIFY_DATASET_API_KEY must be set')
  }
  const base = apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return { base, datasetKey }
}

async function postJson(
  url: string,
  datasetKey: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: 'POST',
    signal: AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${datasetKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new DifyKnowledgeError(res.status, await res.text().catch(() => ''))
  return res.json().catch(() => ({}))
}

/**
 * Crée un document Q&A dans le dataset puis y ajoute les segments Q/R.
 * Le document est créé via create-by-text (texte placeholder minimal) en mode
 * Q&A, puis les paires exactes sont posées via l'API segments.
 */
export async function createQaDocument(args: {
  datasetId: string
  name: string
  segments: DifyQaSegment[]
  fetchImpl?: typeof fetch
}): Promise<{ documentId: string }> {
  const { datasetId, name, segments } = args
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()

  const created = (await postJson(
    `${base}/v1/datasets/${datasetId}/document/create-by-text`,
    datasetKey,
    {
      name,
      text: name,
      indexing_technique: 'high_quality',
      doc_form: 'qa_model',
      process_rule: { mode: 'automatic' },
    },
    fetchImpl,
  )) as { document?: { id?: string } }
  const documentId = created.document?.id
  if (!documentId) throw new DifyKnowledgeError(200, 'create-by-text: missing document id')

  await postJson(
    `${base}/v1/datasets/${datasetId}/documents/${documentId}/segments`,
    datasetKey,
    { segments },
    fetchImpl,
  )
  return { documentId }
}

export async function deleteDocument(args: {
  datasetId: string
  documentId: string
  fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  const res = await fetchImpl(`${base}/v1/datasets/${args.datasetId}/documents/${args.documentId}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${datasetKey}` },
  })
  if (!res.ok) throw new DifyKnowledgeError(res.status, await res.text().catch(() => ''))
}
