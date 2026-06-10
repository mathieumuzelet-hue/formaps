import { FaqDraftEditor } from '@/components/admin/FaqDraftEditor'

/**
 * Editor shell for one FAQ draft. The admin layout already guards
 * `role==='admin'`, so this stays a thin server component forwarding the id
 * to the client editor (which fetches its own data over tRPC).
 */
export default async function AdminFaqDraftPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        Édition de la FAQ
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Retouchez les paires puis exportez le CSV — import Dify : Connaissances →
        Importer → mode Q&amp;A.
      </p>
      <FaqDraftEditor draftId={id} />
    </div>
  )
}
