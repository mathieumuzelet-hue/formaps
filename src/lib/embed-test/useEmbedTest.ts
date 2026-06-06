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
} from '@/lib/embed-test/types'

export type EmbedTestStatus = 'idle' | 'running' | 'done' | 'error'

export type EmbedTestState = {
  status: EmbedTestStatus
  steps: Array<{ id: string; label: string }>
  configs: ChunkConfig[]
  results: ConfigResult[]
  report: EmbedTestReport | null
  error: string | null
}

export const initialState: EmbedTestState = {
  status: 'idle',
  steps: [],
  configs: [],
  results: [],
  report: null,
  error: null,
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
    case 'report':
      return { ...state, report: event.report, status: 'done' }
    case 'error':
      return { ...state, status: 'error', error: event.message }
  }
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
  run: (file: File, model: EmbedTestModelKey) => Promise<void>
  reset: () => void
}

export function useEmbedTest(): UseEmbedTest {
  const [state, setState] = useState<EmbedTestState>(initialState)
  const runningRef = useRef(false)

  const reset = useCallback(() => {
    if (runningRef.current) return
    setState(initialState)
  }, [])

  const run = useCallback(async (file: File, model: EmbedTestModelKey) => {
    if (runningRef.current) return
    runningRef.current = true
    setState({ ...initialState, status: 'running' })

    const fail = (message: string) =>
      setState((prev) => ({ ...prev, status: 'error', error: message }))

    try {
      const form = new FormData()
      form.set('file', file)
      form.set('model', model)
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
  }, [])

  return { state, run, reset }
}
