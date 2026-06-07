import { auth } from '@/server/auth'
import { runEmbedTest } from '@/server/embed-test/pipeline'
import {
  EMBED_TEST_MODEL_KEYS,
  refinePayloadSchema,
  type EmbedTestModelKey,
  type RefinePayload,
} from '@/lib/embed-test/types'

export const runtime = 'nodejs'

const MAX_SIZE = 25 * 1024 * 1024 // 25 Mo — same ceiling as the documents upload

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Banc d'essai des paramètres d'ingestion Dify. Admin uniquement.
 * Reçoit un PDF en multipart, streame la progression et le rapport en SSE.
 * AUCUN appel à Dify — l'outil est autonome (voir la spec).
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) return json({ error: 'unauthorized' }, 401)
  if (session.user.role !== 'admin') return json({ error: 'forbidden' }, 403)

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'anthropic_not_configured' }, 503)
  }

  let file: File
  let model: EmbedTestModelKey
  let refine: RefinePayload | undefined
  try {
    const form = await req.formData()
    const rawFile = form.get('file')
    if (!(rawFile instanceof File)) return json({ error: 'file_required' }, 400)
    file = rawFile
    if (file.type !== 'application/pdf') return json({ error: 'invalid_type' }, 415)
    if (file.size > MAX_SIZE) return json({ error: 'file_too_large' }, 413)

    const rawModel = form.get('model')
    if (rawModel == null || rawModel === '') {
      model = 'sonnet'
    } else if (
      typeof rawModel === 'string' &&
      (EMBED_TEST_MODEL_KEYS as readonly string[]).includes(rawModel)
    ) {
      model = rawModel as EmbedTestModelKey
    } else {
      return json({ error: 'invalid_model' }, 400)
    }

    const rawRefine = form.get('refine')
    if (rawRefine != null && rawRefine !== '') {
      if (typeof rawRefine !== 'string' || rawRefine.length > 64 * 1024) {
        return json({ error: 'invalid_refine' }, 400)
      }
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rawRefine)
      } catch {
        return json({ error: 'invalid_refine' }, 400)
      }
      const parsed = refinePayloadSchema.safeParse(parsedJson)
      if (!parsed.success) return json({ error: 'invalid_refine' }, 400)
      refine = parsed.data
    }
  } catch {
    return json({ error: 'invalid_form' }, 400)
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const encoder = new TextEncoder()

  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        if (cancelled) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        await runEmbedTest(buffer, model, emit, refine)
      } catch (err) {
        // A client disconnect makes enqueue throw mid-pipeline — not a failure.
        if (!cancelled) {
          console.error('[embed-test] run a échoué:', err)
          emit({
            type: 'error',
            code: 'internal',
            message: 'Le test a échoué de façon inattendue. Réessayez.',
          })
        }
      } finally {
        if (!cancelled) controller.close()
      }
    },
    cancel() {
      cancelled = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
