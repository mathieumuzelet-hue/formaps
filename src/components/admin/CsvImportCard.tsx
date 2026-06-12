'use client'

import { useRef, useState } from 'react'
import Papa from 'papaparse'

import { trpc } from '@/lib/trpc/client'
import { Icon } from '@/components/ui/Icon'
import { buildTemplateCsv, toCredentialsCsv } from '@/lib/admin/csv-export'
import { sanitizeParsedRows } from '@/lib/admin/csv-import'
import { decodeCsvFile } from '@/lib/admin/decode-csv-file'
import { downloadCsv } from '@/lib/admin/download-csv'

type RowError = { row: number; message: string }
type CreatedUser = { row: number; email: string; firstName: string; password: string }

type ColumnDef = { name: string; desc: string }

const STORE_COLUMNS: ColumnDef[] = [
  { name: 'nom', desc: 'texte — requis' },
  { name: 'date_bascule', desc: 'format AAAA-MM-JJ — requis' },
  { name: 'etape', desc: 'entier 0 à 4 — optionnel, défaut 0' },
]

const USER_COLUMNS: ColumnDef[] = [
  { name: 'email', desc: 'requis' },
  { name: 'prenom', desc: 'requis' },
  { name: 'role', desc: 'employee ou admin — optionnel, défaut employee' },
  { name: 'magasin', desc: "nom exact d'un magasin existant — optionnel" },
]

const SECTION = 'rounded-[14px] border border-line bg-card p-5'
const LEGEND = 'rounded-[12px] border border-line bg-surface p-4'
const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50 disabled:opacity-50'
const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50'

function Legend({ columns, note }: { columns: ColumnDef[]; note?: string }) {
  return (
    <div className={LEGEND}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
        Colonnes attendues
      </p>
      <dl className="mt-2 space-y-1">
        {columns.map((c) => (
          <div key={c.name} className="flex flex-wrap gap-x-2 text-[13px]">
            <dt className="font-mono font-medium text-ink">{c.name}</dt>
            <dd className="text-sub">— {c.desc}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-3 text-[12.5px] leading-snug text-sub">{note}</p>}
    </div>
  )
}

/**
 * Décode (UTF-8 → fallback 1252), parse, nettoie (__parsed_extra, cap) puis
 * remet les lignes au caller. Toute erreur passe par onError (message FR).
 * NB : Papa.parse sur une STRING est synchrone — `complete` est appelé avant
 * le retour de `parse` ; le flux async environnant reste correct.
 */
async function parseCsv(
  file: File,
  onRows: (rows: Array<Record<string, string>>) => void,
  onError: (message: string) => void,
) {
  let text: string
  try {
    text = await decodeCsvFile(file)
  } catch {
    onError('Le fichier est vide ou illisible.')
    return
  }
  Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      if (!res.data || res.data.length === 0) {
        onError('Le fichier est vide ou illisible.')
        return
      }
      const sanitized = sanitizeParsedRows(res.data)
      if ('error' in sanitized) {
        onError(sanitized.error)
        return
      }
      onRows(sanitized.rows)
    },
    error: () => onError('Le fichier est vide ou illisible.'),
  })
}

/**
 * Reusable bulk-import card for the admin. Parses a CSV in the browser with
 * papaparse and calls the relevant `bulkCreate` tRPC mutation. Renders a column
 * legend, a "download template" button, a file input, and a post-import report.
 */
export function CsvImportCard({ kind }: { kind: 'stores' | 'users' }) {
  return kind === 'stores' ? <StoresImportCard /> : <UsersImportCard />
}

/** Shared file-input + parse-error UI. */
function FileInput({
  inputRef,
  disabled,
  parseError,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  disabled: boolean
  parseError: string | null
  onFile: (file: File) => void
}) {
  return (
    <div className="mt-4">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
        }}
        className="block w-full text-[13px] text-sub file:mr-3 file:rounded-lg file:border-0 file:bg-red file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-white hover:file:bg-redink disabled:opacity-50"
      />
      {disabled && <p className="mt-2 text-[13px] text-sub">Import en cours…</p>}
      {parseError && <p className="mt-2 text-[13px] text-red">{parseError}</p>}
    </div>
  )
}

function ErrorsList({ errors }: { errors: RowError[] }) {
  if (errors.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-[13px] font-semibold text-red">
        {errors.length} ligne(s) ignorée(s)
      </p>
      <ul className="mt-1 space-y-0.5">
        {errors.map((e, i) => (
          <li key={i} className="text-[13px] text-sub">
            Ligne {e.row} : {e.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- Stores ---

function StoresImportCard() {
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [report, setReport] = useState<{ created: number; errors: RowError[] } | null>(null)

  const bulk = trpc.admin.stores.bulkCreate.useMutation({
    onSuccess: async (res) => {
      setReport(res)
      await utils.admin.stores.list.invalidate()
    },
  })

  function handleFile(file: File) {
    setParseError(null)
    setReport(null)
    void parseCsv(
      file,
      (rows) => {
        if (inputRef.current) inputRef.current.value = ''
        bulk.mutate(rows)
      },
      (message) => {
        if (inputRef.current) inputRef.current.value = ''
        setParseError(message)
      },
    )
  }

  return (
    <div className={SECTION}>
      <h2 className="text-[14px] font-semibold text-ink">Import CSV de magasins</h2>

      <div className="mt-3">
        <Legend columns={STORE_COLUMNS} />
      </div>

      <div className="mt-4">
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() => downloadCsv('modele_magasins.csv', buildTemplateCsv('stores'))}
        >
          <Icon name="download" size={15} />
          Télécharger le modèle CSV
        </button>
      </div>

      <FileInput
        inputRef={inputRef}
        disabled={bulk.isPending}
        parseError={parseError}
        onFile={handleFile}
      />

      {bulk.isError && (
        <p className="mt-3 text-[13px] text-red">{bulk.error.message}</p>
      )}

      {report && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[14px] font-medium text-ink">
            ✅ {report.created} magasin(s) créé(s)
          </p>
          <ErrorsList errors={report.errors} />
        </div>
      )}
    </div>
  )
}

// --- Users ---

function UsersImportCard() {
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [report, setReport] = useState<{ created: CreatedUser[]; errors: RowError[] } | null>(
    null,
  )

  const bulk = trpc.admin.users.bulkCreate.useMutation({
    onSuccess: async (res) => {
      setReport(res)
      await utils.admin.users.list.invalidate()
    },
  })

  function handleFile(file: File) {
    setParseError(null)
    setReport(null)
    void parseCsv(
      file,
      (rows) => {
        if (inputRef.current) inputRef.current.value = ''
        bulk.mutate(rows)
      },
      (message) => {
        if (inputRef.current) inputRef.current.value = ''
        setParseError(message)
      },
    )
  }

  return (
    <div className={SECTION}>
      <h2 className="text-[14px] font-semibold text-ink">Import CSV d&apos;utilisateurs</h2>

      <div className="mt-3">
        <Legend
          columns={USER_COLUMNS}
          note="Le mot de passe est généré automatiquement et affiché après l'import — pensez à le communiquer à l'utilisateur."
        />
      </div>

      <div className="mt-4">
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() => downloadCsv('modele_utilisateurs.csv', buildTemplateCsv('users'))}
        >
          <Icon name="download" size={15} />
          Télécharger le modèle CSV
        </button>
      </div>

      <FileInput
        inputRef={inputRef}
        disabled={bulk.isPending}
        parseError={parseError}
        onFile={handleFile}
      />

      {bulk.isError && (
        <p className="mt-3 text-[13px] text-red">{bulk.error.message}</p>
      )}

      {report && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[14px] font-medium text-ink">
            ✅ {report.created.length} utilisateur(s) créé(s)
          </p>

          {report.created.length > 0 && (
            <div className="mt-3 rounded-[12px] border border-line bg-surface p-4">
              <p className="text-[13px] font-medium text-redink">
                Les mots de passe ci-dessous ne sont affichés qu&apos;une seule fois.
                Téléchargez-les ou communiquez-les maintenant.
              </p>
              <div className="mt-3 overflow-hidden rounded-[10px] border border-line bg-card">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-surface">
                      <th className="px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                        Email
                      </th>
                      <th className="px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                        Mot de passe
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.created.map((u) => (
                      <tr key={u.email} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-[13px] text-ink">{u.email}</td>
                        <td className="px-3 py-2 font-mono text-[13px] text-ink">
                          {u.password}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={() =>
                    downloadCsv('identifiants_crees.csv', toCredentialsCsv(report.created))
                  }
                >
                  <Icon name="download" size={15} />
                  Télécharger les identifiants (CSV)
                </button>
              </div>
            </div>
          )}

          <ErrorsList errors={report.errors} />
        </div>
      )}
    </div>
  )
}
