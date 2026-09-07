#!/usr/bin/env bash
#
# Builds a release (via package-for-deploy.sh) and then either automates the upload+migrate
# step over SSH, or prints a concrete numbered manual checklist -- depending on whether a
# fully-populated, key-auth-only deploy.config.json is present at the repo root.
#
# Usage: bash backend/scripts/deploy.sh
#   (also reachable as `npm run deploy` from the repo root)
#
# Config: copy deploy.config.example.json (repo root) to deploy.config.json (gitignored, never
# committed) and fill in real values. Requires `jq` (already a documented smoke-test.sh
# dependency) to parse it, and `rsync`/`ssh` (falling back to `scp` if rsync isn't on PATH) to
# transfer/execute -- no new language runtime dependency.
#
# SECURITY: password-based automation is deliberately never implemented -- the automated path
# only runs when sshKeyPath points to a readable private key file. If you only have password
# auth to your host, use the manual fallback instructions this script prints instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKEND_DIR}/.." && pwd)"
RELEASE_DIR="${REPO_ROOT}/release"
CONFIG_FILE="${REPO_ROOT}/deploy.config.json"

log() { echo "==> $1"; }

log "Building release (bash backend/scripts/package-for-deploy.sh)"
bash "${SCRIPT_DIR}/package-for-deploy.sh"

print_manual_fallback() {
  local backend_path="${1:-~/photomap-backend}"
  local frontend_path="${2:-~/yourdomain.com}"
  local migrate_cmd="${3:-cd ~/photomap-backend && php scripts/migrate.php}"
  cat <<EOF

==> No fully-configured key-auth deploy.config.json found -- here is the manual deploy checklist:

  1. Upload release/photomap-backend/ via SFTP to a private directory outside your domain's
     docroot, e.g. ${backend_path}/
  2. Upload the *contents* of release/domain.com/ via SFTP to your domain's docroot, e.g.
     ${frontend_path}/
  3. Copy backend/config.php.example to config.php inside the uploaded backend directory (if
     you haven't already) and fill in your host's real DB credentials, APP_SECRET, and
     STORAGE_PATH.
  4. SSH in and run the migration command, e.g.: ${migrate_cmd}
  5. Load your domain in a browser and confirm /, /share/:token, and an upload/share round-trip
     all work.

See README.md's "Deploying to a shared host" section for the full walkthrough.
EOF
}

if [ ! -f "${CONFIG_FILE}" ]; then
  print_manual_fallback
  exit 0
fi

log "Found deploy.config.json -- enforcing chmod 600 (may contain SSH credentials)"
chmod 600 "${CONFIG_FILE}"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: deploy.config.json found but jq is not installed -- cannot parse it." >&2
  echo "Install jq (https://jqlang.github.io/jq/) and re-run, or delete deploy.config.json to use the manual fallback." >&2
  exit 1
fi

json_field() {
  jq -r --arg key "$1" '.[$key] // empty' "${CONFIG_FILE}"
}

SSH_HOST="$(json_field sshHost)"
SSH_PORT="$(json_field sshPort)"
SSH_USER="$(json_field sshUser)"
SSH_KEY_PATH="$(json_field sshKeyPath)"
REMOTE_BACKEND_PATH="$(json_field remoteBackendPath)"
REMOTE_FRONTEND_PATH="$(json_field remoteFrontendPath)"
REMOTE_MIGRATE_COMMAND="$(json_field remoteMigrateCommand)"

# Expand a leading ~ in the key path ourselves -- not all `test -r` shells do this for us.
EXPANDED_KEY_PATH="${SSH_KEY_PATH/#\~/$HOME}"

SSH_PORT="${SSH_PORT:-22}"

if [ -z "${SSH_HOST}" ] || [ -z "${SSH_USER}" ] || [ -z "${SSH_KEY_PATH}" ] \
    || [ -z "${REMOTE_BACKEND_PATH}" ] || [ -z "${REMOTE_FRONTEND_PATH}" ]; then
  log "deploy.config.json is missing one or more required fields (sshHost/sshUser/sshKeyPath/remoteBackendPath/remoteFrontendPath)"
  print_manual_fallback "${REMOTE_BACKEND_PATH:-~/photomap-backend}" "${REMOTE_FRONTEND_PATH:-~/yourdomain.com}" "${REMOTE_MIGRATE_COMMAND:-cd ~/photomap-backend && php scripts/migrate.php}"
  exit 0
fi

if [ ! -r "${EXPANDED_KEY_PATH}" ]; then
  log "sshKeyPath (${SSH_KEY_PATH}) is not a readable file -- automated key-auth deploy is not possible"
  print_manual_fallback "${REMOTE_BACKEND_PATH}" "${REMOTE_FRONTEND_PATH}" "${REMOTE_MIGRATE_COMMAND:-cd ${REMOTE_BACKEND_PATH} && php scripts/migrate.php}"
  exit 0
fi

log "Fully configured key-auth deploy.config.json found -- automating upload + migrate"

SSH_TARGET="${SSH_USER}@${SSH_HOST}"

upload_dir() {
  local src="$1" dest="$2"
  if command -v rsync >/dev/null 2>&1; then
    log "rsync ${src} -> ${SSH_TARGET}:${dest}/"
    rsync -az -e "ssh -i ${EXPANDED_KEY_PATH} -p ${SSH_PORT}" "${src}/" "${SSH_TARGET}:${dest}/"
  else
    log "rsync not found on PATH -- falling back to scp -r for ${src} -> ${SSH_TARGET}:${dest}/"
    scp -r -i "${EXPANDED_KEY_PATH}" -P "${SSH_PORT}" "${src}/." "${SSH_TARGET}:${dest}/"
  fi
}

upload_dir "${RELEASE_DIR}/photomap-backend" "${REMOTE_BACKEND_PATH}"
upload_dir "${RELEASE_DIR}/domain.com" "${REMOTE_FRONTEND_PATH}"

if [ -n "${REMOTE_MIGRATE_COMMAND}" ]; then
  log "Running remote migrate command over SSH: ${REMOTE_MIGRATE_COMMAND}"
  ssh -i "${EXPANDED_KEY_PATH}" -p "${SSH_PORT}" "${SSH_TARGET}" "${REMOTE_MIGRATE_COMMAND}"
fi

POST_DEPLOY_COUNT="$(jq -r '(.postDeployCommands // []) | length' "${CONFIG_FILE}")"
if [ "${POST_DEPLOY_COUNT}" -gt 0 ]; then
  for i in $(seq 0 $((POST_DEPLOY_COUNT - 1))); do
    CMD="$(jq -r --argjson i "$i" '.postDeployCommands[$i]' "${CONFIG_FILE}")"
    log "Running postDeployCommand: ${CMD}"
    ssh -i "${EXPANDED_KEY_PATH}" -p "${SSH_PORT}" "${SSH_TARGET}" "${CMD}"
  done
fi

log "Done. Load your domain in a browser and confirm /, /share/:token, and an upload/share round-trip all work."
