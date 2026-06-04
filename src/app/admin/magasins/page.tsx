import { MagasinsAdmin } from '@/components/admin/MagasinsAdmin'

export default function AdminMagasinsPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">Magasins</h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Éditer la date de bascule et l’étape du parcours de chaque magasin.
      </p>
      <MagasinsAdmin />
    </div>
  )
}
