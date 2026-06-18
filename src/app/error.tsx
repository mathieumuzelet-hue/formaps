'use client'

export default function Error({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-24 text-center md:px-10">
      <div className="mb-4 text-[13px] font-bold uppercase tracking-[0.04em] text-red">
        FormA+Super
      </div>
      <h1 className="font-serif text-[27px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[38px]">
        Une erreur est survenue.
      </h1>
      <p className="mt-4 max-w-[440px] text-[15.5px] leading-[1.6] text-sub">
        Le problème est de notre côté, pas du vôtre. Réessayez — si ça persiste,
        prévenez votre référent.
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="mt-8 rounded-[10px] bg-red px-6 py-[13px] text-[14.5px] font-bold text-white"
      >
        Réessayer
      </button>
    </div>
  )
}
