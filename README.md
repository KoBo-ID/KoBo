# KoBo

[![CI](https://github.com/KoBo-ID/KoBo/actions/workflows/ci.yml/badge.svg)](https://github.com/KoBo-ID/KoBo/actions/workflows/ci.yml)

KoBo is a student-first rental app for *kos* (Indonesian boarding houses). Students search by campus, take a free survey visit, book a room, pay online and get an official *kuitansi* (receipt). Owners get a free dashboard with a live room board, invoices, manual payments, reviews and photos. The whole interface is in Indonesian.

**Live demo:** `https://kobo.example` (placeholder, replace after the first deploy)

## Contents

[Try it in 60 seconds](#try-it-in-60-seconds) · [Features](#features) · [Stack](#stack) · [Architecture](#architecture) · [Project layout](#project-layout) · [Run it locally](#run-it-locally) · [Configuration](#configuration) · [Commands](#commands) · [Testing](#testing) · [Deploy](#deploy) · [Troubleshooting](#troubleshooting) · [Documentation](#documentation) · [Known limitations](#known-limitations)

## Try it in 60 seconds

Open the site, press **Masuk**, and use a demo login. No registration or email needed.

| Account | Button | What to try |
|---|---|---|
| Demo student (campus-verified) | **Masuk sebagai Demo Mahasiswa** | open a kos, **Ajukan Sewa & Bayar**, then **Simulasikan Pembayaran**; the booking becomes active in *Kos Saya* with a kuitansi; schedule a free survey visit; write a review for a stay |
| Demo owner | **Masuk sebagai Demo Pemilik** | room board and **Tandai Lunas**, add or edit a kos, upload photos, edit rooms, reply to reviews, complete survey visits |

Demo data resets every night at 03:30 WIB, or on demand with **Reset data demo** in the demo banner. A reset only touches demo-owned data; real users' data is left alone. Demo accounts cannot change their password or email, or delete their account.

## Features

**Students**
- Search by place or campus, with filters (gender, price, student discount, free survey) and a map. Filters live in the URL, so a search link is shareable.
- Kos detail: photos, rooms with live availability, facilities, house rules and penalties, places nearby, ratings and reviews.
- Free survey visits: pick a day and a time slot.
- Booking and checkout with a server-computed price (rent + application fee − student discount). The room is held for 24 hours while payment is pending; two people can never book the same room.
- Payments with a gateway-shaped flow (virtual account or QRIS instructions, a signed webhook, an in-app simulator).
- *Kos Saya*: rentals, monthly invoices, kuitansi, surveys and reviews.
- Student discount through **campus-email verification**: submit an `.ac.id` address on your profile and click the emailed link.
- Email and password accounts with email verification and password reset.

**Owners** (free)
- Room board with derived status (Lunas, Jatuh Tempo, Menunggak, Kosong, Booking), dashboard totals and a survey-visits panel.
- Add, edit and delete kos and rooms; upload and reorder photos (resized in the browser).
- Record manual (cash or transfer) payments with **Tandai Lunas**, end a tenancy, send a WhatsApp reminder.
- Printable kuitansi for every payment (`/kuitansi/:receiptNo`, **Save as PDF** from the print dialog).
- Review inbox with replies. A public owner profile page.

**Under the hood:** double-booking prevented by a database constraint, idempotent payment webhook, expired holds read as vacant without a cleanup job, due dates compared in WIB (Asia/Jakarta), role checks from the session and ownership (never from a client flag).

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, react-router 7, TanStack Query, tRPC client, Leaflet, three.js (hero scene) |
| Backend | Node 24, Hono, tRPC 11, better-auth, Zod, croner |
| Database | PostgreSQL 18 (production), Prisma 7 (pinned `>=7.5 <8`) |
| Storage and email | Cloudflare R2 (photos, backups), Resend |
| Tests | Vitest, fast-check, Playwright |
| Delivery | npm workspaces, Docker, GitHub Actions, GHCR, Cloudflare Tunnel |

## Architecture

```
 browser --HTTPS--> Cloudflare edge --(tunnel)--> api container (Node 24, Hono)
     |                                              |- GET  /*          SPA with index.html fallback
     |                                              |- ALL  /api/trpc/* tRPC (domain API)
     |                                              |- ALL  /api/auth/* better-auth (email + password, demo logins)
     |                                              |- POST /api/webhooks/payment (HMAC, idempotent)
     |                                              |- GET  /health     SELECT 1
     |                                              |- outbox drain (15 s) + demo reset (03:30 WIB)
     |                                              '- postgres 18
     '--presigned PUT--> Cloudflare R2 (public photo bucket)           Resend (email)
```

One container serves the SPA and the API on the same origin, so cookies are first-party and the API needs no CORS. The reasons behind each choice are in [`docs/adr/`](docs/adr/).

## Project layout

```
KoBo/
├─ frontend/          Vite SPA (react-router library mode). Pages, components, styles.
├─ backend/           Hono + tRPC server, Prisma schema and migrations, seed, tests
│  ├─ src/            app.ts (routes), trpc/ (procedures), auth.ts, payments.ts, outbox.ts, storage.ts, db/
│  ├─ prisma/         schema.prisma + migrations (partial indexes are hand-written SQL)
│  ├─ tests/          integration/, concurrency/, contract/ (real R2, skipped without credentials)
│  ├─ deploy/         deploy.sh, backup/, RUNBOOK.md
│  ├─ Dockerfile, docker-compose.yml (dev), docker-compose.prod.yml
│  └─ .env.example
├─ packages/shared/   @kobo/shared: pure domain logic (status, pricing, geo, WIB dates), Zod schemas, types
├─ e2e/               Playwright smoke and money-flow suites
├─ scripts/           bundle-size gate
├─ docs/adr/          architecture decision records
└─ notes/             product spec, competitor research, full technical spec
```

`@kobo/shared` has three entry points on purpose: `/types` (free at runtime), `/domain` (no Zod) and `/schemas` (Zod). This keeps Zod out of the landing-page bundle.

## Run it locally

### Prerequisites

- **Node.js 24+** and npm 10+ (`node -v`)
- **PostgreSQL**, either through Docker (recommended) or an existing install (17 or newer)
- **Git**. Docker is optional; on Windows, Docker Desktop needs WSL2 (`wsl --install`, then reboot)

Run every command from the **repository root** unless it says otherwise.

### 1. Install

```bash
git clone https://github.com/KoBo-ID/KoBo.git
cd KoBo
npm install            # installs all workspaces from the single root lockfile
cp backend/.env.example backend/.env
```

`backend/.env` is git-ignored. The defaults work for the Docker setup below; set a real `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `PAYMENT_WEBHOOK_SECRET` (`openssl rand -hex 32`) for anything shared. Resend and R2 settings can stay empty in development (see [Configuration](#configuration)).

### 2. Start Postgres

**Option A: Docker (recommended)**

```bash
docker compose -f backend/docker-compose.yml up -d
docker compose -f backend/docker-compose.yml ps     # wait until both show "healthy"
```

| Container | Host port | Databases | Data |
|---|---|---|---|
| `postgres` (dev) | **5434** | `kobo` | persistent volume |
| `postgres-test` | **5433** | `kobo_test`, `kobo_shadow`, `kobo_e2e` | in memory, wiped on restart (migrations re-apply on every test run) |

The ports match `backend/.env.example`. Port 5434 is used for dev so it never collides with a Postgres you already run on 5432.

**Option B: a Postgres you installed yourself**

Create the role and four databases on any server and port (replace `<port>`; you will be asked for the `postgres` password):

```bash
psql -U postgres -h localhost -p <port> -c "CREATE ROLE kobo LOGIN PASSWORD 'kobo' CREATEDB;"
createdb -U postgres -h localhost -p <port> -O kobo kobo
createdb -U postgres -h localhost -p <port> -O kobo kobo_test
createdb -U postgres -h localhost -p <port> -O kobo kobo_shadow
createdb -U postgres -h localhost -p <port> -O kobo kobo_e2e
```

Then edit `backend/.env` so `DATABASE_URL`, `TEST_DATABASE_URL` and `SHADOW_DATABASE_URL` use your host and port. For the e2e suite also set `E2E_DATABASE_URL` in your shell (default `postgresql://kobo:kobo@localhost:5433/kobo_e2e`).

On Windows the installed service may be stopped; start it from an admin PowerShell with `Start-Service postgresql-x64-17`.

### 3. Create the schema and demo data

```bash
npm run db:deploy -w backend    # applies the existing migrations
npm run db:seed                 # demo kos, owners, tenants and reviews (WIPES the dev database first)
```

Use `db:deploy`, not `db:migrate`. `db:migrate` is `prisma migrate dev`, which is for *authoring* a new migration and needs the shadow database.

### 4. Run the app (two terminals)

```bash
npm run dev:server              # API on http://localhost:3000   (check: /health)
npm run dev -w frontend         # app on http://localhost:5173   (proxies /api to :3000)
```

Open **http://localhost:5173** and use the demo logins from the top of this file.

### 5. Things to try

- **Demo student:** search, open a kos, **Ajukan Sewa & Bayar**, **Simulasikan Pembayaran**, then *Kos Saya* and the kuitansi.
- **Demo owner:** *Papan Okupansi* → **Tandai Lunas**; *Kelola Properti Kos* → add a kos, upload photos, edit a room; *Ulasan & Rating* → reply.
- **Your own account:** register, then verify. With no `RESEND_API_KEY`, every email is **printed in the API terminal** (verification, password reset, campus verification) instead of being sent. Copy the link into the browser.
  - After clicking a verification link in development you land on a blank page at `localhost:3000`. That is expected (the SPA is served from :5173 in dev). The email is verified and you are signed in; just open `http://localhost:5173`.
- **Student discount:** on your profile page (`/profile`), submit an `.ac.id` address and open the link from the console.
- **Become an owner:** *Daftarkan diri sebagai pemilik* on your profile page or at `/owner/login`.

### Running the production build locally (optional)

One process serves both the API and the built app, exactly as in production:

```bash
npm run build
# PowerShell:
$env:NODE_ENV="production"; $env:ALLOW_FAKE_STORAGE="1"; npm run start -w backend
# bash:
NODE_ENV=production ALLOW_FAKE_STORAGE=1 npm run start -w backend
```

Open **http://localhost:3000**. `ALLOW_FAKE_STORAGE=1` is needed because production mode refuses to start without R2 credentials; it uses the in-memory fake instead. Do not set it on a real server.

## Configuration

All variables live in `backend/.env` (development) or `/opt/kobo/backend/.env` (production). `backend/.env.example` is the annotated template.

| Variable | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection for the app |
| `TEST_DATABASE_URL` | for tests | database wiped by `npm test` |
| `SHADOW_DATABASE_URL` | for `db:diff` / `db:migrate` | scratch database Prisma uses to compare migrations |
| `PORT` | no (3000) | API port |
| `BETTER_AUTH_URL` | yes | public origin (`https://...` in production). Secure cookies and email link targets follow it |
| `BETTER_AUTH_SECRET` | yes | signing secret, `openssl rand -base64 32` |
| `PAYMENT_WEBHOOK_SECRET` | yes | HMAC key for `POST /api/webhooks/payment`; the in-app simulator signs with it too. The server refuses to start without it |
| `RESEND_API_KEY`, `EMAIL_FROM` | production | transactional email. If the key is unset, emails are logged to the console |
| `R2_ENDPOINT`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_ACCESS_KEY_ID`, `R2_PUBLIC_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` | production | photo storage. Leave **all five** unset in development to use an in-memory fake (uploads are lost on restart). In production the server refuses to start unless all five are set |
| `E2E_DATABASE_URL`, `E2E_PORT` | no | override the e2e database and port (defaults `localhost:5433/kobo_e2e`, `3100`) |
| `BASE_URL` | no | run e2e against a live site (`npm run e2e:postdeploy`) |
| `ALLOW_FAKE_STORAGE=1` | e2e only | opts the production-mode e2e server into the fake storage. Never set in production |

Production-only variables (`POSTGRES_*`, `TUNNEL_TOKEN`, `R2_BACKUP_*`, `HEALTHCHECKS_URL`, ...) are listed in [`backend/deploy/RUNBOOK.md`](backend/deploy/RUNBOOK.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev:server` | API with auto-reload (`:3000`) |
| `npm run dev -w frontend` | Vite dev server (`:5173`) |
| `npm run db:deploy -w backend` | apply existing migrations |
| `npm run db:seed` | wipe and reseed the dev database |
| `npm run db:migrate -w backend -- --name <change>` | author a new migration (`prisma migrate dev`) |
| `npm run db:diff -w backend` | fail if `schema.prisma` and the migrations disagree |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm test` | shared and backend test suites |
| `npm run test:scripts` | tests for the destructive-migration gate |
| `npm run build` | production build of the SPA (`frontend/dist`) |
| `npm run bundle:check` | bundle-size gate (run after `build`) |
| `npm run e2e` | Playwright against the production build |
| `npm run e2e:postdeploy` | smoke tests against a live URL (`BASE_URL` required) |

## Testing

```bash
npm run typecheck
npm test
npm run db:diff -w backend          # expect: No difference detected
npm run build && npm run bundle:check
npx playwright install chromium     # once
npm run e2e                         # needs `npm run build` first; about 30 seconds
```

What each layer covers:

- **Domain tests** (`packages/shared`): pure functions written test-first, with fast-check property tests. Room status across WIB midnight, pricing and discount, receipt numbers, haversine distance, URL filter parsing.
- **Backend integration tests** (`backend/tests/integration`): tRPC procedures called against a real Postgres, resetting the database before each test (`resetDb`). Covers authorization (an owner cannot touch another owner's kos), the payment webhook (delivering it twice credits once), booking, reviews, photos, visits, the demo reset and the rate limiter.
- **Concurrency tests** (`backend/tests/concurrency`): two bookings race for one room and exactly one wins.
- **Contract test** (`backend/tests/contract/r2.test.ts`): a real R2 bucket. Skipped unless `R2_TEST_*` variables are set; CI runs it on `main` and tags only.
- **End-to-end** (`e2e/`): the production build in Chromium. Every route renders without console errors, the booking money flow, the owner money flow, sign-up and verification, reviews and photo upload. It uses its own `kobo_e2e` database and wipes it on every run. The Playwright config enables reduced motion so the WebGL hero does not saturate the CPU.
- **Bundle budget:** initial JavaScript must stay at or under 125 KB gzip and the three.js chunk at or under 140 KB. `npm run bundle:check` enforces it.

Every migration is checked for drift (`db:diff`) and for destructive statements (`DROP`, `RENAME`, `SET NOT NULL`), which need an explicit `allow-destructive` in the commit message.

## Deploy

Pushing a tag `vX.Y.Z` runs the whole pipeline: CI gates, image build, push to GHCR, then `backend/deploy/deploy.sh` on the VPS over a restricted (forced-command) SSH key. The script takes a database dump, applies migrations, starts the new container and rolls back to the previous version automatically if `/health` fails. A nightly backup goes to a private R2 bucket, with a restore check after it.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

CI runs on every push and pull request: typecheck, migration drift, destructive-migration gate, unit and integration tests, build, Playwright, bundle gate and a Docker build. See `.github/workflows/ci.yml`.

Server setup, rollback, restore, token rotation, Cloudflare and GitHub settings and the host-owner checklist are in [`backend/deploy/RUNBOOK.md`](backend/deploy/RUNBOOK.md).

> **Status:** the Docker image, compose files, workflows and deploy script are written and checked statically, but have not yet run end to end on real infrastructure. Expect small fixes on the first CI run and first deploy.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Vite fails with `ENOENT ... react-dom/index.js` | Stale dependency cache from before the workspace layout. Delete `frontend/node_modules/.vite`, run from the repo root. If it persists: remove all `node_modules` folders and run `npm install` at the root. |
| `Please make sure your database server is running at localhost:...` / `P1001` | Postgres is not running or the port in `backend/.env` is wrong. Docker: `docker compose -f backend/docker-compose.yml ps`. |
| `password authentication failed for user "kobo"` | The `kobo` role does not exist on that server (Option B step) or the password differs from the URL. |
| `database "kobo" does not exist` | A database from step 2 was not created. |
| `TEST_DATABASE_URL is not set` | `backend/.env` is missing; copy it from `.env.example`. |
| Home page shows an error with a **Coba Lagi** button | The API is not running (`npm run dev:server`) or it cannot reach the database. |
| Port 3000 or 5173 already in use | Stop the other process, or change `PORT` in `backend/.env` (and the proxy target in `frontend/vite.config.ts`). |
| Verification email never arrives | In development nothing is sent: look for the link in the API terminal, or use a demo login. |
| `Invalid origin` when signing in | You opened the API port directly or a different host. Use `http://localhost:5173` in development. |
| Server exits at startup with an `R2_*` message | Running in production mode without all five `R2_PUBLIC_*` variables. Set them (or, for e2e only, `ALLOW_FAKE_STORAGE=1`). |
| Server exits at startup about `PAYMENT_WEBHOOK_SECRET` | Add it to `backend/.env` (`openssl rand -hex 32`). |
| e2e tests time out or fail to start | Run `npm run build` first, make sure `kobo_e2e` exists, and check `E2E_DATABASE_URL`. Do not run it against a database you care about: it is wiped. |
| `docker compose` cannot connect to the daemon (Windows) | Docker Desktop is not running or WSL2 is missing: `wsl --install`, reboot, start Docker Desktop. |
| `Kamar baru saja dibooking orang lain` | Working as intended: someone, possibly you in another tab, already holds that room for 24 hours. |
| The data got messy | Click **Reset data demo** as a demo user, or run `npm run db:seed` again. |

## Documentation

- [`docs/adr/`](docs/adr/): 13 short decision records (same origin, tRPC without batching, Prisma pin and hand-written indexes, computed-on-read, better-auth and demo logins, campus email instead of KTM, payments port and simulator, email outbox, browser-side photo resize, CI to GHCR deploy, test isolation, demo reset).
- [`notes/fullstack-spec.md`](notes/fullstack-spec.md): the full technical specification and the ablation record of what was cut and why.
- [`backend/deploy/RUNBOOK.md`](backend/deploy/RUNBOOK.md): operations.
- [`CONTEXT.md`](CONTEXT.md): contributor and AI-agent guide: conventions, gotchas and the rules for fragile areas.
- [`notes/research/`](notes/research/00-index.md): competitor and market research behind the product.

## Contributing notes

- Relative imports in `backend/` and `packages/shared` must end in `.ts` (the server runs with Node's type stripping and has no build step). Frontend imports are extensionless.
- Server behaviour is written test-first. Do not hard-code seed counts in tests and do not add pixel snapshots.
- Do not touch `frontend/src/components/home/scene/` (the 3D hero) without reading [`CONTEXT.md`](CONTEXT.md): it has a hard size budget, and its loading image `frontend/src/assets/hero-poster.webp` must be recaptured from a running build after any change to it.
- Prisma stays below v8. Dependabot is configured to ignore major versions.
- The list of things deliberately left out is section 15 of the spec; please do not add them back without discussion.

## Known limitations

- Not built yet (deferred): Google sign-in, KTM photo verification with an admin queue, stored PDF kuitansi (use the print dialog's *Save as PDF*), due-date reminders, a saved-kos list.
- No server-side rendering. Link previews of a kos page (WhatsApp, social) show the generic site title.
- Payments are simulated (no business entity for a real gateway). The provider interface, signed webhook and idempotency are real, so a gateway is a drop-in later.
- After a demo reset, photos the demo owner uploaded to R2 are orphaned and receipt numbers of re-seeded payments change.
- Never click **Reset data demo** while someone else is using a demo account; they share the same data.
