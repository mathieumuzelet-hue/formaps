import argon2 from 'argon2'

/**
 * Hash a plaintext password using argon2id (Node runtime only — never import
 * this from edge/middleware code).
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

/**
 * Verify a plaintext password against an argon2 hash. Returns `false` (never
 * throws) when the stored hash is malformed or verification fails.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}
