export type ProgressStatus = 'not_started' | 'in_progress' | 'done'

export type ProgressRow = {
  formationId: string
  status: ProgressStatus
  progressPercent: number
}

export type ProgressSummary = {
  done: number
  total: number
  percentByFormation: Record<string, number>
}

export function summarizeProgress(
  rows: ReadonlyArray<ProgressRow>,
  total: number,
): ProgressSummary {
  let done = 0
  const percentByFormation: Record<string, number> = {}
  for (const row of rows) {
    if (row.status === 'done') done++
    percentByFormation[row.formationId] = row.progressPercent
  }
  return { done, total, percentByFormation }
}
