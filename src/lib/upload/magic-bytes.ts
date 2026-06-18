/**
 * File-type sniffing by magic bytes - the MIME `file.type` is client-controlled,
 * so every upload route also checks the real signature. Single source of truth
 * shared by all upload routes (embed-test, faq-builder, formation documents).
 */

/** PDF: starts with "%PDF" (0x25 0x50 0x44 0x46). */
export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  )
}

/** ZIP container (docx, xlsx…): starts with "PK\x03\x04". */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}
