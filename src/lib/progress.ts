export type FormationDocTotal = {
  formationId: string
  total: number
}

export type FormationDocViewed = {
  formationId: string
  viewed: number
}

export type ProgressSummary = {
  done: number
  total: number
  percentByFormation: Record<string, number>
}

/**
 * Progression automatique calculée depuis les vues de documents :
 * percent = documents vus / documents totaux (arrondi, clampé à 100) ;
 * « terminée » = formation avec ≥ 1 document dont tous les documents sont vus.
 * Une formation sans document (SharePoint only) reste à 0 %, jamais terminée.
 * `total` = nombre total de formations (`formationCount`).
 */
export function summarizeDocProgress(
  totals: ReadonlyArray<FormationDocTotal>,
  viewed: ReadonlyArray<FormationDocViewed>,
  formationCount: number,
): ProgressSummary {
  const viewedByFormation: Record<string, number> = {}
  for (const row of viewed) {
    viewedByFormation[row.formationId] = row.viewed
  }

  let done = 0
  const percentByFormation: Record<string, number> = {}
  for (const { formationId, total } of totals) {
    if (total <= 0) continue
    const seen = viewedByFormation[formationId] ?? 0
    percentByFormation[formationId] = Math.min(100, Math.round((seen / total) * 100))
    if (seen >= total) done++
  }

  return { done, total: formationCount, percentByFormation }
}
