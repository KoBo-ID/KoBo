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
BETTER_AUTH_SECRET=<openssl rand -base64 32>
PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 32>
# Email (unset RESEND_API_KEY and links are only logged, so set both in production)
RESEND_API_KEY=<resend key>
EMAIL_FROM=KoBo <no-reply@<domain>>
# Photos: kobo-public bucket (its own token). All five must be set, or the server refuses to start in production.
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_PUBLIC_BUCKET=kobo-public
R2_PUBLIC_ACCESS_KEY_ID=...
R2_PUBLIC_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://<photos domain>
# --- cloudflare tunnel ---
TUNNEL_TOKEN=<from Zero Trust dashboard>
# --- backups (bucket kobo-backups, its OWN token, object read+write on that bucket only) ---
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_BACKUP_BUCKET=kobo-backups
R2_BACKUP_ACCESS_KEY_ID=...
R2_BACKUP_SECRET_ACCESS_KEY=...
HEALTHCHECKS_URL=https://hc-ping.com/<uuid>
BACKUP_HOUR_UTC=20
DISK_FAIL_PCT=85
```
   Never paste `docker inspect` / `docker compose config` output anywhere: it prints every secret.
7. Make the GHCR package public once (GitHub -> Packages -> kobo -> Settings -> Change visibility), after the first CI push, so the VPS can pull without credentials.
8. First deploy: GitHub -> Actions -> CI -> Run workflow with tag `v0.1.0` (or push the tag). `deploy.sh` brings up the whole stack, including the nightly backup service.
9. Reboot test (before demo week): `sudo reboot`; confirm all four containers return and `/health` is green.

## 2. Deploy

`git tag v0.1.1 && git push origin v0.1.1`. CI gates -> image build/push -> SSH -> `deploy.sh`. It takes a lock, validates `^v[0-9]+\.[0-9]+\.[0-9]+$`, pulls, dumps to R2 `pre-deploy/`, runs `prisma migrate deploy` in a one-off container, starts the new api, polls its healthcheck for 60 s, and on failure puts the previous tag back and exits 1. Log: `/opt/kobo/backend/state/deploy.log`.
Manual: `ssh deploy@host` then `/opt/kobo/backend/deploy/deploy.sh v0.1.1`.
Destructive migrations: ship one tag after the code stops using the column, with `allow-destructive` in the commit message.

## 3. Rollback

1. Automatic: a failed health check already restores the previous tag.
2. Manual: Actions -> CI -> Run workflow -> tag = previous tag (image exists, so it only redeploys), or `/opt/kobo/backend/deploy/deploy.sh <prev tag>` (`cat /opt/kobo/backend/state/prev`).
3. Rollback runs old code on the new schema (Prisma has no down migrations). If that breaks, restore the `pre-deploy/` dump (section 4).

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
   The API container reads `R2_ENDPOINT`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_ACCESS_KEY_ID`, `R2_PUBLIC_SECRET_ACCESS_KEY` and `R2_PUBLIC_BASE_URL` (the custom domain, no trailing slash) from `.env`. If any is missing the server refuses to start in production (unless `ALLOW_FAKE_STORAGE=1`, for e2e only), so a misconfigured release fails `/health` and rolls back.
3. R2 `kobo-backups`: private, no public domain, its own API token scoped to this bucket only (Object Read & Write).
4. Lifecycle rules on `kobo-backups`: prefix `daily/` delete after 14 days; `monthly/` after 180 days; `pre-deploy/` after 30 days.
5. Healthchecks.io: check period 1 day, grace 3 h. UptimeRobot: HTTP monitor on `https://<domain>/health`.

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
