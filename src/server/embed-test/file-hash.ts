import { createHash } from 'node:crypto'

/** sha256 hex digest — used to detect a re-uploaded file changing between rounds. */
export function hashBuffer(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
