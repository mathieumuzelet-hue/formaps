export function joursRestants(basculeDate: string, now = new Date()): number {
  const target = new Date(basculeDate + 'T00:00:00Z')
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const diff = Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
  return Math.max(0, diff)
}
export function parcoursPercent(currentStep: number): number {
  return Math.round((Math.min(4, Math.max(0, currentStep)) / 4) * 100)
}
