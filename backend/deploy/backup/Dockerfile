# Backup runner: same major as the server (pg_dump 18) plus rclone (R2 upload) and curl (Healthchecks.io).
FROM postgres:18.6@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42
RUN apt-get update \
 && apt-get install -y --no-install-recommends rclone curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY backup.sh /backup/backup.sh
RUN chmod 755 /backup/backup.sh
# The base image's entrypoint starts a server; this container only runs client tools.
ENTRYPOINT []
CMD ["/backup/backup.sh", "daemon"]
