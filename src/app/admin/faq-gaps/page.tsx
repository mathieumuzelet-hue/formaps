import { FaqGapsAdmin } from '@/components/admin/FaqGapsAdmin'

export default function AdminFaqGapsPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        Trous de la FAQ
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Questions BRAIN des 30 derniers jours sans source pertinente ou jugées
        inutiles — les candidates à enrichir dans la base documentaire.
      </p>
      <FaqGapsAdmin />
    </div>
  )
}
