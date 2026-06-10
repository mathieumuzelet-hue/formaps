import { FaqBuilderAdmin } from '@/components/admin/FaqBuilderAdmin'

export default function AdminFaqBuilderPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        FAQ Builder
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Générez une FAQ depuis un document, retouchez les paires, puis exportez
        le CSV à importer dans Dify (Connaissances → Importer → mode Q&amp;A).
      </p>
      <FaqBuilderAdmin />
    </div>
  )
}
