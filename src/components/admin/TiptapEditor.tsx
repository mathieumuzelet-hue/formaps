'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'

type Props = {
  value: string
  onChange: (html: string) => void
}

const BTN =
  'rounded px-2 py-1 text-[13px] font-medium text-sub hover:bg-sand/60 disabled:opacity-40 disabled:hover:bg-transparent'
const BTN_ACTIVE = 'rounded px-2 py-1 text-[13px] font-semibold bg-sand text-ink'

/**
 * Reusable rich-text editor (Tiptap) for the news admin.
 *
 * `immediatelyRender: false` is MANDATORY under the Next.js App Router: Tiptap
 * would otherwise render synchronously on the server and trigger a hydration
 * mismatch. The component is client-only.
 */
export function TiptapEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  if (!editor) {
    return (
      <div className="min-h-[260px] animate-pulse rounded-[12px] border border-line bg-card" />
    )
  }

  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="min-h-[260px] rounded-[12px] border border-line bg-card p-4 [&_.ProseMirror]:min-h-[230px] [&_.ProseMirror]:focus:outline-none [&_h2]:mt-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-sub [&_a]:text-redink [&_a]:underline focus:outline-none"
      />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL du lien', previous ?? '')
    if (url === null) return // cancelled
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url.trim() })
      .run()
  }

  function cls(active: boolean) {
    return active ? BTN_ACTIVE : BTN
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-[12px] border border-line bg-surface px-2 py-1.5">
      <button
        type="button"
        className={cls(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        Gras
      </button>
      <button
        type="button"
        className={cls(editor.isActive('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        Italique
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <button
        type="button"
        className={cls(editor.isActive('heading', { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        Titre
      </button>
      <button
        type="button"
        className={cls(editor.isActive('heading', { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        Sous-titre
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <button
        type="button"
        className={cls(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        Liste à puces
      </button>
      <button
        type="button"
        className={cls(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        Liste numérotée
      </button>
      <button
        type="button"
        className={cls(editor.isActive('blockquote'))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        Citation
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <button type="button" className={cls(editor.isActive('link'))} onClick={setLink}>
        Lien
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <button
        type="button"
        className={BTN}
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        Annuler
      </button>
      <button
        type="button"
        className={BTN}
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        Rétablir
      </button>
    </div>
  )
}
