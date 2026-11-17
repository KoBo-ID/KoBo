# 0011. Tag-driven deploy with rollback, no staging

**Context.** The host is a teammate's VPS, shared and not ours to harden fully. Prisma has no down-migrations, and a leaked CI secret must not become root on the box.

**Decision.** Pushing a `vX.Y.Z` tag runs all CI gates, builds the image, pushes it to GHCR and calls `deploy.sh` over an SSH key restricted to that one forced command. The script takes a lock, dumps the database to R2, migrates, starts the new container, polls `/health` (which runs `SELECT 1`) and restores the previous tag if it fails. Destructive DDL ships one tag after the code stops using it. Nightly dumps are restore-checked. Actions are pinned to SHAs; there is no staging and no self-hosted runner.

**Consequences.** A broken release never stays live, and the only real undo is the pre-deploy dump. A rollback causes a blip of about 15 s, invisible at current traffic.
