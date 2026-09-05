#!/usr/bin/env bash
#
# On-demand Apache/mod_rewrite routing verification against a packaged release/ artifact.
#
# `php -S` (used by the backend's own Feature test suite) does not process .htaccess at all, so
# there is otherwise zero automated coverage of the Apache-specific routing/security surface this
# deploy path depends on (SPA fallback, /api/ rewrite, directory-traversal protection). This
# script boots a stock php:8.x-apache container (mod_rewrite enabled, AllowOverride All) against
# the release/ tree produced by package-for-deploy.sh, and curls it to check the routing
# contract.
#
# This is intentionally NOT wired into `composer test`/`npm test` -- it needs Docker and is
# slower/more infrastructure-heavy than the rest of the suite. Run it manually before a Dreamhost
# deploy, or whenever routing-related files change (backend/.htaccess, deploy/dreamhost/*).
#
# Usage:
#   bash backend/scripts/package-for-deploy.sh   # first, to produce release/
#   bash deploy/dreamhost/verify-apache-routing.sh
#
# Requires: docker, curl.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RELEASE_DIR="${REPO_ROOT}/release"
CONTAINER_NAME="photomap-apache-verify-$$"
PORT="${VERIFY_PORT:-8899}"
BASE="http://127.0.0.1:${PORT}"

if [ ! -d "${RELEASE_DIR}/domain.com" ] || [ ! -d "${RELEASE_DIR}/photomap-backend" ]; then
  echo "ERROR: ${RELEASE_DIR} not found or incomplete. Run backend/scripts/package-for-deploy.sh first." >&2
  exit 1
fi

pass() { echo "  OK: $1"; }
fail() { echo "  FAIL: $1" >&2; exit 1; }

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Starting php:8-apache container against ${RELEASE_DIR}"
docker run -d --name "${CONTAINER_NAME}" \
  -p "${PORT}:80" \
  -v "${RELEASE_DIR}:/srv/release:ro" \
  php:8.3-apache \
  bash -c '
    a2enmod rewrite >/dev/null
    sed -ri "s#DocumentRoot /var/www/html#DocumentRoot /srv/release/domain.com#" /etc/apache2/sites-available/000-default.conf
    cat >> /etc/apache2/apache2.conf <<EOF
<Directory /srv/release/domain.com>
    AllowOverride All
    Require all granted
</Directory>
<Directory /srv/release/photomap-backend>
    AllowOverride All
    Require all denied
</Directory>
EOF
    apache2-foreground
  ' >/dev/null

echo "==> Waiting for Apache to accept connections"
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "${BASE}/"; then
    break
  fi
  sleep 1
done

echo "==> Running checks"

status=$(curl -s -o /tmp/verify-root.html -w '%{http_code}' "${BASE}/")
if [ "${status}" = "200" ] && grep -qi '<html' /tmp/verify-root.html; then
  pass "GET / serves the SPA index.html"
else
  fail "GET / expected 200 + HTML, got status=${status}"
fi

status=$(curl -s -o /tmp/verify-share.html -w '%{http_code}' "${BASE}/share/abcd1234")
if [ "${status}" = "200" ] && grep -qi '<html' /tmp/verify-share.html; then
  pass "GET /share/abcd1234 falls back to index.html (SPA fallback), not a 404"
else
  fail "GET /share/abcd1234 expected 200 + HTML (SPA fallback), got status=${status}"
fi

status=$(curl -s -o /tmp/verify-api.txt -w '%{http_code}' "${BASE}/api/csrf-token")
if [ "${status}" != "404" ]; then
  pass "GET /api/csrf-token is routed to the PHP backend (status=${status}, not a static-file 404)"
else
  fail "GET /api/csrf-token got a 404 -- /api/ rewrite is not dispatching to the PHP backend"
fi

asset_rel="$(cd "${RELEASE_DIR}/domain.com" && find assets -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) | head -n1)"
if [ -z "${asset_rel}" ]; then
  fail "No built asset found under release/domain.com/assets/ to test static-file serving"
fi
status=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/${asset_rel}")
if [ "${status}" = "200" ]; then
  pass "GET /${asset_rel} is served directly as a static file"
else
  fail "GET /${asset_rel} expected 200, got status=${status}"
fi

status=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "${BASE}/../photomap-backend/config.php")
if [ "${status}" != "200" ]; then
  pass "GET /../photomap-backend/config.php (traversal from the docroot) is blocked (status=${status}, not 200)"
else
  fail "GET /../photomap-backend/config.php returned 200 -- traversal protection failed"
fi

echo "==> All Apache routing checks passed."
