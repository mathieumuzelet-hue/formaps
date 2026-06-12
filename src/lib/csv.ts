/**
 * Briques CSV partagées par tous les exports DESTINÉS À UN HUMAIN (credentials,
 * modèles, FAQ-gaps). L'export FAQ Builder → Dify (src/lib/faq/csv.ts) ne passe
 * PAS par ici : c'est de l'ingestion machine, un guard formule corromprait les
 * Q&A (décision PR #12).
 */

/** UTF-8 byte-order mark : Excel ouvre les CSV accentués correctement. */
export const BOM = '﻿'

/** Délimiteur du projet (Excel FR). */
export const DELIMITER = ';'

/** Premiers caractères interprétés comme formule par Excel/LibreOffice. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * Rend une valeur sûre pour une cellule CSV :
 * 1. guard anti-formule — préfixe `'` si le 1er caractère est un déclencheur
 *    (contenu cross-user : la cible est l'admin qui ouvre l'export dans Excel) ;
 * 2. quoting RFC 4180 — entoure de `"` (guillemets internes doublés) si la
 *    valeur contient le délimiteur, un guillemet ou un retour à la ligne.
 */
export function csvCell(value: string): string {
  let out = value
  if (out.length > 0 && FORMULA_TRIGGERS.has(out[0])) {
    out = `'${out}`
  }
  if (out.includes(DELIMITER) || out.includes('"') || out.includes('\n') || out.includes('\r')) {
    out = `"${out.replace(/"/g, '""')}"`
  }
  return out
}
