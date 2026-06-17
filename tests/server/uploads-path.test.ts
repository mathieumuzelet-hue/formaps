import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import { uploadsDir, formationPdfPath } from '@/server/storage/uploads'

afterEach(() => { delete process.env.UPLOADS_DIR })

describe('uploads paths', () => {
  test('defaults to /app/uploads', () => {
    expect(uploadsDir()).toBe('/app/uploads')
  })
  test('honours UPLOADS_DIR env', () => {
    process.env.UPLOADS_DIR = '/data/up'
    expect(uploadsDir()).toBe('/data/up')
  })
  test('formationPdfPath joins docId.pdf', () => {
    process.env.UPLOADS_DIR = '/data/up'
    expect(formationPdfPath('abc')).toBe(path.join('/data/up', 'abc.pdf'))
  })
})
