# ── Core-API (Fastify backend + workers) ────────────────────────────
# Multi-stage build with pnpm workspace support
#
# Base image pinned by digest (multi-arch index). Keeps builds
# reproducible, lets the layer cache survive across Docker Hub tag
# mutations, and reduces exposure to upstream registry outages on
# warm builds. Kept in lockstep with the settle Dockerfile so both
# services pull the same Node version. Bump both together when
# refreshing.
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS base
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Install dependencies ────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/settlement-core/package.json packages/settlement-core/
COPY apps/core-api/package.json apps/core-api/
RUN pnpm install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────────
FROM deps AS builder
COPY packages/settlement-core/ packages/settlement-core/
RUN pnpm -C packages/settlement-core build
COPY apps/core-api/ apps/core-api/
COPY settle/database/migrations/ settle/database/migrations/

# ── Production image ────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/packages/settlement-core/ packages/settlement-core/
COPY --from=builder /app/apps/core-api/ apps/core-api/
COPY --from=builder /app/settle/database/migrations/ settle/database/migrations/
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/pnpm-workspace.yaml pnpm-workspace.yaml
COPY --from=builder /app/package.json package.json
EXPOSE 4010
WORKDIR /app/apps/core-api
CMD ["npx", "tsx", "src/index.ts"]
