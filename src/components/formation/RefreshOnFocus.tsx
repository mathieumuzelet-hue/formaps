'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Rafraîchit la route quand la fenêtre reprend le focus, pour que la barre de
 * progression (calculée côté serveur depuis les vues de documents) se mette à
 * jour au retour de l'onglet PDF, sans F5. Ne rend rien.
 */
export function RefreshOnFocus() {
  const router = useRouter()

  useEffect(() => {
    const onFocus = () => router.refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [router])

  return null
}
