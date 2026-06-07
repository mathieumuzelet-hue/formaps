'use client'

import { useCallback, useRef, useState } from 'react'

import { splitSSEFrames } from '@/lib/brain/useBrainChat'
import { parseSSELines } from '@/lib/dify/parse'
import { parseEmbedTestEvent } from '@/lib/embed-test/parse'
import type {
  ChunkConfig,
  ConfigResult,
  EmbedTestEvent,
  EmbedTestModelKey,
  EmbedTestReport,
  OcrVerdict,
  RefinePayload,
  TestedConfig,
  TextDiagnostic,
} from '@/lib/embed-test/types'

export type EmbedTestStatus = 'idle' | 'running' | 'done' | 'error'

/** Cross-round winner — config, its score, the round that produced it, and the OCR verdict to reuse. */
export type BestSoFar = {
  config: ChunkConfig
  score: number
  rationale: string
  round: number
  ocr: OcrVerdict
}

export type EmbedTestState = {
  status: EmbedTestStatus
  steps: Array<{ id: string; label: string }>
  configs: ChunkConfig[]
  results: ConfigResult[]
  report: EmbedTestReport | null
  error: string | null
  diagnostic: TextDiagnostic | null
  round: number
  history: TestedConfig[]
  bestSoFar: BestSoFar | null
}

export const initialState: EmbedTestState = {
  status: 'idle',
  steps: [],
  configs: [],
  results: [],
  report: null,
  error: null,
  diagnostic: null,
  round: 0,
  history: [],
  bestSoFar: null,
}

/** Pure reducer — the streaming loop is built on it (same pattern as reduceFrame). */
export function applyEvent(state: EmbedTestState, event: EmbedTestEvent): EmbedTestState {
  switch (event.type) {
    case 'step':
      return { ...state, steps: [...state.steps, { id: event.id, label: event.label }] }
    case 'configs':
      return { ...state, configs: event.items }
    case 'config-result':
      return { ...state, results: [...state.results, event.result] }
    case 'diagnostic':
      return { ...state, diagnostic: event.diagnostic }
    case 'report': {
      const tested: TestedConfig[] = state.results.flatMap((r) => {
        const cfg = state.configs[r.index]
        if (!cfg) return []
        return [
          {
            config: cfg,
            score: r.score,
            issues: r.issues,
            ...(r.failed ? { failed: true as const } : {}),
            round: state.round,
          },
        ]
      })
      const bestIdx = event.report.recommendation.configIndex
      const bestResult = state.results.find((r) => r.index === bestIdx)
      const bestConfig = state.configs[bestIdx]
      const candidate =
        bestConfig && bestResult
          ? {
              config: bestConfig,
              score: bestResult.score,
              rationale: event.report.recommendation.rationale,
              round: state.round,
              ocr: event.report.ocr,
            }
          : null
      const bestSoFar =
        candidate && (!state.bestSoFar || candidate.score > state.bestSoFar.score)
          ? candidate
          : state.bestSoFar
      return {
        ...state,
        report: event.report,
        status: 'done',
        history: [...state.history, ...tested],
        bestSoFar,
      }
    }
    case 'error':
      return { ...state, status: 'error', error: event.message }
  }
}

/** Refine payload for the next round — null until a report exists. */
export function buildRefinePayload(state: EmbedTestState): RefinePayload | null {
  if (!state.report || state.history.length === 0) return null
  return { ocr: state.report.ocr, tested: state.history.slice(-30) }
}

/**
 * Refine payload carrying ONE admin-supplied config — the pipeline judges only
 * this config and skips the propose step. Null until a report exists.
 */
export function buildManualPayload(
  state: EmbedTestState,
  config: ChunkConfig,
): RefinePayload | null {
  const base = buildRefinePayload(state)
  return base ? { ...base, manual: config } : null
}

/** French messages for HTTP-level failures (before the SSE stream starts). */
export function httpErrorText(status: number): string {
  switch (status) {
    case 400:
      return 'Requête invalide — vérifiez le fichier et le modèle.'
    case 401:
    case 403:
      return 'Accès refusé — réservé aux admin.'
    case 413:
      return 'Fichier trop volumineux (25 Mo max).'
    case 415:
      return 'Seuls les PDF sont acceptés.'
    case 503:
      return "Clé API Anthropic non configurée sur le serveur."
    default:
      return 'Le test a échoué. Réessayez.'
  }
}

export type UseEmbedTest = {
  state: EmbedTestState
  run: (file: File, model: EmbedTestModelKey, refine?: RefinePayload) => Promise<void>
  reset: () => void
}

export function useEmbedTest(): UseEmbedTest {
  const [state, setState] = useState<EmbedTestState>(initialState)
  const runningRef = useRef(false)

  const reset = useCallback(() => {
    if (runningRef.current) return
    setState(initialState)
  }, [])

  const run = useCallback(
    async (file: File, model: EmbedTestModelKey, refine?: RefinePayload) => {
    if (runningRef.current) return
    runningRef.current = true
    setState((prev) => ({
      ...initialState,
      status: 'running',
      round: prev.round + 1,
      history: prev.history,
      bestSoFar: prev.bestSoFar,
    }))

    const fail = (message: string) =>
      setState((prev) => ({ ...prev, status: 'error', error: message }))

    try {
      const form = new FormData()
      form.set('file', file)
      form.set('model', model)
      if (refine) form.set('refine', JSON.stringify(refine))
      const res = await fetch('/api/admin/embed-test', { method: 'POST', body: form })
      if (!res.ok || !res.body) {
        fail(httpErrorText(res.status))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const handleFrame = (frame: string) => {
        for (const payload of parseSSELines(frame)) {
          const event = parseEmbedTestEvent(payload)
          if (event) setState((prev) => applyEvent(prev, event))
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = splitSSEFrames(buffer)
        buffer = rest
        frames.forEach(handleFrame)
      }
      buffer += decoder.decode()
      if (buffer.trim().length > 0) handleFrame(buffer)

      // Stream ended without report nor error event → treat as failure.
      setState((prev) =>
        prev.status === 'running'
          ? { ...prev, status: 'error', error: 'Flux interrompu. Réessayez.' }
          : prev,
      )
    } catch {
      fail('Connexion interrompue. Réessayez.')
    } finally {
      runningRef.current = false
    }
    },
    [],
  )

  return { state, run, reset }
}
