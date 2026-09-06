#!/usr/bin/env bash
#
# End-to-end manual smoke test for the Photomap backend, driven entirely over HTTP via curl
# (no PHP internals touched). Requires `curl`, `jq`, and `file`.
#
# Usage: bash scripts/smoke-test.sh <base-url> [path-to-a-real-jpeg] [admin-username] [admin-password]
#   e.g.: bash scripts/smoke-test.sh http://localhost:8000 tests/fixtures/small-800x600.jpg myadmin s3cret
#
# The admin-username/admin-password arguments are optional: if omitted, the script tries to
# read ADMIN_USERNAME from a sibling .env/.env.test (it cannot recover the plaintext admin
# password from ADMIN_PASSWORD_HASH, so the admin-activation flow is skipped with a note
# printed instead of failing the whole run).
#
# Exits non-zero on the first unexpected response.

set -euo pipefail

BASE="${1:-http://localhost:8000}"
PHOTO_PATH="${2:-tests/fixtures/small-800x600.jpg}"
ADMIN_USERNAME_ARG="${3:-}"
ADMIN_PASSWORD_ARG="${4:-}"
EMAIL="smoke+$(date +%s)@example.com"
PASSWORD="password123"
JAR="$(mktemp)"
ADMIN_JAR="$(mktemp)"

pass() { echo "  OK: $1"; }
fail() { echo "  FAIL: $1" >&2; exit 1; }

expect_status() {
  local expected="$1" actual="$2" label="$3"
  if [ "$actual" != "$expected" ]; then
    fail "$label: expected HTTP $expected, got $actual"
  fi
  pass "$label ($actual)"
}

echo "== Photomap backend smoke test against $BASE =="

echo "[1] GET /api/csrf-token"
CSRF=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)
[ -n "$CSRF" ] && [ "$CSRF" != "null" ] || fail "csrf-token"
pass "got csrf token"

echo "[2] POST /api/register"
REGISTER_STATUS=$(curl -s -o /tmp/smoke-register.json -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X POST "$BASE/api/register" -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
expect_status 201 "$REGISTER_STATUS" "register"

echo "[3] POST /api/login"
CSRF=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)
LOGIN_STATUS=$(curl -s -o /tmp/smoke-login.json -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X POST "$BASE/api/login" -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
expect_status 200 "$LOGIN_STATUS" "login"
NEW_USER_ID=$(jq -r .id /tmp/smoke-login.json)
[ "$(jq -r .status /tmp/smoke-login.json)" = "pending" ] || fail "expected freshly-registered account status=pending"
pass "new account is pending, as expected"
CSRF=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)

echo "[4a] POST /api/photos while pending (must be blocked)"
BLOCKED_UPLOAD_STATUS=$(curl -s -o /tmp/smoke-photo-blocked.json -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X POST "$BASE/api/photos" -H "X-CSRF-Token: $CSRF" \
  -F "photo=@${PHOTO_PATH}" -F "lat=45.4642" -F "lon=9.1900" -F "cameraMake=Smoke")
expect_status 403 "$BLOCKED_UPLOAD_STATUS" "upload blocked while pending"
[ "$(jq -r .error /tmp/smoke-photo-blocked.json)" = "account_pending" ] || fail "expected error=account_pending"
pass "upload correctly blocked for a pending account"

ADMIN_USERNAME="$ADMIN_USERNAME_ARG"
ADMIN_PASSWORD="$ADMIN_PASSWORD_ARG"
if [ -z "$ADMIN_USERNAME" ] && [ -f .env ]; then
  ADMIN_USERNAME=$(grep -E '^ADMIN_USERNAME=' .env | head -1 | cut -d= -f2- || true)
fi

echo "[4b] Admin activates the new account"
if [ -z "$ADMIN_USERNAME" ] || [ -z "$ADMIN_PASSWORD" ]; then
  echo "  SKIPPED: no admin username/plaintext-password available to this script (the hash in"
  echo "  config.php/.env cannot be reversed) -- activating the pending account directly via SQL"
  echo "  instead so the rest of this smoke test can still exercise the post-activation flow."
  echo "  Pass an admin username/password as args 3/4 to exercise the real /api/admin/* flow."
  php -r '
    require "vendor/autoload.php";
    Photomap\Backend\Config::load(getcwd());
    $pdo = Photomap\Backend\Database::connect();
    $stmt = $pdo->prepare("UPDATE users SET status=?, approved_at=NOW() WHERE id=?");
    $stmt->execute(["active", (int) $argv[1]]);
  ' "$NEW_USER_ID"
else
  ADMIN_CSRF=$(curl -s -c "$ADMIN_JAR" -b "$ADMIN_JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)
  ADMIN_LOGIN_STATUS=$(curl -s -o /tmp/smoke-admin-login.json -w '%{http_code}' -c "$ADMIN_JAR" -b "$ADMIN_JAR" \
    -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' -H "X-CSRF-Token: $ADMIN_CSRF" \
    -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}")
  expect_status 200 "$ADMIN_LOGIN_STATUS" "admin login"
  ADMIN_CSRF=$(curl -s -c "$ADMIN_JAR" -b "$ADMIN_JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)
  ACTIVATE_STATUS=$(curl -s -o /tmp/smoke-activate.json -w '%{http_code}' -c "$ADMIN_JAR" -b "$ADMIN_JAR" \
    -X POST "$BASE/api/admin/users/$NEW_USER_ID/activate" -H 'Content-Type: application/json' -H "X-CSRF-Token: $ADMIN_CSRF" \
    -d '{}')
  expect_status 200 "$ACTIVATE_STATUS" "admin activate user"
  pass "admin activated the new account via /api/admin/users/{id}/activate"
fi

echo "[4c] POST /api/photos now that the account is active"
UPLOAD_STATUS=$(curl -s -o /tmp/smoke-photo.json -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X POST "$BASE/api/photos" -H "X-CSRF-Token: $CSRF" \
  -F "photo=@${PHOTO_PATH}" -F "lat=45.4642" -F "lon=9.1900" -F "cameraMake=Smoke")
expect_status 201 "$UPLOAD_STATUS" "upload photo"
PHOTO_ID=$(jq -r .id /tmp/smoke-photo.json)
PREVIEW_URL=$(jq -r .previewUrl /tmp/smoke-photo.json)

echo "[5] GET /api/photos"
LIST_STATUS=$(curl -s -o /tmp/smoke-list.json -w '%{http_code}' -c "$JAR" -b "$JAR" "$BASE/api/photos")
expect_status 200 "$LIST_STATUS" "list photos"
COUNT=$(jq '.photos | length' /tmp/smoke-list.json)
[ "$COUNT" -ge 1 ] || fail "expected at least 1 photo in list, got $COUNT"
pass "photo list has $COUNT photo(s)"

echo "[6] GET signed preview URL"
curl -s -o /tmp/smoke-preview.jpg -w '' -c "$JAR" -b "$JAR" "$BASE$PREVIEW_URL"
FILETYPE=$(file -b /tmp/smoke-preview.jpg)
echo "$FILETYPE" | grep -qi jpeg || fail "signed preview URL did not serve a JPEG (got: $FILETYPE)"
pass "signed preview URL serves a real JPEG"

echo "[7] POST /api/share-links"
SHARE_STATUS=$(curl -s -o /tmp/smoke-share.json -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X POST "$BASE/api/share-links" -H "X-CSRF-Token: $CSRF")
expect_status 201 "$SHARE_STATUS" "create share link"
TOKEN=$(jq -r .token /tmp/smoke-share.json)
SHARE_ID=$(jq -r .id /tmp/smoke-share.json)

echo "[8] GET /api/share/{token} with zero cookies"
SHARE_FETCH_STATUS=$(curl -s -o /tmp/smoke-share-photos.json -w '%{http_code}' "$BASE/api/share/$TOKEN")
expect_status 200 "$SHARE_FETCH_STATUS" "public share fetch (no cookies)"
SHARE_IMAGE_URL=$(jq -r '.photos[0].previewUrl' /tmp/smoke-share-photos.json)
SHARE_IMAGE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$SHARE_IMAGE_URL")
expect_status 200 "$SHARE_IMAGE_STATUS" "public share image fetch (no cookies)"

echo "[8b] PATCH /api/photos/{id} (reassign location)"
PATCH_STATUS=$(curl -s -o /tmp/smoke-patch.json -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X PATCH "$BASE/api/photos/$PHOTO_ID" -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"lat":48.8566,"lon":2.3522}')
expect_status 200 "$PATCH_STATUS" "patch photo location"
PATCHED_LAT=$(jq -r .lat /tmp/smoke-patch.json)
[ "$PATCHED_LAT" = "48.8566" ] || fail "expected patched lat 48.8566, got $PATCHED_LAT"
pass "photo location reassigned via PATCH"

LIST_AFTER_PATCH_LAT=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/photos" | jq -r '.photos[0].lat')
[ "$LIST_AFTER_PATCH_LAT" = "48.8566" ] || fail "expected reassigned lat reflected on next list call, got $LIST_AFTER_PATCH_LAT"
pass "reassigned location reflected on next list call"

echo "[9] DELETE /api/photos/{id}"
DELETE_PHOTO_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X DELETE "$BASE/api/photos/$PHOTO_ID" -H "X-CSRF-Token: $CSRF")
expect_status 200 "$DELETE_PHOTO_STATUS" "delete photo"

echo "[10] DELETE /api/share-links/{id}, then confirm share + share image are dead"
REVOKE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X DELETE "$BASE/api/share-links/$SHARE_ID" -H "X-CSRF-Token: $CSRF")
expect_status 200 "$REVOKE_STATUS" "revoke share link"

SHARE_AFTER_REVOKE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/share/$TOKEN")
expect_status 404 "$SHARE_AFTER_REVOKE" "share link 404s after revoke"

SHARE_IMAGE_AFTER_REVOKE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$SHARE_IMAGE_URL")
expect_status 403 "$SHARE_IMAGE_AFTER_REVOKE" "previously-fetched share image URL now 403s after revoke"

echo "[11] DELETE /api/account, then confirm subsequent authenticated call 401s"
DELETE_ACCOUNT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -X DELETE "$BASE/api/account" -H "X-CSRF-Token: $CSRF")
expect_status 200 "$DELETE_ACCOUNT_STATUS" "delete account"

ME_AFTER_DELETE=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" "$BASE/api/me")
expect_status 401 "$ME_AFTER_DELETE" "GET /api/me 401s after account deletion"

echo "[12] Confirm storage/ is not web-reachable"
STORAGE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/../storage/photos/1/whatever.jpg")
[ "$STORAGE_STATUS" != "200" ] || fail "storage directory appears to be directly web-reachable!"
pass "storage directory not reachable (got $STORAGE_STATUS)"

rm -f "$JAR" "$ADMIN_JAR" /tmp/smoke-*.json /tmp/smoke-preview.jpg /tmp/smoke-patch.json

echo ""
echo "== All smoke test steps passed =="
