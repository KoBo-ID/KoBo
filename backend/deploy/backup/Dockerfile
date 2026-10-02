# Backup runner: same major as the server (pg_dump 18) plus rclone (R2 upload) and curl (Healthchecks.io).
FROM postgres:18.6@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722
RUN apt-get update \
 && apt-get install -y --no-install-recommends rclone curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY backup.sh /backup/backup.sh
RUN chmod 755 /backup/backup.sh
# The base image's entrypoint starts a server; this container only runs client tools.
ENTRYPOINT []
CMD ["/backup/backup.sh", "daemon"]
