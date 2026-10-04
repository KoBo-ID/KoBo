# syntax=docker/dockerfile:1
#
# Build from the repo root (context bundles frontend + packages/shared + backend):
#   docker build -f backend/Dockerfile .
#
# Base image: node:24-slim == 24.21.0-slim (looked up 2026-10-02, multi-arch index digest).
# Bump tag + digest together (Dependabot's docker ecosystem does this).
ARG NODE_IMAGE=node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# ---------------------------------------------------------------- build: SPA
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
# postinstall of @kobo/server runs `prisma generate`, so the schema must exist before npm ci.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
RUN npm ci
COPY packages/shared packages/shared
COPY backend/src backend/src
COPY frontend frontend
RUN npm run build -w frontend

# ------------------------------------------------- runtime: prod deps + code
# No compile step: Node 24 strips TypeScript types natively. The server source is
# erasable-syntax only (no enums / namespaces / parameter properties) and uses explicit
# .ts import specifiers, and @kobo/shared is a symlinked workspace (real path outside
# node_modules, which strip-types requires). One less build tool, identical code in dev and prod.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# openssl: Prisma's schema engine (used by `prisma migrate deploy`) links libssl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
# Prod deps of @kobo/server only (includes the prisma CLI + schema engine, needed for migrate deploy).
# Scripts stay on: @prisma/engines downloads the schema-engine binary and postinstall runs `prisma generate`.
RUN npm ci --omit=dev -w backend --include-workspace-root=false \
 && npm cache clean --force
COPY packages/shared/src packages/shared/src
COPY backend/src backend/src
COPY --from=build /app/frontend/dist frontend/dist
RUN chown -R node:node /app
USER node
WORKDIR /app/backend
EXPOSE 3000
# Exec form: node is PID 1's child behind compose `init: true` and receives SIGTERM directly.
CMD ["node", "src/index.ts"]
