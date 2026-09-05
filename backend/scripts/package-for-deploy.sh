#!/usr/bin/env bash
#
# Assembles a ready-to-upload two-tier directory tree for a shared-hosting deploy (Dreamhost is
# the worked example in the README, but nothing here is Dreamhost-specific -- this works for any
# Apache + PHP + MySQL shared host with SFTP/SSH access).
#
# Produces, at the repo root:
#
#   release/
#     photomap-backend/    <- upload to a private directory OUTSIDE any domain's mapped docroot,
#                              e.g. via SFTP to ~/photomap-backend/
#     domain.com/           <- upload the *contents* of this directory to the domain's mapped
#                              docroot, e.g. ~/yourdomain.com/
#
# Usage: bash backend/scripts/package-for-deploy.sh
#   (run from anywhere; paths are resolved relative to this script's own location)
#
# This script does NOT create or edit config.php with real credentials -- it copies your local
# backend/config.php if you've already created one (see backend/config.php.example), or otherwise
# ships config.php.example so you fill it in with your host's real DB credentials after upload.
# It does NOT run migrations -- see the README for the one-time `php scripts/migrate.php` step
# to run over SSH after uploading.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKEND_DIR}/.." && pwd)"
RELEASE_DIR="${REPO_ROOT}/release"

log() { echo "==> $1"; }

log "Building frontend (npm run build)"
( cd "${REPO_ROOT}" && npm run build )

log "Installing backend production dependencies (composer install --no-dev --optimize-autoloader)"
if command -v composer >/dev/null 2>&1; then
  # --ignore-platform-reqs: this packages vendor/ to ship to the target Dreamhost host, never to
  # run locally with this machine's own PHP -- so the machine running this script (a dev laptop,
  # CI runner, etc.) isn't required to have the runtime extensions (pdo_mysql/gd/curl/exif/etc)
  # that only the target host needs. Same rationale as the Docker fallback below.
  ( cd "${BACKEND_DIR}" && composer install --no-dev --optimize-autoloader --ignore-platform-reqs )
elif command -v docker >/dev/null 2>&1; then
  log "Composer not found on PATH -- falling back to running it via the official composer:2 Docker image"
  # --ignore-platform-reqs: the composer:2 image's own PHP build is a minimal one that lacks
  # this project's *runtime* extensions (pdo_mysql/gd/exif/etc, checked by composer.json's
  # `require` block) -- those are requirements of the target production host this release is
  # bound for, not of the throwaway container used here purely to resolve/download vendor/. The
  # --user flag keeps the resulting vendor/ owned by the invoking user rather than root, since
  # this bind-mounts BACKEND_DIR directly.
  docker run --rm --interactive \
    --volume "${BACKEND_DIR}:/app" \
    --user "$(id -u):$(id -g)" \
    composer:2 install --no-dev --optimize-autoloader --ignore-platform-reqs
else
  cat >&2 <<'EOF'
ERROR: Neither `composer` nor `docker` was found on PATH -- can't install backend production
dependencies.

Fix by installing ONE of the following, then re-run this script:
  - Composer (PHP's dependency manager): https://getcomposer.org/download/
  - Docker (used here as a fallback to run Composer without installing it natively):
    https://docs.docker.com/get-docker/

See backend/README.md's "Deploying to Dreamhost" section for the full deploy walkthrough.
EOF
  exit 1
fi

log "Clearing previous release/ output"
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}/photomap-backend/public"
mkdir -p "${RELEASE_DIR}/domain.com/api"

log "Staging frontend (dist/ -> release/domain.com/)"
if [ ! -d "${REPO_ROOT}/dist" ]; then
  echo "ERROR: ${REPO_ROOT}/dist not found after npm run build" >&2
  exit 1
fi
cp -a "${REPO_ROOT}/dist/." "${RELEASE_DIR}/domain.com/"
cp "${REPO_ROOT}/deploy/dreamhost/.htaccess" "${RELEASE_DIR}/domain.com/.htaccess"
cp "${REPO_ROOT}/deploy/dreamhost/api/index.php" "${RELEASE_DIR}/domain.com/api/index.php"

log "Staging backend (curated copy -> release/photomap-backend/)"
# Curated copy, NOT a raw recursive copy of backend/: this directory's non-web-reachability is
# defense-in-depth (see backend/.htaccess), not a hard guarantee, so dev-only material (tests,
# Docker files, .env*, phpunit config) is deliberately never staged into it.
cp -a "${BACKEND_DIR}/public/." "${RELEASE_DIR}/photomap-backend/public/"
cp -a "${BACKEND_DIR}/src" "${RELEASE_DIR}/photomap-backend/src"
cp -a "${BACKEND_DIR}/migrations" "${RELEASE_DIR}/photomap-backend/migrations"
cp -a "${BACKEND_DIR}/scripts" "${RELEASE_DIR}/photomap-backend/scripts"
cp -a "${BACKEND_DIR}/vendor" "${RELEASE_DIR}/photomap-backend/vendor"
cp "${BACKEND_DIR}/composer.json" "${RELEASE_DIR}/photomap-backend/composer.json"
cp "${BACKEND_DIR}/composer.lock" "${RELEASE_DIR}/photomap-backend/composer.lock"
cp "${BACKEND_DIR}/.htaccess" "${RELEASE_DIR}/photomap-backend/.htaccess"
cp "${BACKEND_DIR}/config.php.example" "${RELEASE_DIR}/photomap-backend/config.php.example"

mkdir -p "${RELEASE_DIR}/photomap-backend/storage/photos" "${RELEASE_DIR}/photomap-backend/storage/thumbnails"
touch "${RELEASE_DIR}/photomap-backend/storage/photos/.gitkeep" "${RELEASE_DIR}/photomap-backend/storage/thumbnails/.gitkeep"

if [ -f "${BACKEND_DIR}/config.php" ]; then
  log "Including your local backend/config.php in the release (already filled in)"
  cp "${BACKEND_DIR}/config.php" "${RELEASE_DIR}/photomap-backend/config.php"
else
  log "No local backend/config.php found -- shipping config.php.example only; fill it in on the host after upload"
fi

log "Sweeping release/ for hardcoded dev-only paths/URLs"
if grep -rn "/home/\|/var/www\|localhost" "${RELEASE_DIR}" \
    --exclude-dir=vendor --exclude='config.php.example' --exclude='config.php' \
    --exclude='.htaccess' 2>/dev/null; then
  echo "WARNING: possible hardcoded dev-only path/URL found above -- review before uploading." >&2
else
  log "No hardcoded dev-only paths/URLs found."
fi

log "Done. Upload release/photomap-backend/ to a private directory outside your domain's docroot,"
log "and the *contents* of release/domain.com/ to your domain's docroot. See the README's"
log "'Deploying to Dreamhost' section for the full walkthrough."
