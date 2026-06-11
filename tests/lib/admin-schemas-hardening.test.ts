import { describe, expect, it } from 'vitest'

import {
  formationCreateSchema,
  formationUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@/lib/admin/schemas'

const BASE_FORMATION = {
  name: 'F',
  slug: 'f',
  tag: 't',
  icon: 'i',
  description: 'd',
  kind: 'sharepoint' as const,
}

describe('password .max(128)', () => {
  it('userCreateSchema rejects >128 chars', () => {
    const result = userCreateSchema.safeParse({
      email: 'a@aps.fr',
      firstName: 'A',
      role: 'employee',
      password: 'x'.repeat(129),
    })
    expect(result.success).toBe(false)
  })

  it('userUpdateSchema rejects >128 chars', () => {
    const result = userUpdateSchema.safeParse({
      id: '5f0c1bba-cccc-4444-8888-aaaaaaaaaaaa',
      password: 'x'.repeat(129),
    })
    expect(result.success).toBe(false)
  })

  it('still accepts a 128-char password', () => {
    const result = userUpdateSchema.safeParse({
      id: '5f0c1bba-cccc-4444-8888-aaaaaaaaaaaa',
      password: 'x'.repeat(128),
    })
    expect(result.success).toBe(true)
  })
})

describe('sharepointUrl scheme', () => {
  it('rejects javascript: URLs (create + update)', () => {
    expect(
      formationCreateSchema.safeParse({
        ...BASE_FORMATION,
        sharepointUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false)
    expect(
      formationUpdateSchema.safeParse({
        id: '5f0c1bba-cccc-4444-8888-aaaaaaaaaaaa',
        sharepointUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false)
  })

  it('accepts https and keeps null/undefined passthrough', () => {
    expect(
      formationCreateSchema.safeParse({
        ...BASE_FORMATION,
        sharepointUrl: 'https://aps.sharepoint.com/x',
      }).success,
    ).toBe(true)
    expect(
      formationCreateSchema.safeParse({ ...BASE_FORMATION, sharepointUrl: null })
        .success,
    ).toBe(true)
    expect(formationCreateSchema.safeParse(BASE_FORMATION).success).toBe(true)
  })
})
