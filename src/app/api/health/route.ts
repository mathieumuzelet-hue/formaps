export const runtime = 'nodejs'

// Lightweight liveness probe for Docker/Traefik. Intentionally does NOT touch
// the DB so a slow/unhealthy database doesn't 503 the web healthcheck during
// boot races — this only proves the web server is up.
export async function GET() {
  return Response.json({ ok: true })
}
