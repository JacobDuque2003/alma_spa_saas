# Dedicated image for the Alma Spa backup cron job.
#
# The main API service (alma_spa) builds via Nixpacks; this Dockerfile is
# consumed ONLY by the Railway service that runs `npm run backup:run` on
# a cron schedule. Kept separate so the frontend/backend/backup services
# can each pick the right builder without interfering with each other.
#
# Railway config for the backup service:
#   Dockerfile Path:  scripts/backup/Dockerfile
#   Root Directory:   (leave blank — build context is the repo root)
#   Start Command:    npm run backup:run
#   Schedule:         0 8 * * *   (UTC = 03:00 America/Guayaquil)
#   Variables:        DATABASE_URL, GCS_BUCKET, GCS_SERVICE_ACCOUNT_KEY

FROM node:20-slim

# Install postgresql-client-18 from the official PGDG apt repo. Older
# pg_dump cannot dump a PostgreSQL 18 server, so the version has to match
# the Railway managed database (PG18). node:20-slim is Debian bookworm.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-18; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version

WORKDIR /app

# Install production deps only. --ignore-scripts skips Prisma's postinstall
# (schema is not copied; the backup script does not use Prisma at all —
# it only needs @google-cloud/storage from the runtime deps).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# The backup script + its two helpers. Nothing else from src/ is needed.
COPY scripts/backup ./scripts/backup

CMD ["node", "scripts/backup/run.js"]
