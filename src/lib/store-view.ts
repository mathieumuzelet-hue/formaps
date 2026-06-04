import { joursRestants, parcoursPercent } from '@/lib/bascule'
import { STAGES } from '@/lib/design/tokens'

export type StoreInput = {
  id: string
  name: string
  basculeDate: string
  currentStep: number
}

export type StoreView = {
  id: string
  name: string
  basculeDate: string
  currentStep: number
  joursRestants: number
  parcoursPercent: number
  currentStepLabel: string
}

/**
 * Pure mapping from a persisted store row to the view shape consumed by the
 * cockpit home screen. Extracted from `store.getMine` so it can be unit-tested
 * without a database.
 */
export function toStoreView(store: StoreInput, now?: Date): StoreView {
  const idx = Math.min(STAGES.length - 1, Math.max(0, store.currentStep))
  return {
    id: store.id,
    name: store.name,
    basculeDate: store.basculeDate,
    currentStep: store.currentStep,
    joursRestants: joursRestants(store.basculeDate, now),
    parcoursPercent: parcoursPercent(store.currentStep),
    currentStepLabel: STAGES[idx],
  }
}
