import { SuggestionsAdmin } from '@/components/admin/SuggestionsAdmin'

export default function AdminSuggestionsPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-extrabold tracking-[-0.02em]">
        Suggestions BRAIN
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Les questions proposées sous le chat BRAIN. Sans suggestion active, le
        chat affiche les questions par défaut.
      </p>
      <SuggestionsAdmin />
    </div>
  )
}
