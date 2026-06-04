import crypto from 'node:crypto'

/**
 * Unambiguous charset: excludes 0/O, 1/l/I to avoid transcription errors when an
 * admin reads a generated password aloud or copies it by hand.
 */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/**
 * Generate a random password using a CSPRNG (`crypto.randomInt`). Used server-side
 * for bulk-created users; the plaintext is returned once to the admin and only its
 * argon2 hash is ever stored.
 */
export function generatePassword(length = 12): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CHARSET[crypto.randomInt(CHARSET.length)]
  }
  return out
}
