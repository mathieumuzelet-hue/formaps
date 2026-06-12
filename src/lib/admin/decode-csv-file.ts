/**
 * Décodage des fichiers CSV importés. Excel FR enregistre par défaut en
 * Windows-1252 : passé tel quel à papaparse (qui lit en UTF-8), « Léa »
 * devenait « L�a » silencieusement en base. On tente UTF-8 strict d'abord,
 * puis on retombe sur windows-1252 (sur-ensemble de latin1, jamais d'échec).
 */

export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    // fatal: true → lève sur tout octet invalide (ex. 0xE9 isolé) ; strip
    // nativement le BOM UTF-8.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Wrapper navigateur : File → string décodée. */
export async function decodeCsvFile(file: File): Promise<string> {
  return decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))
}
