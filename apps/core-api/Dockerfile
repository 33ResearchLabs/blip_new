# ── Core-API (Fastify backend + workers) ────────────────────────────
# Multi-stage build with pnpm workspace support

FROM node:22-alpine AS base
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

# ── Production image ────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/packages/settlement-core/ packages/settlement-core/
COPY --from=builder /app/apps/core-api/ apps/core-api/
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/pnpm-workspace.yaml pnpm-workspace.yaml
COPY --from=builder /app/package.json package.json
EXPOSE 4010
WORKDIR /app/apps/core-api
CMD ["npx", "tsx", "src/index.ts"]
