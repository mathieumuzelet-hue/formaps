export const COLORS = {
  bg: '#F4EEE3', surface: '#FBF7EF', card: '#FFFFFF',
  ink: '#221C16', sub: '#8A7F6E', faint: '#B7AD9A',
  line: '#E4DBCB', red: '#C8102E', redSoft: '#F4E5E1',
  redInk: '#A20D24', sand: '#EADFC9',
} as const

export const STAGES = ['Préparation', 'Formation', 'Tests', 'Bascule', 'Ouverture'] as const
export type StageIndex = 0 | 1 | 2 | 3 | 4
