import { UtilisateursAdmin } from '@/components/admin/UtilisateursAdmin'

export default function AdminUtilisateursPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-extrabold tracking-[-0.02em]">Utilisateurs</h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Gestion des comptes employés et administrateurs.
      </p>
      <UtilisateursAdmin />
    </div>
  )
}
