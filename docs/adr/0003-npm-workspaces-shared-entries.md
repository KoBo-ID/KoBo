# 0003. npm workspaces with three shared entry points

**Context.** Frontend and backend share types, Zod schemas and pure domain logic. Top-level `z.object()` is not reliably tree-shaken, and the landing page must import `haversineMeters` without pulling Zod into the initial chunk.

**Decision.** npm workspaces (`frontend`, `backend`, `packages/shared`). `@kobo/shared` exposes `types` (types only), `schemas` (Zod, server and lazy routes only) and `domain` (pure functions, no Zod). The server runs on Node type stripping, so relative imports in backend and shared end in `.ts`.

**Consequences.** One toolchain, no pnpm, no build step for the server. The initial bundle gate (125 KB gzip) is enforceable. Contributors must remember the `.ts` extensions.
