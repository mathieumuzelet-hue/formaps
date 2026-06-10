'use client'

import { useCallback, useRef, useState } from 'react'

import { parseDifyEvent, parseSSELines, type BrainSource } from '@/lib/dify/parse'

export type BrainMessage = {
  role: 'user' | 'ai'
  text: string
  sources?: BrainSource[]
  /** Dify message id, set at message_end — keys the 👍/👎 feedback. */
  messageId?: string
}

export type BrainStatus = 'idle' | 'streaming' | 'error'

const ERROR_NOTE = 'BRAIN est momentanément indisponible. Réessayez.'

/**
 * Returns the Dify error message carried by a frame, if any (Dify streams an
 * `event: error` when the model fails — quota, capacity, provider error).
 */
export function frameError(frame: string): string | undefined {
  for (const payload of parseSSELines(frame)) {
    const parsed = parseDifyEvent(payload)
    if (parsed.error) return parsed.error
  }
  return undefined
}

/**
 * Maps a raw Dify/model error to a short, user-facing message (never dumps the
 * raw nested provider JSON to the end user).
 */
export function difyErrorText(raw: string): string {
  if (/429|capacity exceeded|service_tier_capacity|rate.?limit/i.test(raw)) {
    return 'Le modèle est momentanément surchargé. Réessayez dans un instant.'
  }
  return "BRAIN n'a pas pu répondre (erreur du modèle). Réessayez, ou prévenez l'administrateur si cela persiste."
}

/**
 * Splits an SSE accumulation buffer into complete frames.
 *
 * A Dify/SSE frame is terminated by a blank line (`\n\n`). Anything after the
 * last terminator is an incomplete frame and is returned as `rest` so the caller
 * can prepend it to the next chunk. This makes the stream loop robust to network
 * chunks that split a `data:` payload across reads.
 */
export function splitSSEFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let working = buffer
  let idx = working.indexOf('\n\n')
  while (idx !== -1) {
    frames.push(working.slice(0, idx))
    working = working.slice(idx + 2)
    idx = working.indexOf('\n\n')
  }
  return { frames, rest: working }
}

/**
 * Applies one completed SSE frame to the current AI message, returning a new
 * message. Pure — no React, no I/O. The reducer the streaming loop is built on.
 */
export function reduceFrame(current: BrainMessage, frame: string): BrainMessage {
  let next = current
  for (const payload of parseSSELines(frame)) {
    const parsed = parseDifyEvent(payload)
    if (parsed.answerDelta) {
      next = { ...next, text: next.text + parsed.answerDelta }
    }
    if (parsed.sources && parsed.sources.length > 0) {
      next = { ...next, sources: parsed.sources }
    }
    if (parsed.messageId) {
      next = { ...next, messageId: parsed.messageId }
    }
  }
  return next
}

export type UseBrainChat = {
  messages: BrainMessage[]
  status: BrainStatus
  send: (query: string) => Promise<void>
}

export function useBrainChat(): UseBrainChat {
  const [messages, setMessages] = useState<BrainMessage[]>([])
  const [status, setStatus] = useState<BrainStatus>('idle')
  // Guard against overlapping sends (input is disabled while streaming, but the
  // ref keeps the logic honest even if `send` is called programmatically).
  const sendingRef = useRef(false)

  const send = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed || sendingRef.current) return
    sendingRef.current = true

    // Index of the AI message we are about to fill. The user message goes first,
    // then the empty AI placeholder, so the AI index is the current length + 1.
    let aiIndex = 0
    setMessages((prev) => {
      aiIndex = prev.length + 1
      return [...prev, { role: 'user', text: trimmed }, { role: 'ai', text: '' }]
    })
    setStatus('streaming')

    const updateAi = (updater: (msg: BrainMessage) => BrainMessage) => {
      setMessages((prev) => {
        const copy = [...prev]
        const target = copy[aiIndex]
        if (target) copy[aiIndex] = updater(target)
        return copy
      })
    }

    try {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      })

      if (!res.ok || !res.body) {
        updateAi((msg) => ({ ...msg, text: ERROR_NOTE }))
        setStatus('error')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let errored = false

      // Stream loop: decode → accumulate → split complete frames → reduce.
      // Incomplete trailing frames stay in `buffer` until terminated by `\n\n`.
      // If Dify streams an `error` event, surface it and stop.
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = splitSSEFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          const err = frameError(frame)
          if (err) {
            const text = difyErrorText(err)
            // Annotate instead of overwrite: keep whatever the model already
            // streamed (a mid-generation failure should not eat visible text).
            updateAi((msg) => ({ ...msg, text: msg.text ? `${msg.text}\n\n— ${text}` : text }))
            setStatus('error')
            errored = true
            break
          }
          updateAi((msg) => reduceFrame(msg, frame))
        }
        if (errored) break
      }

      if (errored) return

      // Flush any final bytes + a trailing frame not terminated by a blank line.
      buffer += decoder.decode()
      if (buffer.trim().length > 0) {
        const err = frameError(buffer)
        if (err) {
          const text = difyErrorText(err)
          // Annotate instead of overwrite: keep whatever the model already
          // streamed (a mid-generation failure should not eat visible text).
          updateAi((msg) => ({ ...msg, text: msg.text ? `${msg.text}\n\n— ${text}` : text }))
          setStatus('error')
          return
        }
        updateAi((msg) => reduceFrame(msg, buffer))
      }

      setStatus('idle')
    } catch {
      updateAi((msg) => ({ ...msg, text: ERROR_NOTE }))
      setStatus('error')
    } finally {
      sendingRef.current = false
    }
  }, [])

  return { messages, status, send }
}
