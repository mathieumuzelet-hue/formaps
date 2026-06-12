import { describe, expect, it } from 'vitest'

import { BOM, DELIMITER, csvCell } from '@/lib/csv'

describe('csvCell', () => {
  it('laisse une cellule saine inchangée', () => {
    expect(csvCell('Camille')).toBe('Camille')
    expect(csvCell('camille@aps.fr')).toBe('camille@aps.fr')
    expect(csvCell('')).toBe('')
  })

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'neutralise une cellule commençant par %j (guard formule)',
    (ch) => {
      const out = csvCell(`${ch}cmd()`)
      expect(out.startsWith(`'`) || out.startsWith(`"'`)).toBe(true)
      expect(out).toContain(`'${ch}cmd()`)
    },
  )

  it('quote une cellule contenant le délimiteur ;', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
  })

  it('quote et double les guillemets internes', () => {
    expect(csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""')
  })

  it('quote les retours à la ligne (LF et CRLF)', () => {
    expect(csvCell('ligne1\nligne2')).toBe('"ligne1\nligne2"')
    // \r\n : le \r n'est PAS le 1er caractère → pas de guard formule, quoting seul.
    expect(csvCell('ligne1\r\nligne2')).toBe('"ligne1\r\nligne2"')
  })

  it('guard PUIS quoting combinés', () => {
    expect(csvCell('=a;b')).toBe(`"'=a;b"`)
  })

  it('constantes partagées', () => {
    expect(DELIMITER).toBe(';')
    expect(BOM).toBe('﻿')
  })
})
