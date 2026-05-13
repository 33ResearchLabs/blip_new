# ── Settle (Next.js frontend + API routes) ──────────────────────────
# Multi-stage build with pnpm workspace support
#
# Base image pinned by digest (multi-arch index) so:
#   1. Builds are reproducible — `node:22-alpine` is a moving tag that
#      Docker Hub reassigns when the upstream image is rebuilt.
#   2. Layer caches in build hosts (Railway, etc.) key by digest, so a
#      warm build never re-pulls the base from Docker Hub — directly
#      reduces exposure to Docker Hub auth/registry outages.
#   3. Supply-chain hygiene — no risk of a future tag retag swapping
#      out the base image under us.
# Bump procedure: see scripts/refresh-base-digest.md (or just run
# `docker pull node:22-alpine && docker images --digests`).
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS base
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Install dependencies ────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/settlement-core/package.json packages/settlement-core/
COPY settle/package.json settle/
# shamefully-hoist creates flat node_modules (no symlinks) — survives Docker COPY
RUN pnpm install --frozen-lockfile --shamefully-hoist

# ── Build settlement-core first (shared lib) ────────────────────────
FROM deps AS builder
COPY packages/settlement-core/ packages/settlement-core/
RUN pnpm -C packages/settlement-core build

# ── Build settle (Next.js) ──────────────────────────────────────────
COPY settle/ settle/
# NEXT_PUBLIC_ vars are inlined at build time
ARG NEXT_PUBLIC_MOCK_MODE=false
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CORE_WS_URL
ARG NEXT_PUBLIC_SOLANA_NETWORK=devnet
ARG NEXT_PUBLIC_SOLANA_RPC_URL
ARG NEXT_PUBLIC_PUSHER_KEY
ARG NEXT_PUBLIC_PUSHER_CLUSTER=ap2
ARG NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
ARG NEXT_PUBLIC_BLIPSCAN_URL
ARG NEXT_PUBLIC_EMBEDDED_WALLET=true
ARG NEXT_PUBLIC_ENABLE_APP_TOUR=false
# Onboarding overlay / setup card / navbar chip / trade-participation gates
# are all branched on this flag. NEXT_PUBLIC_* values are baked into the
# client bundle at build time — without this ARG, Railway's runtime
# variable for the same name never reaches the compiled JS and the entire
# feature appears off in production.
ARG NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING=false
ARG DEV_LOCK_ENABLED=true
ENV DEV_LOCK_ENABLED=$DEV_LOCK_ENABLED
ENV NEXT_PUBLIC_MOCK_MODE=false
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CORE_WS_URL=$NEXT_PUBLIC_CORE_WS_URL
ENV NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL
ENV NEXT_PUBLIC_PUSHER_KEY=$NEXT_PUBLIC_PUSHER_KEY
ENV NEXT_PUBLIC_PUSHER_CLUSTER=$NEXT_PUBLIC_PUSHER_CLUSTER
ENV NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=$NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
ENV NEXT_PUBLIC_BLIPSCAN_URL=$NEXT_PUBLIC_BLIPSCAN_URL
ENV NEXT_PUBLIC_EMBEDDED_WALLET=$NEXT_PUBLIC_EMBEDDED_WALLET
ENV NEXT_PUBLIC_ENABLE_APP_TOUR=$NEXT_PUBLIC_ENABLE_APP_TOUR
ENV NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING=$NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING
RUN pnpm -C settle build

# ── Production image ────────────────────────────────────────────────
# Same digest as the `base` stage above — Docker reuses the already-
# pulled layers, so this is effectively free in the layer cache.
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/packages/settlement-core/ packages/settlement-core/
COPY --from=builder /app/settle/.next/ settle/.next/
COPY --from=builder /app/settle/public/ settle/public/
COPY --from=builder /app/settle/server.js settle/server.js
COPY --from=builder /app/settle/websocket-server.js settle/websocket-server.js
COPY --from=builder /app/settle/package.json settle/package.json
COPY --from=builder /app/settle/next.config.ts settle/next.config.ts
COPY --from=builder /app/settle/tsconfig.json settle/tsconfig.json
COPY --from=builder /app/settle/src/ settle/src/
COPY --from=builder /app/pnpm-workspace.yaml pnpm-workspace.yaml
COPY --from=builder /app/package.json package.json
EXPOSE 3000
WORKDIR /app/settle
CMD ["node", "server.js"]
