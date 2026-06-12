import { describe, expect, it } from 'vitest'

import { decodeCsvBytes } from '@/lib/admin/decode-csv-file'

const enc = new TextEncoder()

describe('decodeCsvBytes', () => {
  it('décode de l’UTF-8 pur à l’identique', () => {
    expect(decodeCsvBytes(enc.encode('email;prenom\nlea@aps.fr;Léa'))).toBe(
      'email;prenom\nlea@aps.fr;Léa',
    )
  })

  it('retombe sur windows-1252 quand les octets ne sont pas de l’UTF-8 valide', () => {
    // « Léa » encodé Windows-1252 : é = 0xE9 (invalide en UTF-8 isolé)
    const bytes = Uint8Array.from([0x4c, 0xe9, 0x61])
    expect(decodeCsvBytes(bytes)).toBe('Léa')
  })

  it('décode le symbole € (0x80 en 1252)', () => {
    const bytes = Uint8Array.from([0x31, 0x80]) // "1€"
    expect(decodeCsvBytes(bytes)).toBe('1€')
  })

  it('strip le BOM UTF-8', () => {
    const bytes = enc.encode('﻿email;prenom')
    expect(decodeCsvBytes(bytes)).toBe('email;prenom')
  })
})
