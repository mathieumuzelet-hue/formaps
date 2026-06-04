import { NewsEditor } from '@/components/admin/NewsEditor'

/**
 * Editor shell for one article. The admin layout already guards `role==='admin'`,
 * so this stays a thin server component forwarding the id to the client editor
 * (which fetches its own data over tRPC).
 */
export default async function AdminActualiteEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <NewsEditor id={id} />
}
