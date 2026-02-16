# ── Settle (Next.js frontend + API routes) ──────────────────────────
# Multi-stage build with pnpm workspace support

FROM node:22-alpine AS base
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
ENV NEXT_PUBLIC_MOCK_MODE=$NEXT_PUBLIC_MOCK_MODE
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CORE_WS_URL=$NEXT_PUBLIC_CORE_WS_URL
ENV NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL
ENV NEXT_PUBLIC_PUSHER_KEY=$NEXT_PUBLIC_PUSHER_KEY
ENV NEXT_PUBLIC_PUSHER_CLUSTER=$NEXT_PUBLIC_PUSHER_CLUSTER
ENV NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=$NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
ENV NEXT_PUBLIC_BLIPSCAN_URL=$NEXT_PUBLIC_BLIPSCAN_URL
RUN pnpm -C settle build

# ── Production image ────────────────────────────────────────────────
FROM node:22-alpine AS runner
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
COPY --from=builder /app/settle/src/ settle/src/
COPY --from=builder /app/pnpm-workspace.yaml pnpm-workspace.yaml
COPY --from=builder /app/package.json package.json
EXPOSE 3000
WORKDIR /app/settle
CMD ["node", "server.js"]
