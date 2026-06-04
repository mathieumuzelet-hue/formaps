'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Icon } from '@/components/ui/Icon'
import { BRAIN_SUGGESTIONS } from '@/lib/brain/suggestions'
import { useBrainChat, type BrainMessage } from '@/lib/brain/useBrainChat'

/**
 * Tailwind classes styling react-markdown's children (we have no typography
 * plugin, so element styles are applied via arbitrary descendant selectors).
 */
const MARKDOWN_CLASSES = [
  'font-serif text-[16.5px] leading-[1.7] text-ink',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-1',
  '[&_strong]:font-semibold',
  '[&_em]:italic',
  '[&_h1]:font-serif [&_h1]:text-xl [&_h1]:font-medium [&_h1]:mt-3 [&_h1]:mb-1',
  '[&_h2]:font-serif [&_h2]:text-lg [&_h2]:font-medium [&_h2]:mt-3 [&_h2]:mb-1',
  '[&_h3]:font-serif [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1',
  '[&_a]:text-redink [&_a]:underline',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-sub [&_blockquote]:italic',
  '[&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[14px]',
  '[&_pre]:bg-surface [&_pre]:p-3 [&_pre]:rounded-[10px] [&_pre]:overflow-x-auto [&_pre]:my-2',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:w-full [&_table]:my-2 [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-3 [&_hr]:border-line',
].join(' ')

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
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set())

  const toggle = (i: number) =>
    setOpenIndices((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div className="max-w-[85%] self-start">
      <div className={MARKDOWN_CLASSES}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        <SuperscriptRefs count={sources.length} />
      </div>
      {sources.length > 0 && (
        <div className="mt-[18px] border-t border-line pt-[14px]">
          <div className="mb-[10px] text-[11.5px] font-bold tracking-[0.06em] text-faint">
            SOURCES CITÉES
          </div>
          {sources.map((s, i) => {
            const meta = [s.tag, s.page].filter(Boolean).map((v) => `· ${v}`).join(' ')
            const expandable = typeof s.content === 'string' && s.content.length > 0
            const open = openIndices.has(i)
            return (
              <div key={`${s.doc}-${i}`}>
                <button
                  type="button"
                  onClick={() => expandable && toggle(i)}
                  disabled={!expandable}
                  aria-expanded={expandable ? open : undefined}
                  className="flex w-full items-center gap-[11px] py-2 text-left disabled:cursor-default"
                >
                  <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] border-red text-[11px] font-extrabold text-red">
                    {i + 1}
                  </span>
                  <Icon name="file" size={17} color="#8A7F6E" />
                  <span className="text-[13.5px] font-bold">{s.doc}</span>
                  {meta && <span className="text-[12.5px] text-faint">{meta}</span>}
                  {expandable && (
                    <Icon
                      name="chevronD"
                      size={16}
                      color="#8A7F6E"
                      className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  )}
                </button>
                {expandable && open && (
                  <blockquote className="mb-2 ml-[33px] rounded-[10px] border border-line border-l-[3px] border-l-red bg-surface p-3 text-[13px] italic leading-[1.55] text-sub">
                    {s.content}
                  </blockquote>
                )}
              </div>
            )
          })}
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
    <div className="mx-auto flex w-full max-w-[860px] flex-1 flex-col px-5 pt-[26px] md:px-10">
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
