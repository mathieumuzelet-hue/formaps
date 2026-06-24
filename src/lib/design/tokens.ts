export const COLORS = {
  bg: '#FFFAEF', surface: '#FFFFFF', card: '#FFFFFF', panel: '#FBF4E6',
  ink: '#511227', violine: '#511227', sub: '#7C606A', faint: '#B3A1A8',
  line: '#EBDFCD', red: '#E0001A', redSoft: '#FBE7E2', redInk: '#511227',
  cream: '#FFFAEF', coral: '#FF6A78', sand: '#F1E7D4',
} as const

export const STAGES = ['Préparation', 'Formation', 'Tests', 'Bascule', 'Ouverture'] as const
export type StageIndex = 0 | 1 | 2 | 3 | 4
