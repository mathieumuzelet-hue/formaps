/**
 * Strip the `passwordHash` from a user row before returning it over the API.
 * Generic so it works on any row shape that carries a `passwordHash` key.
 */
export function stripPassword<T extends { passwordHash?: unknown }>(
  user: T,
): Omit<T, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...rest } = user
  return rest
}
