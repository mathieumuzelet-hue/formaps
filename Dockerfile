# syntax=docker/dockerfile:1

# ---- deps: install full dependency tree (cached on lockfile) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: produce .next/standalone ----
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# The db client throws at import time if DATABASE_URL is unset, and `next build`
# evaluates server modules while collecting page data. Provide a placeholder so
# the module loads — pages are dynamic (auth/tRPC) and do not query at build.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
# auth.ts throws at import time if AUTH_SECRET is unset, and `next build`
# evaluates server modules. Placeholder only — the real secret is set at runtime.
ENV AUTH_SECRET=build-placeholder-secret
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: slim runtime image ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# Non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# Next.js standalone server + assets.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Boot-time migrator: SQL files + the ESM script.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# The standalone trace may not include the drizzle-orm migrator submodule nor
# the `postgres` driver (only used by the boot migrator, not the traced server
# graph in some cases). Overlay both full packages so `scripts/migrate.mjs`
# resolves them reliably at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# Répertoire des PDF uploadés. Créé et possédé par nextjs:nodejs AVANT `USER
# nextjs` : un volume nommé vierge hérite de l'ownership du point de montage à
# son premier montage → écrivable par l'uid 1001.
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000

# BusyBox wget; 127.0.0.1 (not localhost) to avoid IPv6-first resolution.
HEALTHCHECK --interval=30s --timeout=4s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Run migrations, bootstrap the admin (env-driven, idempotent), then start the
# standalone server. Fail loud if migrate fails. `exec` makes node the shell's
# replacement process so Dokploy's SIGTERM reaches the server (graceful stop
# instead of the 10s timeout → SIGKILL).
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/bootstrap-admin.mjs && exec node server.js"]
