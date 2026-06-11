/**
 * Masque le message des erreurs internes (500) côté client : sans formatter,
 * tRPC renvoie `error.message` brut même en prod (texte Postgres, noms de
 * tables...). Les erreurs métier (UNAUTHORIZED, FORBIDDEN, CONFLICT, zod
 * BAD_REQUEST...) passent inchangées — l'UI admin s'appuie dessus.
 */
export const INTERNAL_ERROR_MESSAGE = 'Une erreur interne est survenue.'

export function maskInternalErrorMessage<S extends { message: string; data: { code: string } }>(
  shape: S,
): S {
  if (shape.data.code !== 'INTERNAL_SERVER_ERROR') return shape
  return { ...shape, message: INTERNAL_ERROR_MESSAGE }
}
