# KoBo runbook

Stack: `cloudflared -> api (Hono + SPA) -> postgres:18`, plus `backup`. CI pushes `ghcr.io/kobo-id/kobo:<tag>` and runs
`backend/deploy/deploy.sh <tag>` on the VPS through a forced-command SSH key. Nothing listens on a host port.

## 1. One-time host setup (VPS, as root)

1. Install Docker Engine + compose plugin. Install `git` and `flock` (util-linux).
2. Create the deploy user and give it Docker access:
   `adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy`.
   Note: the `docker` group is root-equivalent. That is why the CI key is restricted to one forced command (step 4).
3. Lay out `/opt/kobo` as a clone of the repo (public, so no credentials needed):
   `git clone https://github.com/KoBo-ID/KoBo.git /opt/kobo && chown -R deploy:deploy /opt/kobo`.
   Layout (under `/opt/kobo/backend`): `docker-compose.prod.yml`, `deploy/deploy.sh`, `deploy/backup/`, `.env` (untracked), `state/` (untracked: `tag`, `prev`, `deploy.log`, `deploy.lock`).
   Ops-file changes (compose, deploy.sh, backup.sh) reach the box with `git -C /opt/kobo pull --ff-only` as `deploy`; a release alone does not update them.
4. Forced-command key. On a trusted machine: `ssh-keygen -t ed25519 -f kobo-deploy -C kobo-ci -N ""`. In `/home/deploy/.ssh/authorized_keys` (mode 600, dir 700):
   `command="/opt/kobo/backend/deploy/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... kobo-ci`
   The private key goes to the GitHub secret `DEPLOY_SSH_KEY`. Keep your own admin key separate.
5. Capture the host key for CI: `ssh-keyscan -t ed25519 <host>` on a trusted network, verify the fingerprint against `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the box, and store the line as `DEPLOY_KNOWN_HOSTS`.
6. Create `/opt/kobo/backend/.env` (`chmod 600`, owner `deploy`). Template:

```
# --- postgres (container creates the DB on first start) ---
POSTGRES_USER=kobo
POSTGRES_PASSWORD=<openssl rand -hex 24>
POSTGRES_DB=kobo
# --- api ---
DATABASE_URL=postgresql://kobo:<same password>@postgres:5432/kobo
PORT=3000
BETTER_AUTH_URL=https://<domain>
# Min 32 chars (production refuses a shorter one). Rotating it signs everyone out.
BETTER_AUTH_SECRET=<openssl rand -base64 32>
# Leave AUTH_IP_HEADERS unset: production reads cf-connecting-ip (Cloudflare Tunnel). Do NOT set x-forwarded-for here.
# Production default ON. Only DEMO_ISOLATION=0 turns it off (never do that on the live box).
DEMO_ISOLATION=1
# Mahasiswa-only rental gate; production default ON (0 disables).
REQUIRE_STUDENT_VERIFICATION=1
# Campus-account verification (set both or neither; section 13). Google reuses GOOGLE_CLIENT_ID/SECRET below.
CAMPUS_MS_CLIENT_ID=<entra app client id>
CAMPUS_MS_CLIENT_SECRET=<entra client secret>
GOOGLE_CLIENT_ID=<google oauth client id>
GOOGLE_CLIENT_SECRET=<google oauth client secret>
# Worker liveness: healthchecks.io ping base, no trailing slash. Each worker pings <base>/<worker-slug> (section 14).
HEALTHCHECKS_PING_BASE=https://hc-ping.com/<project ping key>
# Payments (PAYMENT_PROVIDER=xendit): callback token from Xendit dashboard > Webhooks; callbacks go to POST /api/webhooks/xendit
PAYMENT_PROVIDER=xendit
XENDIT_SECRET_API_KEY=<xnd_development_... in test mode>
XENDIT_CALLBACK_TOKEN=<Xendit webhook verification token>
XENDIT_BUSINESS_ID=<Xendit business id>
# Email (unset RESEND_API_KEY and links are only logged, so set both in production)
RESEND_API_KEY=<resend key>
EMAIL_FROM=KoBo <no-reply@<domain>>
# Photos. R2_ENDPOINT is shared by every bucket below (set it once). kobo-public has its own token; kobo-private (KTM
# photos, no public access, its own token) must be a DIFFERENT bucket. All eight must be set, or the server refuses to
# start in production (section 15).
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_PUBLIC_BUCKET=kobo-public
R2_PUBLIC_ACCESS_KEY_ID=...
R2_PUBLIC_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://<photos domain>
R2_PRIVATE_BUCKET=kobo-private
R2_PRIVATE_ACCESS_KEY_ID=...
R2_PRIVATE_SECRET_ACCESS_KEY=...
# --- cloudflare tunnel ---
TUNNEL_TOKEN=<from Zero Trust dashboard>
# --- backups (bucket kobo-backups, its OWN token, object read+write on that bucket only; uses R2_ENDPOINT above) ---
R2_BACKUP_BUCKET=kobo-backups
R2_BACKUP_ACCESS_KEY_ID=...
R2_BACKUP_SECRET_ACCESS_KEY=...
HEALTHCHECKS_URL=https://hc-ping.com/<uuid>
BACKUP_HOUR_UTC=20
DISK_FAIL_PCT=85
```
   Never paste `docker inspect` / `docker compose config` output anywhere: it prints every secret.
7. Make the GHCR package public once (GitHub -> Packages -> kobo -> Package settings -> Change visibility -> Public), right after the first CI push. GHCR creates it Private, and until it is public the VPS cannot pull (or run `docker login ghcr.io` as `deploy` with a read-only token).
8. GitHub variable `APP_URL` (Settings -> Environments -> Production -> Environment variables) = `https://<domain>`. Without it the CI step "Post-deploy smoke" fails. The smoke test needs seeded demo data: on a brand-new empty database `/api/health` passes but the smoke tests fail until the seed (empty DB only) or the catalogue is loaded.
9. Destructive-DDL gate: CI runs `backend/scripts/check-destructive-ddl.mjs` against `origin/main`. While the release branch is not `main`, every migration looks new, so the release commit needs `[allow-destructive]` in its message (an empty commit is enough). After the branch is merged to `main` the gate only sees new migrations. Otherwise follow section 2's destructive-migration rule.
10. First deploy: create and push the tag `v0.1.2` (see section 2); `workflow_dispatch` only works once `ci.yml` is on the default branch. `deploy.sh` brings up the whole stack, including the nightly backup service.
11. Reboot test (before demo week): `sudo reboot`; confirm all four containers return and `/api/health` is green.

## 2. Deploy

`git tag v0.1.1 && git push origin v0.1.1`. CI gates -> image build/push -> SSH -> `deploy.sh`. It takes a lock, validates `^v[0-9]+\.[0-9]+\.[0-9]+$`, pulls, dumps to R2 `pre-deploy/`, runs `prisma migrate deploy` in a one-off container, starts the new api, polls its healthcheck for 60 s, and on failure puts the previous tag back and exits 1. Log: `/opt/kobo/backend/state/deploy.log`.
Manual: `ssh deploy@host` then `/opt/kobo/backend/deploy/deploy.sh v0.1.1`.
Destructive migrations: ship one tag after the code stops using the column, with `allow-destructive` in the commit message.
After every deploy the CI "Post-deploy smoke" runs against `APP_URL`; `deploy.sh` itself only waits for the container healthcheck.

## 3. Rollback (forward-only)

Migrations are **never rolled back** (Prisma has no down migrations, and `deploy.sh` never runs one). A rollback is: redeploy the previous image, then ship a forward fix.

1. Automatic: a failed health check already restores the previous tag.
2. Manual: `/opt/kobo/backend/deploy/deploy.sh <prev tag>` on the VPS (`cat /opt/kobo/backend/state/prev`), or push/dispatch the previous tag in CI (the image exists, so it only redeploys).
3. The old code now runs on the new schema. Migrations should be additive (the destructive-DDL gate enforces the rest), so this normally works. Then fix forward: commit the fix and release a new tag; do not edit or delete an applied migration.
4. Only if the old image cannot run on the new schema: restore the `pre-deploy/` dump (section 4), which loses everything written since the deploy, so use it last.

## 4. Restore a database

1. `export KOBO_TAG=$(cat /opt/kobo/backend/state/tag); cd /opt/kobo/backend; C="docker compose -f docker-compose.prod.yml"`
2. Fetch the dump: `rclone`-style in the backup container, e.g.
   `$C run --rm --no-deps backup rclone lsf r2:kobo-backups/daily/` then
   `$C run --rm --no-deps -v /opt/kobo/backend/state:/out backup rclone copyto r2:kobo-backups/daily/<file> /out/restore.dump`
3. `$C stop api`
4. `$C exec -T postgres sh -c 'dropdb -U $POSTGRES_USER --if-exists $POSTGRES_DB && createdb -U $POSTGRES_USER $POSTGRES_DB'`
5. `$C run --rm --no-deps -v /opt/kobo/backend/state:/out backup sh -c 'pg_restore --no-owner -d $PGDATABASE /out/restore.dump'`
6. `$C up -d` and check `/health`. Delete `state/restore.dump`.
Pre-deploy dumps: same, from `pre-deploy/`. Then redeploy the old tag so code matches the schema.

## 5. Rotate the tunnel token

Cloudflare Zero Trust -> Networks -> Tunnels -> kobo -> Refresh token. Update `TUNNEL_TOKEN` in `/opt/kobo/backend/.env`, then `export KOBO_TAG=$(cat state/tag); docker compose -f docker-compose.prod.yml up -d cloudflared`. The tunnel's public hostname must point to `http://api:3000`.

## 6. Cloudflare settings

1. Security -> Bots -> Bot Fight Mode: **off** (it challenges the payment webhook and API calls on the free plan).
2. R2 `kobo-public`: public access via custom domain; CORS rule allowing `PUT` (and `HEAD`) from the app origin `https://<domain>`, headers `Content-Type, Content-Length`. Without this rule the browser's presigned PUT fails with a CORS error. Example (bucket Settings -> CORS policy):
   ```json
   [{ "AllowedOrigins": ["https://<domain>"], "AllowedMethods": ["PUT", "HEAD", "GET"], "AllowedHeaders": ["Content-Type", "Content-Length"], "MaxAgeSeconds": 3600 }]
   ```
   The API container reads `R2_ENDPOINT`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_ACCESS_KEY_ID`, `R2_PUBLIC_SECRET_ACCESS_KEY` and `R2_PUBLIC_BASE_URL` (the custom domain, no trailing slash), plus `R2_PRIVATE_BUCKET`, `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY`, from `.env`. If any is missing the server refuses to start in production (unless `ALLOW_FAKE_STORAGE=1`, for e2e only), so a misconfigured release fails the healthcheck and rolls back.
   R2 `kobo-private` (KTM photos): a different bucket from `kobo-public`, **no** public access, no custom domain, no CORS rule, its own API token scoped to this bucket only (Object Read & Write).
3. R2 `kobo-backups`: private, no public domain, its own API token scoped to this bucket only (Object Read & Write).
4. Lifecycle rules on `kobo-backups`: prefix `daily/` delete after 14 days; `monthly/` after 180 days; `pre-deploy/` after 30 days.
5. Monitoring: see section 14 (UptimeRobot or Better Stack on `/api/health`, healthchecks.io per worker). Backup check: healthchecks.io period 1 day, grace 3 h.

## 7. Railway fallback

If the VPS or its owner is unavailable: create a Railway project with a Postgres 18 plugin and a service from the image `ghcr.io/kobo-id/kobo:<tag>`; set `DATABASE_URL`, `PORT` and the app secrets from `.env`; run `npx prisma migrate deploy` as a one-off in that service; restore the newest `daily/` dump into Railway Postgres (section 4, step 5 with `pg_restore -d <railway url>`); repoint the domain. Do one timed dry run before demo week.

## 8. GitHub provisioning

Environment `production` (add required reviewers if you want a manual gate). Secrets on that environment: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` (`deploy`), `DEPLOY_KNOWN_HOSTS`. `GITHUB_TOKEN` is automatic.

## 9. Host-owner checklist

1. Automatic security updates on (`unattended-upgrades`).
2. SSH key-only: `PasswordAuthentication no`, `PermitRootLogin no`.
3. Firewall (ufw/nftables) allows inbound SSH only; the tunnel is outbound.
4. Swap enabled (1-2 GB) so a memory spike does not OOM-kill postgres.
5. NTP active (`timedatectl` shows synchronized); WIB date logic depends on it.
6. Give the team a heads-up before upgrading Docker or rebooting; run the reboot test (setup step 9) afterwards.
7. Watch disk: images and logs are capped (10 MB x 3, weekly prune), and the backup job pings Healthchecks `/fail` above `DISK_FAIL_PCT`.

## 10. R2 contract test secrets

CI runs `backend/tests/contract/r2.test.ts` (presign, PUT, HEAD, delete against a real bucket) on pushes to `main` and tags only; it is skipped everywhere else. Create a separate bucket `kobo-test` and an API token scoped to it (Object Read & Write), then add these repository secrets:

| Secret | Value |
|---|---|
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_TEST_BUCKET` | `kobo-test` |
| `R2_TEST_ACCESS_KEY_ID` | token access key id (kobo-test only) |
| `R2_TEST_SECRET_ACCESS_KEY` | token secret |

The test deletes its own object; add a lifecycle rule on `kobo-test` (delete after 1 day) as a safety net.

## 11. Vercel + Railway (legacy, until the DNS cutover)

Superseded by the VPS (sections 1-10). On the VPS leave `AUTH_IP_HEADERS` **unset**: production reads `cf-connecting-ip` from the Cloudflare Tunnel. The Railway-only override (`x-forwarded-for`, then `x-real-ip`) is no longer advice and must not be copied to the VPS `.env`; with a wrong header every client shares one rate-limit bucket.

The SPA is on Vercel; `vercel.json` rewrites `/api/*` to the Railway service, so the browser only ever talks to the Vercel origin. That origin, not the Railway URL, is `BETTER_AUTH_URL`: email links are built from it, and sign-in/up POSTs whose `Origin` is not it (or in `TRUSTED_ORIGINS`) get `403 INVALID_ORIGIN`. In production the server refuses to start with an `http://` or localhost value.

Railway service variables (in addition to `DATABASE_URL`, `BETTER_AUTH_SECRET`, `XENDIT_*`, `R2_*`):

| Variable | Value |
|---|---|
| `BETTER_AUTH_URL` | `https://<vercel-domain>` (the production domain or its custom domain; no trailing slash, no `/api`) |
| `TRUSTED_ORIGINS` | optional, comma-separated, e.g. `https://kobo-git-main-<team>.vercel.app`; only needed to sign in on preview domains |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | optional, both or neither. Google Cloud OAuth client (Web application), Authorized redirect URI `https://<vercel-domain>/api/auth/callback/google` and the same origin as Authorized JavaScript origin |
| `RESEND_API_KEY` | Resend API key (sending access is enough) |
| `EMAIL_FROM` | `KoBo <no-reply@<verified domain>>`. Never `onboarding@resend.dev`: Resend delivers it only to the account owner (others fail with 403 and the outbox row ends `FAILED`) and it lands in spam |
| `EMAIL_REPLY_TO` | optional, a mailbox someone reads |

Client IP check: better-auth accepts the header only when it holds exactly one address. If the logs show `Rate limiting could not determine a client IP` on the VPS, check that traffic really arrives through the tunnel (`cf-connecting-ip` present). The limiter is anti-abuse, not a security boundary.

Resend domain (Resend -> Domains -> Add domain; a subdomain such as `mail.<domain>` keeps the root's reputation separate). Add exactly the records the dashboard shows at your DNS host, then press Verify:

1. SPF: `TXT` on the bounce subdomain (`send.<domain>`), `v=spf1 include:amazonses.com ~all`.
2. MX on the same bounce subdomain, pointing at the `feedback-smtp.<region>.amazonses.com` host shown.
3. DKIM: `TXT` `resend._domainkey.<domain>` with the long `p=...` key.
4. DMARC: `TXT` `_dmarc.<domain>` = `v=DMARC1; p=none;` (tighten to `quarantine` once reports look clean).
5. Domain settings: turn **off** click tracking and open tracking. Rewritten tracking links and pixels hurt deliverability, and click tracking wraps links.

Smoke test (sends one real email; never in CI). With the Railway values in your shell or `backend/.env`:

```bash
npm run email:smoke -w backend -- you@example.com
```

It lists the account's domains and their status (a sending-only key cannot, and it says so), warns if `EMAIL_FROM`'s domain is not verified or is `resend.dev`, sends the real `verify-email` template with a sample 6-digit code, and prints Resend's email id or the error status and body. Check the message headers in the inbox for `spf=pass`, `dkim=pass`, `dmarc=pass`. On Railway, failed sends log `[outbox] <id>: verify-email to *@<domain> failed (attempt n/5): Resend responded <status>: <body>`, and startup warns about a `resend.dev` sender.

Requeue failed email (`EmailOutbox`, enum `OutboxStatus` = `PENDING | SENT | FAILED`). Links are baked into `payload.url` at enqueue time, so first fix the origin of rows queued under a wrong `BETTER_AUTH_URL`. Do not requeue `verify-email` (a 6-digit code valid 10 minutes, no link) or `reset-password` (token valid one hour) rows: ask the user to press resend instead. `campus-email` is also a code (no link); `waitlist-offer` links last until the offer deadline.

```sql
-- inspect
SELECT template, status, attempts, count(*) FROM "EmailOutbox" GROUP BY 1, 2, 3 ORDER BY 1, 2;
-- rewrite a wrong origin (e.g. localhost) in links that do not expire
UPDATE "EmailOutbox"
SET payload = jsonb_set(payload, '{url}', to_jsonb(replace(payload->>'url', 'http://localhost:5173', 'https://<vercel-domain>')))
WHERE status = 'FAILED' AND template NOT IN ('verify-email', 'reset-password') AND payload->>'url' LIKE 'http://localhost%';
-- requeue; the worker picks them up within 15 s
UPDATE "EmailOutbox"
SET status = 'PENDING', attempts = 0, "nextAttemptAt" = now()
WHERE status = 'FAILED' AND template NOT IN ('verify-email', 'reset-password');
```

## 12. Location catalogue (regions, campuses, places)

Reference data for the nearby-places list, region search and nationwide campus search (ADR 0016). Migrations create the tables empty; a one-off job loads the data. **Current target: Railway** (step-by-step in the DevOps deploy guide, section 4). VPS steps are not written yet: do them when the VPS becomes the target.

Any target, same job (run from a checkout with Node 24 and `npm ci`; the API image does not contain `backend/scripts` or `backend/data`, and the 384m limit rules out running it there):

```bash
cd backend
export DATABASE_URL=<public connection string of the target database>
npm run catalog:import -- all data/catalog --dry-run   # validates, writes nothing
npm run catalog:import -- all data/catalog             # regions, campuses, then every places file
npm run catalog:backfill                                # region + nearby places for existing kos
npm run catalog:rollback -- list                        # expect 4 active versions
```

The import is repeatable: if it fails, run it again. Rollback: `npm run catalog:rollback -- <regions|places|campuses> <older file>`. Operators: `npm run places:approve -- list|approve <id>|reject <id>`.


## Cutover from Railway and Vercel (draft, 2026-10-28)

Full research, sizing, cost table, migration plan, rollback and the 11-point patch list: `notes/implementation/2026-10-28/research/R5-vps-deployment.md`. Nothing here has been run. Summary of what the runbook above already covers and what is still missing:

- Already designed: cloudflared tunnel, GHCR images, forced-command SSH key, `deploy.sh` with a pre-deploy dump and automatic rollback, nightly backup to R2.
- Still to do before cutover: provision the VPS (about 2 vCPU / 4 GB), restore-drill a backup on it, rotate every secret that appears in `notes/devops-deploy.md`, point DNS with a low TTL, keep Railway running until the drill passes, then switch and watch `/api/health`.
- Known gap: `deploy.sh` recreates the single api container, so each deploy has a few seconds of downtime; the outbox worker was not checked for running with two replicas.
- New env flag: `REQUIRE_PROFILE_CONSENTS` (default on in production; set `0` only to turn the emergency-contact and terms gate off). WhatsApp reminders only log to the console until a provider and keys are configured.

## 13. Campus OIDC and Google consent (production setup)

Campus verification uses the callback `https://<domain>/api/auth/campus-idp/callback` (Google sign-in itself uses `https://<domain>/api/auth/callback/google`). Add the exact URI, no trailing slash.

- **Microsoft Entra**: register the app as multi-tenant ("Accounts in any organizational directory") in a tenant **KoBo owns**, never inside a campus tenant or a personal tenant. Redirect URI (Web) as above. Create a client secret (note its expiry date in the calendar; the maximum is 24 months) and set `CAMPUS_MS_CLIENT_ID` + `CAMPUS_MS_CLIENT_SECRET` (both or neither). Do **publisher verification** (Microsoft Partner Network ID linked to the app) so other tenants' users are not blocked by the "unverified" consent wall; without it many campus tenants refuse consent. The app only reads `tid` + `oid`: no email scope, no Graph.
- **Google**: Google Auth Platform -> Audience -> **Publish app** (while in Testing only listed test users can sign in). Authorized origins: `https://<domain>`; redirect URIs: the sign-in callback and the campus-idp callback above. Scopes stay `openid`, `email`, `profile`.
- Check: `curl -s "https://<domain>/api/trpc/auth.providers"` lists the providers that are configured.

## 14. Monitoring

No paid APM. Two free layers:

1. **Uptime**: UptimeRobot (or Better Stack) HTTP check on `https://<domain>/api/health`, 5-minute interval, alert to a channel the team reads. `/api/health` returns JSON (`ok`, `status`, `db`, `workers`). It answers 503 only when the database is down; a stale worker makes `status: "degraded"` but still 200, so this monitor alerts on app/DB outages and the worker pings below cover stalled workers.
2. **Worker pings**: set `HEALTHCHECKS_PING_BASE` (healthchecks.io project ping base URL, no trailing slash, optional). Each background worker pings `<base>/<worker-slug>` after a successful run; create one healthchecks.io check per worker slug: `outbox`, `waitlist`, `payments`, `refunds` (period 5 min, grace 5 min; pings are throttled to one per worker per minute) and the daily `demo-reset`, `student-doc-retention`, `owner-doc-retention`, `unverified-cleanup` (period 1 day, grace 3 h), and the hourly `matching-maintenance` (request expiry, chat digests, 90-day message purge; period 1 hour, grace 1 h). Two demo-only workers, `owner-auto-review` and `ktm-auto-review`, register only when `OWNER_AUTO_REVIEW_SECONDS` / `KTM_AUTO_REVIEW_SECONDS` is set (both must be empty in production), so they need no check. A stalled worker then alerts even when the site is up. The nightly backup keeps its own `HEALTHCHECKS_URL`.

## 15. Startup refusals (production)

The API exits at start (so `deploy.sh` rolls back) in these cases, besides the older ones (https `BETTER_AUTH_URL`, `RESEND_API_KEY`, R2 variables, half-set Google or Microsoft pairs, mock payments):

- `BETTER_AUTH_SECRET` is shorter than 32 characters. Fix: `openssl rand -base64 32`.
- `R2_PRIVATE_BUCKET` equals `R2_PUBLIC_BUCKET`. KTM photos must never sit in the publicly readable bucket. Also refused: only some of the three `R2_PRIVATE_*` set, or none of them in production.

Read the reason with `docker logs <api-container> 2>&1 | tail -20`. Never paste `docker inspect` output.

## 16. Operator CLIs

The production image bundles the operator CLIs. Run them in the api container, no checkout needed:

```bash
docker exec <api-container> npm run students:review -- list
docker exec <api-container> npm run places:approve -- list
```

(`approve <id>` / `reject <id>` follow the same pattern.) The catalogue import (section 12) is still a one-off job outside the 384m container.

## 17. Secret rotation

Edit `/opt/kobo/backend/.env`, then `export KOBO_TAG=$(cat state/tag); docker compose -f docker-compose.prod.yml up -d api` (one blip, section 18). Revoke the old value at the provider only after the new one works.

| Secret | How | Effect |
|---|---|---|
| `BETTER_AUTH_SECRET` | new `openssl rand -base64 32` | **signs every user out** (sessions and signed tokens become invalid); do it off-peak |
| Postgres password | `ALTER USER kobo PASSWORD '<new>'` in the postgres container, then update `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` together, recreate api and backup | api down until both match |
| R2 keys (public, private, backup) | create a new API token per bucket in Cloudflare, update the matching `R2_*_ACCESS_KEY_ID/SECRET`, recreate api (and backup), delete the old token | none if done in that order |
| `RESEND_API_KEY` | new key in the KoBo Resend team, update, recreate api, delete the old key | queued emails retry from the outbox |
| Xendit `XENDIT_SECRET_API_KEY` and `XENDIT_CALLBACK_TOKEN` | new key in the Xendit dashboard; for the token set the new webhook verification token in Settings -> Webhooks at the same moment as the `.env` change | callbacks fail between the two steps; Xendit retries |
| Google / Microsoft client secrets | add a new secret at the provider, update `.env`, recreate api, disable the old secret (Entra secrets also expire: see the calendar) | none |
| `TUNNEL_TOKEN` | section 5 | tunnel reconnects |
| SSH keys | new `ssh-keygen`, replace the line in `authorized_keys` (forced command kept), update GitHub secret `DEPLOY_SSH_KEY`, delete the old key | none |

## 18. Single-container limits (accepted, no new infra)

- Each deploy recreates the one api container: a few seconds of downtime (the tunnel returns an error page). Deploy off-peak.
- Rate limits (better-auth and the app's own) live in process memory and the campus-OIDC `usedStates` set is in memory: a restart or deploy resets all counters and forgets in-flight OIDC states (a user mid-login just retries).
- One shared `.env` holds every secret: whoever reads it, or any `docker inspect`, has all of them. Keep it `chmod 600`, owner `deploy`.
- Do not run two api replicas: the outbox and other workers are not designed for it.
- What only the owner can do before launch is in `backend/deploy/LAUNCH-CHECKLIST.md`.
