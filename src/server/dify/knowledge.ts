/**
 * Server-only Dify KNOWLEDGE (dataset) API client. Distinct de l'App API
 * (client.ts) : clé dataset séparée. fetchImpl est injectable pour les tests.
 */

export const KNOWLEDGE_TIMEOUT_MS = 30_000

export class DifyKnowledgeError extends Error {
  constructor(public status: number, public body: string) {
    // Le corps tronqué est inclus dans le message : c'est ce qui est persisté
    // dans `dify_sync.error`, donc l'opérateur voit le vrai motif Dify (et pas
    // juste un code HTTP nu) sans avoir à instrumenter.
    super(`Dify knowledge API failed: ${status}${body ? ` - ${body.slice(0, 300)}` : ''}`)
    this.name = 'DifyKnowledgeError'
  }
}

/** Resolves base URL (no trailing slash/v1) + dataset key. Throws if unset. */
export function knowledgeConfig(): { base: string; datasetKey: string } {
  const apiUrl = process.env.DIFY_API_URL
  const datasetKey = process.env.DIFY_DATASET_API_KEY
  if (!apiUrl || !datasetKey) {
    throw new Error('DIFY_API_URL and DIFY_DATASET_API_KEY must be set')
  }
  const base = apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return { base, datasetKey }
}

/** Bloc `data` commun aux uploads de fichiers PDF. */
function pdfData(name: string): Record<string, unknown> {
  return { name, indexing_technique: 'high_quality', process_rule: { mode: 'automatic' } }
}

/**
 * Bloc `data` pour un CSV Q&A : `doc_form: 'qa_model'` fait parser à Dify les
 * colonnes `question,answer` en paires Q/R (mode Q&A du dataset).
 */
function qaCsvData(name: string): Record<string, unknown> {
  return { name, indexing_technique: 'high_quality', process_rule: { mode: 'automatic' }, doc_form: 'qa_model' }
}

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

function csvBlob(csv: string): Blob {
  return new Blob([csv], { type: 'text/csv' })
}

async function postFile(
  url: string,
  datasetKey: string,
  data: Record<string, unknown>,
  file: Blob,
  filename: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const fd = new FormData()
  fd.set('data', JSON.stringify(data))
  fd.set('file', file, filename)
  const res = await fetchImpl(url, {
    method: 'POST',
    signal: AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${datasetKey}` }, // pas de Content-Type : FormData gère le boundary
    body: fd,
  })
  if (!res.ok) throw new DifyKnowledgeError(res.status, await res.text().catch(() => ''))
  return res.json().catch(() => ({}))
}

/**
 * Crée un document Q&A en uploadant un CSV `question,answer` via create-by-file
 * avec `doc_form: 'qa_model'`. C'est la voie d'ingestion Q&A supportée par Dify :
 * l'API `segments` sur un dataset `qa_model` renvoie 404. Même format que l'export
 * FAQ Builder validé manuellement.
 */
export async function createQaCsvDocument(args: {
  datasetId: string
  name: string
  csv: string
  fetchImpl?: typeof fetch
}): Promise<{ documentId: string }> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  const out = (await postFile(
    `${base}/v1/datasets/${args.datasetId}/document/create-by-file`,
    datasetKey, qaCsvData(args.name), csvBlob(args.csv), args.name, fetchImpl,
  )) as { document?: { id?: string } }
  const documentId = out.document?.id
  if (!documentId) throw new DifyKnowledgeError(200, 'create-by-file: missing document id')
  return { documentId }
}

/** Remplace le contenu d'un document Q&A existant par un nouveau CSV. */
export async function updateQaCsvDocument(args: {
  datasetId: string
  documentId: string
  name: string
  csv: string
  fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  await postFile(
    `${base}/v1/datasets/${args.datasetId}/documents/${args.documentId}/update-by-file`,
    datasetKey, qaCsvData(args.name), csvBlob(args.csv), args.name, fetchImpl,
  )
}

export async function createDocumentByFile(args: {
  datasetId: string; name: string; bytes: Uint8Array; fetchImpl?: typeof fetch
}): Promise<{ documentId: string }> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  const out = (await postFile(
    `${base}/v1/datasets/${args.datasetId}/document/create-by-file`,
    datasetKey, pdfData(args.name), pdfBlob(args.bytes), args.name, fetchImpl,
  )) as { document?: { id?: string } }
  const documentId = out.document?.id
  if (!documentId) throw new DifyKnowledgeError(200, 'create-by-file: missing document id')
  return { documentId }
}

export async function updateDocumentByFile(args: {
  datasetId: string; documentId: string; name: string; bytes: Uint8Array; fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  await postFile(
    `${base}/v1/datasets/${args.datasetId}/documents/${args.documentId}/update-by-file`,
    datasetKey, pdfData(args.name), pdfBlob(args.bytes), args.name, fetchImpl,
  )
}

export async function deleteDocument(args: {
  datasetId: string
  documentId: string
  fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  const res = await fetchImpl(`${base}/v1/datasets/${args.datasetId}/documents/${args.documentId}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${datasetKey}` },
  })
  if (!res.ok) throw new DifyKnowledgeError(res.status, await res.text().catch(() => ''))
}
