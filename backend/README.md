# Photomap Backend (Phase 2 — Accounts)

A standalone PHP 8.x + MySQL backend for Photomap's account mode: register/login, upload
photos to server-side storage, list/delete them, create a shareable public link, and delete
the account. It has **no frontend integration** — that is Phase 3. This backend is meant to
be exercised on its own via curl or the automated test suite.

Hand-rolled router (no framework), PDO for all DB access (prepared statements only), raw
`ext-gd` for image processing, raw `ext-curl` for the Nominatim reverse-geocoding client
(behind an interface so it can be faked in tests), and images stored on disk **outside** the
web root under randomized filenames.

## Prerequisites

- PHP >= 8.1 with these extensions: `pdo_mysql`, `gd`, `exif`, `fileinfo`, `curl`,
  `mbstring`, `json`.
- A MySQL (or MySQL-compatible) server.
- [Composer](https://getcomposer.org/).

Verify GD's WebP support (uploads of WebP images require it; JPEG/PNG always work since GD
supports them unconditionally regardless of this):

```bash
php -r 'var_dump(gd_info());'
```

Look for `["WebP Support"]=> bool(true)` in the output. If it's `false`, WebP uploads will
be rejected at runtime with a clear `422 webp_unsupported` error instead of crashing —
JPEG/PNG uploads are unaffected.

Also worth checking, since it affects the practical ceiling on upload size regardless of
this app's own `MAX_UPLOAD_BYTES` setting: PHP's own `upload_max_filesize` and
`post_max_size` ini directives. If you want the full 25MB default to work, make sure both
of those ini values are at least that large:

```bash
php -r 'echo ini_get("upload_max_filesize") . " / " . ini_get("post_max_size") . "\n";'
```

## Setup

1. Install dependencies:

   ```bash
   composer install
   ```

2. Create a MySQL database and a user with access to it, e.g.:

   ```sql
   CREATE DATABASE photomap CHARACTER SET utf8mb4;
   CREATE USER 'photomap'@'localhost' IDENTIFIED BY 'change-me';
   GRANT ALL PRIVILEGES ON photomap.* TO 'photomap'@'localhost';
   ```

3. Copy `.env.example` to `.env` and fill in your database credentials, an absolute
   `STORAGE_PATH` (must live outside `public/`), and a generated `APP_SECRET`:

   ```bash
   cp .env.example .env
   php -r 'echo bin2hex(random_bytes(32));'   # paste the output as APP_SECRET
   ```

   Also set `NOMINATIM_USER_AGENT` to something that includes real contact info, per
   [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/).

4. Run migrations (idempotent — tracks applied files in a `schema_migrations` table it
   creates automatically):

   ```bash
   php scripts/migrate.php
   ```

5. Start the server:

   ```bash
   php -S localhost:8000 -t public public/index.php
   ```

The API is now reachable at `http://localhost:8000/api/...`.

## Known, documented limitations

- **Account deletion** (`DELETE /api/account`) destroys only the *current* session and
  deletes the underlying user/photos/share-link rows. It does not proactively invalidate any
  other active session for the same account elsewhere — such a session would only fail on
  its next DB-touching request, since the user row is gone. There's no cross-session store
  in this design, so this is accepted as-is for Phase 2.
- **Secure cookie flag**: the session cookie's `Secure` attribute is only set when
  `APP_ENV=production`. Plain-HTTP `php -S` (used for local dev and this test suite) cannot
  meaningfully use `Secure` cookies at all, so `APP_ENV=local` is a documented dev-only
  exception. Actual browser-side *enforcement* of `Secure` (refusing to send the cookie back
  over plain HTTP) cannot be verified in a local `php -S` setup — only that the server sends
  the attribute in the header.
- Orphan-file cleanup jobs (e.g. for files left behind by a crash mid-request) and trusting a
  reverse proxy's `X-Forwarded-For` header for the login rate limiter's IP address are both
  explicitly out of scope for this phase.

## API overview

All responses are JSON. Errors use `{"error": "<code>", "message": "..."}`. Every
state-changing endpoint (including `/api/register` and `/api/login`) requires an
`X-CSRF-Token` header matching the session's CSRF token, obtained from
`GET /api/csrf-token`.

| Method | Path | Auth | CSRF | Notes |
|---|---|---|---|---|
| GET | `/api/csrf-token` | no | no | Seeds/returns `{ csrfToken }` |
| POST | `/api/register` | no | yes | `{ email, password }` -> `201 { id, email }` |
| POST | `/api/login` | no | yes | Rate-limited; `200 { id, email }` |
| POST | `/api/logout` | yes | yes | `200 { ok: true }` |
| GET | `/api/me` | yes | no | `200 { id, email }` or `401` |
| DELETE | `/api/account` | yes | yes | Deletes account + photos + share links |
| GET | `/api/photos` | yes | no | `200 { photos: [...] }` |
| POST | `/api/photos` | yes | yes | Multipart: `photo` file + optional `lat`/`lon`/`takenAt`/`cameraMake`/`cameraModel` |
| DELETE | `/api/photos/{id}` | yes | yes | Owner-only (404 if not owner) |
| PATCH | `/api/photos/{id}` | yes | yes | `{ lat, lon }` -> updated photo JSON; owner-only (404 if not owner); allowed for any photo, not just currently-GPS-less ones |
| POST | `/api/share-links` | yes | yes | Rotates: revokes any existing active link, creates a new one |
| DELETE | `/api/share-links/{id}` | yes | yes | Soft-revoke only |
| GET | `/api/share/{token}` | no | no | Public read-only view of that account's photos |
| GET | `/api/photos/{id}/file` | signed URL | no | Full-size image bytes |
| GET | `/api/photos/{id}/thumbnail` | signed URL | no | Thumbnail image bytes |
| GET | `/api/geocode?lat=&lon=` | yes | no | Reverse-geocode via Nominatim, cached |

`thumbnailUrl`/`previewUrl` in photo JSON are short-lived, HMAC-signed URLs (15 min for the
owner context, 10 min for the share context) that are freshly regenerated on every
`/api/photos` or `/api/share/{token}` response — they are never persisted. Share-context
image URLs re-check the share link's revoked status on every fetch, so revoking a link takes
effect immediately even for URLs a client already has cached.

## CORS and cross-origin cookies (split-origin deployments only)

Same-origin deployments (the frontend dev server proxying `/api` to this backend, or the
whole-stack Docker compose with nginx proxying `/api` to this backend) never need anything in
this section — leave `CORS_ALLOWED_ORIGINS` and `SESSION_COOKIE_SAMESITE` at their defaults.

If the frontend is genuinely deployed on a different origin than this API (e.g. a static host
plus a separate PHP host), two things need to change:

- `CORS_ALLOWED_ORIGINS` — a comma-separated exact-match allow-list of frontend origins (e.g.
  `https://photos.example.com`). Matching is exact string equality only, never
  substring/suffix, so `https://evil-photomap.example` can never pass a check against an
  allow-listed `https://photomap.example`. Leaving this empty (the default) emits no CORS
  headers at all, and cross-origin browser requests will be blocked by the browser itself.
- `SESSION_COOKIE_SAMESITE=None` — cross-site `fetch()` calls (with `credentials: 'include'`)
  do not send `SameSite=Lax` cookies at all, so a split-origin deployment needs
  `SameSite=None`. Browsers reject `SameSite=None` cookies that aren't also `Secure`, so this
  also requires `APP_ENV=production` (real HTTPS) — it cannot work over plain HTTP.

## Manual curl smoke test

A full runnable copy of this walkthrough lives in `scripts/smoke-test.sh` (requires `curl`
and `jq`; run it against a freshly-migrated local server: `bash scripts/smoke-test.sh
http://localhost:8000`). The steps, spelled out:

```bash
BASE=http://localhost:8000
JAR=/tmp/photomap-smoke-cookies.txt
rm -f "$JAR"

# 1. Get a CSRF token (also seeds the session cookie).
CSRF=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)

# 2. Register.
curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/register" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"email":"smoke@example.com","password":"password123"}'

# 3. Log in (rotates the session + CSRF token).
CSRF=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)
curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"email":"smoke@example.com","password":"password123"}'
CSRF=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/csrf-token" | jq -r .csrfToken)

# 4. Upload a photo with metadata.
PHOTO=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/photos" \
  -H "X-CSRF-Token: $CSRF" \
  -F "photo=@/path/to/some.jpg" -F "lat=45.46" -F "lon=9.19")
echo "$PHOTO"
PHOTO_ID=$(echo "$PHOTO" | jq -r .id)

# 5. List photos.
curl -s -c "$JAR" -b "$JAR" "$BASE/api/photos"

# 6. Fetch the signed preview URL and confirm it serves real image bytes.
PREVIEW_URL=$(echo "$PHOTO" | jq -r .previewUrl)
curl -s -o /tmp/smoke-preview.jpg -w "%{http_code}\n" "$BASE$PREVIEW_URL"
file /tmp/smoke-preview.jpg   # should say JPEG image data

# 7. Create a share link.
SHARE=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/share-links" -H "X-CSRF-Token: $CSRF")
TOKEN=$(echo "$SHARE" | jq -r .token)
SHARE_ID=$(echo "$SHARE" | jq -r .id)

# 8. Fetch the share link and its images with ZERO cookies.
SHARE_PHOTOS=$(curl -s "$BASE/api/share/$TOKEN")
echo "$SHARE_PHOTOS"
SHARE_IMAGE_URL=$(echo "$SHARE_PHOTOS" | jq -r '.photos[0].previewUrl')
curl -s -o /dev/null -w "%{http_code}\n" "$BASE$SHARE_IMAGE_URL"   # 200, no cookies sent

# 9. Delete the photo.
curl -s -c "$JAR" -b "$JAR" -X DELETE "$BASE/api/photos/$PHOTO_ID" -H "X-CSRF-Token: $CSRF"

# 10. Revoke the share link, confirm it now 404s, and confirm the previously-fetched
#     share image URL now 403s too (revocation takes effect immediately).
curl -s -c "$JAR" -b "$JAR" -X DELETE "$BASE/api/share-links/$SHARE_ID" -H "X-CSRF-Token: $CSRF"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/share/$TOKEN"          # 404
curl -s -o /dev/null -w "%{http_code}\n" "$BASE$SHARE_IMAGE_URL"           # 403

# 11. Delete the account, and confirm a subsequent authenticated call 401s.
curl -s -c "$JAR" -b "$JAR" -X DELETE "$BASE/api/account" -H "X-CSRF-Token: $CSRF"
curl -s -o /dev/null -w "%{http_code}\n" -c "$JAR" -b "$JAR" "$BASE/api/me"  # 401

# 12. Confirm the storage directory is genuinely unreachable directly (should be a
#     connection-level 404 from `php -S`, since storage/ isn't inside -t public at all).
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/../storage/photos/1/whatever.jpg"
```

## Testing

```bash
composer install
cp .env.example .env.test   # then point it at a separate test database/schema
php scripts/migrate.php     # run once against the dev DB, and once against the test DB
                             # (e.g. DB_NAME=photomap_test php scripts/migrate.php)
composer test
```

- `tests/Unit/` — calls controller/service classes directly against a real (but truncated
  per-test) test database: CSRF logic, ownership checks, quota math (including a genuine
  multi-process concurrency test proving the row-lock serializes concurrent uploads),
  image-resize helpers, rate-limiter logic, geocode rounding/caching, signed-URL
  generation/verification (including the share-context revocation check).
- `tests/Feature/` — boots a real `php -S` subprocess per test class and drives it with curl
  over HTTP, so cookies, `Set-Cookie` headers, multipart uploads, and session persistence
  are exercised for real, not simulated in-process. The database and scratch storage
  directory are reset between tests.
- Nominatim is never called for real. `NominatimClient` implements
  `GeocodeClientInterface`; tests inject a `FakeGeocodeClient` (canned responses, records
  call count) for behavioral tests, and a tiny local raw-socket fake HTTP server for the one
  test that verifies `NominatimClient` itself sends the configured `User-Agent` header
  correctly on the wire.
- `.env.test` uses short rate-limit windows (`RATE_LIMIT_LOGIN_WINDOW_SECONDS=2`) and a tiny
  Nominatim spacing interval so the suite doesn't need real multi-second sleeps, except one
  deliberate real-time wait proving a rate-limit window actually expires.

## Docker-based dev/test setup (optional convenience only)

This is **not** the primary way to run this backend (see "Setup" above) — it exists for
contributors without PHP/MySQL installed natively. It's also how this backend's own
automated test suite was built and verified in this repository's sandboxed dev environment.

```bash
docker compose up -d mysql
docker compose run --rm --no-deps php composer install
cp .env.example .env   # then edit DB_HOST=mysql, DB_USER/DB_PASSWORD=photomap, etc.
docker compose run --rm --no-deps php php scripts/migrate.php
docker compose run --rm --no-deps -e DB_NAME=photomap_test php php scripts/migrate.php
docker compose run --rm --no-deps php composer test
docker compose up php   # runs `php -S 0.0.0.0:8000 -t public public/index.php` in-container
```

`docker-compose.yml` starts a MySQL 8 container (with both a `photomap` dev database and a
`photomap_test` database created via `docker/init.sql`) and a `php:8.3-cli`-based container
with `pdo_mysql`, `gd` (built with JPEG/WebP support), `exif`, and `mbstring` installed.
