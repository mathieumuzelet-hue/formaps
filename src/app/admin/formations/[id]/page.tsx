import { FormationCoverAdmin } from '@/components/admin/FormationCoverAdmin'
import { FormationDocumentsAdmin } from '@/components/admin/FormationDocumentsAdmin'

/**
 * Document manager shell for one formation. The admin layout already guards
 * `role === 'admin'`, so this stays a thin server component that forwards the
 * formation id to the client components (which fetch their own data over tRPC).
 */
export default async function AdminFormationDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="space-y-6">
      {/* FormationDocumentsAdmin embarque le header de page (breadcrumb + h1),
          il doit donc rester le premier bloc rendu. */}
      <FormationDocumentsAdmin formationId={id} />
      <FormationCoverAdmin formationId={id} />
    </div>
  )
}
