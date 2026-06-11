import { describe, expect, it } from 'vitest'

import { maskInternalErrorMessage } from '@/server/trpc/error-format'

const baseShape = {
  message: 'relation "users" does not exist',
  code: -32603,
  data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'progress.markDone' },
}

describe('maskInternalErrorMessage', () => {
  it('replaces the message of INTERNAL_SERVER_ERROR shapes', () => {
    const masked = maskInternalErrorMessage(baseShape)
    expect(masked.message).toBe('Une erreur interne est survenue.')
    expect(masked.data).toEqual(baseShape.data) // reste intact
  })

  it('leaves business errors untouched (CONFLICT)', () => {
    const shape = {
      ...baseShape,
      message: 'Email déjà utilisé',
      data: { ...baseShape.data, code: 'CONFLICT', httpStatus: 409 },
    }
    expect(maskInternalErrorMessage(shape)).toBe(shape)
  })

  it('leaves zod BAD_REQUEST untouched', () => {
    const shape = {
      ...baseShape,
      message: 'Invalid input',
      data: { ...baseShape.data, code: 'BAD_REQUEST', httpStatus: 400 },
    }
    expect(maskInternalErrorMessage(shape)).toBe(shape)
  })
})
