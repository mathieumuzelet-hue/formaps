import { FormationDocumentsAdmin } from '@/components/admin/FormationDocumentsAdmin'

/**
 * Document manager shell for one formation. The admin layout already guards
 * `role === 'admin'`, so this stays a thin server component that forwards the
 * formation id to the client component (which fetches its own data over tRPC).
 */
export default async function AdminFormationDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <FormationDocumentsAdmin formationId={id} />
}
