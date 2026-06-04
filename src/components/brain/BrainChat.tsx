'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { BRAIN_SUGGESTIONS } from '@/lib/brain/suggestions'
import { useBrainChat, type BrainMessage } from '@/lib/brain/useBrainChat'

function SuperscriptRefs({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <sup className="px-0.5 font-sans text-[12px] font-bold text-red">
      {Array.from({ length: count }, (_, i) => `[${i + 1}]`).join('')}
    </sup>
  )
}

function AiMessage({ message }: { message: BrainMessage }) {
  const sources = message.sources ?? []
  return (
    <div className="max-w-[85%] self-start">
      <div className="font-serif text-[16.5px] leading-[1.7] text-ink">
        {message.text}
        <SuperscriptRefs count={sources.length} />
      </div>
      {sources.length > 0 && (
        <div className="mt-[18px] border-t border-line pt-[14px]">
          <div className="mb-[10px] text-[11.5px] font-bold tracking-[0.06em] text-faint">
            SOURCES CITÉES
          </div>
          {sources.map((s, i) => (
            <div key={`${s.doc}-${i}`} className="flex items-center gap-[11px] py-2">
              <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] border-red text-[11px] font-extrabold text-red">
                {i + 1}
              </span>
              <Icon name="file" size={17} color="#8A7F6E" />
              <span className="text-[13.5px] font-bold">{s.doc}</span>
              <span className="text-[12.5px] text-faint">
                {[s.tag, s.page].filter(Boolean).map((v) => `· ${v}`).join(' ')}
              </span>
              <Icon name="external" size={15} color="#8A7F6E" className="ml-auto" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function BrainChat() {
  const { messages, status, send } = useBrainChat()
  const [draft, setDraft] = useState('')

  const streaming = status === 'streaming'
  const lastMessage = messages[messages.length - 1]
  const thinking =
    streaming && lastMessage?.role === 'ai' && lastMessage.text.length === 0

  const submit = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || streaming) return
    void send(trimmed)
    setDraft('')
  }

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-1 flex-col px-[40px] pt-[26px]">
      {/* Header */}
      <div className="mb-[22px] flex items-center gap-[13px]">
        <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-red">
          <Icon name="brain" size={25} color="#fff" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="font-serif text-[26px] font-medium">BRAIN</h1>
          <div className="text-[13px] text-sub">
            L’assistant qui répond avec vos documents, sources citées.
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-5">
        {messages.map((message, i) =>
          message.role === 'user' ? (
            <div
              key={i}
              className="max-w-[70%] self-end rounded-[18px_18px_5px_18px] bg-ink px-[18px] py-[13px] text-[14.5px] leading-[1.5] text-white"
            >
              {message.text}
            </div>
          ) : (
            <AiMessage key={i} message={message} />
          ),
        )}
        {thinking && (
          <div className="self-start font-serif text-[16.5px] italic text-faint">
            BRAIN réfléchit
            <span className="ml-0.5 inline-block animate-pulse">…</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="pb-[18px]">
        <div className="mb-[9px] text-[12px] font-bold text-faint">SUGGESTIONS</div>
        <div className="mb-4 flex flex-wrap gap-[9px]">
          {BRAIN_SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              disabled={streaming}
              className="rounded-[20px] border border-line bg-surface px-[15px] py-[9px] text-[13px] font-semibold text-ink disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(draft)
          }}
          className="flex items-center gap-3 rounded-[14px] border border-line bg-card py-[6px] pl-[18px] pr-[6px]"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={streaming}
            placeholder="Écrivez votre question…"
            className="flex-1 bg-transparent text-[14.5px] text-ink placeholder:text-faint focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={streaming || draft.trim().length === 0}
            aria-label="Envoyer"
            className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-[11px] bg-red disabled:opacity-50"
          >
            <Icon name="send" size={20} color="#fff" />
          </button>
        </form>

        <div className="mt-[10px] text-[12px] text-faint">
          BRAIN peut faire des erreurs — vérifiez via les sources citées.
        </div>
      </div>
    </div>
  )
}
