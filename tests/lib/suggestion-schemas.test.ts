import { expect, test } from 'vitest'

import {
  suggestionCreateSchema,
  suggestionReorderSchema,
  suggestionUpdateSchema,
} from '@/lib/admin/schemas'

const UUID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'

test('create : texte requis, 1 à 200 caractères', () => {
  expect(suggestionCreateSchema.safeParse({ text: 'Comment ouvrir une caisse ?' }).success).toBe(true)
  expect(suggestionCreateSchema.safeParse({ text: '' }).success).toBe(false)
  expect(suggestionCreateSchema.safeParse({ text: 'x'.repeat(201) }).success).toBe(false)
})

test('update : id uuid requis, champs optionnels', () => {
  expect(suggestionUpdateSchema.safeParse({ id: UUID, isActive: false }).success).toBe(true)
  expect(suggestionUpdateSchema.safeParse({ id: UUID, text: 'Nouvelle question ?' }).success).toBe(true)
  expect(suggestionUpdateSchema.safeParse({ id: 'pas-un-uuid' }).success).toBe(false)
})

test('reorder : liste non vide d\'uuids', () => {
  expect(suggestionReorderSchema.safeParse({ ids: [UUID] }).success).toBe(true)
  expect(suggestionReorderSchema.safeParse({ ids: [] }).success).toBe(false)
  expect(suggestionReorderSchema.safeParse({ ids: ['nope'] }).success).toBe(false)
})
