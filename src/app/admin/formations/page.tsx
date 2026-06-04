import { FormationsAdmin } from '@/components/admin/FormationsAdmin'

export default function AdminFormationsPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">Formations</h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Création et édition du catalogue de formations.
      </p>
      <FormationsAdmin />
    </div>
  )
}
