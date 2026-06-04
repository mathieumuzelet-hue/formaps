import { NewsAdmin } from '@/components/admin/NewsAdmin'

export default function AdminActualitesPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">Actualités</h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Rédaction et publication des actualités du réseau.
      </p>
      <NewsAdmin />
    </div>
  )
}
