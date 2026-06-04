import { STAGES } from '@/lib/design/tokens'

export type StepOption = { value: number; label: string }

/**
 * The five bascule steps as `<select>` options, labelled `"<index> · <stage>"`
 * (e.g. `"0 · Préparation"` … `"4 · Ouverture"`). Single source of truth shared
 * by `MagasinsAdmin` so the option list never drifts from `STAGES`.
 */
export function stepOptions(): StepOption[] {
  return STAGES.map((label, value) => ({ value, label: `${value} · ${label}` }))
}
