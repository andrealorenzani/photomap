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

   For shared hosting where a hand-edited `config.php` is easier to manage than a `.env` file,
   see "Deploying to a shared host" below — `config.php`, if present, takes precedence over
   `.env` for the same settings; it's purely additive and doesn't change this native/Docker
   dev path at all.

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

## Deploying to a shared host (Apache + PHP + MySQL)

A concrete, worked deployment path for typical Apache + PHP + MySQL shared hosting: one
Apache-mapped directory per domain, no reverse proxy you control, SFTP/SSH as the only upload
mechanism. The mechanism (two-tier directory layout, `.htaccess` routing, a hand-edited
`config.php`) is generic Apache+PHP+MySQL shared hosting — nothing here is tied to any specific
host or provider.

### Why two directories, not one

Most shared hosts of this kind map exactly one directory to a domain, and there's no reverse
proxy you control to put the frontend and backend behind a single unified origin the way
Docker's nginx or Vite's dev proxy do locally. This deploy path achieves the same "one origin"
outcome by literally interleaving a one-line PHP stub and the static frontend build inside the
domain's docroot, while keeping the *entire* backend project (`vendor/`, `src/`, `config.php`,
`storage/`) in a private sibling directory outside that docroot entirely — extending this
project's existing "photo storage must be genuinely non-web-reachable" invariant to the whole
backend source tree, not just `storage/`.

Recommended layout, both directories siblings under your hosting account's home directory (`~/`,
never itself web-served):

```
~/photomap-backend/     <- the entire backend project, uploaded as-is; NOT web-reachable
  .htaccess              deny-all, defense in depth (ships with the backend; see below)
  config.php             the one file you edit — DB host/name/user/password, APP_SECRET, etc.
  vendor/, src/, migrations/, scripts/
  public/index.php       unchanged front controller
  storage/{photos,thumbnails}/

~/yourdomain.com/        <- your host's Apache DocumentRoot for the domain
  index.html, assets/*.js/css, config.js   (the frontend's dist/ build, as-is)
  .htaccess              API rewrite + SPA fallback (see deploy/shared-hosting/.htaccess)
  api/index.php          one line: require '../../photomap-backend/public/index.php'
```

Frontend `dist/config.js`'s `apiBaseUrl` needs no change from its existing default (`/api`) —
`api/` being a subfolder of the same domain makes this deployment same-origin by construction, so
`CORS_ALLOWED_ORIGINS` and `SESSION_COOKIE_SAMESITE` also stay at their simple same-origin
defaults (empty / `Lax`).

### Steps

1. **Confirm PHP version/extensions in your host's control panel** before uploading anything: PHP
   ≥ 8.1, with `pdo_mysql`, `gd`, `fileinfo`, `curl`, `json`, `mbstring`, `exif` available (this
   backend's `composer.json` `require` block lists the same set). Most shared hosts of this kind
   let you pick the PHP version per domain in their panel.

2. **Build and stage a release locally** (needs Node/npm locally, plus either Composer or Docker
   — the host itself never needs to run any of these). This step is host-agnostic — see the root
   `README.md`'s "Building a release" section — run it from the repo root as:

   ```bash
   npm run release
   # equivalent to: bash backend/scripts/package-for-deploy.sh
   ```

   This runs `npm run build` and `composer install --no-dev --optimize-autoloader`, then
   assembles a `release/` directory at the repo root: `release/photomap-backend/` (a **curated**
   copy of the backend — not a raw recursive copy; it excludes `tests/`, `docker/`, `.env*`,
   `docker-compose.yml`, `phpunit.xml`, and includes a freshly built `vendor/`, the deny-all
   `.htaccess`, and `config.php.example`) and `release/domain.com/` (the frontend build plus the
   `.htaccess`/`api/index.php` stub from `deploy/shared-hosting/`).

   If `composer` isn't installed/on `PATH`, the script automatically falls back to running it via
   the official `composer:2` Docker image (bind-mounting `backend/` and running as your own
   user/group so the resulting `vendor/` isn't left root-owned) — so **either Composer or Docker**
   installed locally is a prerequisite for this step, not both. If neither is available, the
   script fails with a message pointing you at installing one of the two.

3. **Upload via SFTP** (or use `npm run deploy` from the repo root to automate this step over
   SSH — see the root `README.md`'s "Automating the upload" section): `release/photomap-backend/`
   to a private directory outside your domain's docroot (e.g. `~/photomap-backend/`), and the
   *contents* of `release/domain.com/` to your domain's docroot (e.g. `~/yourdomain.com/`). If you
   renamed/relocated the private directory, update the one hardcoded path in
   `~/yourdomain.com/api/index.php` to match.

4. **Fill in `config.php`**: copy `backend/config.php.example` to `config.php` (either locally
   before packaging, so `package-for-deploy.sh` includes it automatically, or directly on the
   host over SFTP/SSH) and fill in the real values your host's control panel gives you —
   `DB_HOST` is a host-assigned hostname (not `127.0.0.1`), plus `DB_NAME`/`DB_USER`/
   `DB_PASSWORD`, a generated `APP_SECRET` (`php -r 'echo bin2hex(random_bytes(32));'`), and an
   absolute `STORAGE_PATH` outside the docroot (e.g. `~/photomap-backend/storage`). Leave
   `APP_ENV` at `development` until HTTPS is confirmed working (see the troubleshooting note
   below). `config.php` is additive: `.env`/phpdotenv keeps working unchanged for local/Docker
   dev; `Config::load()` only prefers `config.php` when one is actually present next to it.

5. **Run migrations once, over SSH**, inside the uploaded backend directory:

   ```bash
   php scripts/migrate.php
   ```

   This is idempotent and **one-time-per-deploy, not one-time-forever**: if you later upload an
   update that adds new migration files, run it again — it only applies files it hasn't already
   recorded in `schema_migrations`. No SSH access on your plan? As a first-time-only fallback,
   concatenate `migrations/*.sql` (already numbered to run in order) into one `.sql` file and
   import it via phpMyAdmin; this bypasses `schema_migrations` bookkeeping, so treat it as a
   one-shot initial-setup path, not a substitute for the script on later deploys.

6. **Verify**: load the domain in a browser; confirm `/`, a reload of `/share/:token`, and a full
   upload → thumbnail → share-link round trip all work (this exercises GD/exif/curl extension
   availability and file permissions together). See "Manual verification checklist" below for the
   full list, including the `mod_userdir` check.

### Other things worth knowing before you upload

- **Upload size limits**: `MAX_UPLOAD_BYTES` (25MB default) may exceed your host's default
  `upload_max_filesize`/`post_max_size` PHP ini values. If needed, add a
  `~/yourdomain.com/api/.user.ini` (a commonly supported per-directory ini override) bumping
  both.
- **File permissions**: `storage/photos/`/`storage/thumbnails/` just need to exist after upload
  (they ship with `.gitkeep` placeholders) — most shared hosts run PHP as your own account's
  user, so no extra `chown`/`chmod` dance is expected.
- **Storage quota**: `STORAGE_QUOTA_BYTES` (100MB/account default) is unrelated to any specific
  host, but worth sanity-checking against your hosting plan's own disk quota if you expect many
  accounts.
- **Subdirectory deploys**: the layout above targets a domain's root. Deploying under a
  subdirectory instead needs a `RewriteBase` adjustment in `.htaccess` and a corresponding
  relative-path tweak in `api/index.php` — not covered step-by-step here since it depends on your
  specific subdirectory.

### Troubleshooting: login "succeeds" but you're immediately signed out

This means `APP_ENV=production` in `config.php` was set **before** HTTPS was actually working for
the domain. The session cookie's `Secure` flag is gated purely on `APP_ENV=production` (see
"Known, documented limitations" below) with no check that the connection is actually HTTPS — so
if you set `APP_ENV=production` first, the browser silently refuses to persist the
`Secure`-flagged cookie over plain HTTP. There's no visible error anywhere; the login request
itself succeeds, but nothing about the session sticks.

Fix: confirm your domain's HTTPS (a Let's Encrypt certificate, or another TLS cert enabled via
your host's panel) is actually working first, *then* set `APP_ENV=production`. While testing
over plain HTTP, temporarily use `APP_ENV=development` instead.
`deploy/shared-hosting/.htaccess` ships a commented-out HTTP→HTTPS redirect block you can opt
into once a TLS certificate is provisioned — enabling the redirect alone doesn't help if the
certificate itself isn't set up yet, so check that first.

### Manual verification checklist (one-time, against the real hosting account)

- `php -m` over SSH (or your host's panel) shows every extension `composer.json` requires.
- Real page loads/reloads of `/`, `/share/:token`, and a live `/api/*` call from the browser all
  behave as expected (an on-demand automated approximation of this exists —
  `deploy/shared-hosting/verify-apache-routing.sh`, Docker-based, run locally against a packaged
  `release/` before uploading).
- The private `photomap-backend/` directory is genuinely not web-reachable from the live domain
  **and** from `http://<server-hostname-or-ip>/~<your-username>/photomap-backend/config.php`
  — this `mod_userdir`-style path is a distinct exposure risk from same-domain traversal (some
  shared hosts serve account home directories this way regardless of domain mapping, depending
  on account settings) and is exactly what the shipped deny-all `backend/.htaccess` guards
  against. Confirm it 403s, not 200.
- `config.php` with real DB credentials for your host works, and `php scripts/migrate.php` (or
  the phpMyAdmin fallback) completed without error.
- Upload → thumbnail → share-link flow works end-to-end live.
- Session cookie behavior (`APP_ENV=production`, `Secure` flag) actually works over real HTTPS in
  a live browser round trip — and specifically, that HTTPS was enabled *before* `APP_ENV` was set
  to `production` (see the troubleshooting note above).

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
| POST | `/api/register` | no | yes | `{ email, password, website, formRenderedAt }` -> `201 { id, email, status: 'pending' }`. New accounts require admin approval before they can upload — see "Admin console" below. `website` is a honeypot field (must be empty) and `formRenderedAt` is the epoch-ms timestamp the registration form rendered client-side; see "Registration anti-spam" below for the full validation chain and its error codes (`bot_detected`, `too_many_attempts`, `disposable_email`). |
| POST | `/api/login` | no | yes | Rate-limited; `200 { id, email, status }`. Pending accounts can still log in; only uploading is blocked. |
| POST | `/api/logout` | yes | yes | `200 { ok: true }` |
| GET | `/api/me` | yes | no | `200 { id, email, status }` or `401`/`403 account_disabled` |
| DELETE | `/api/account` | yes | yes | Deletes account + photos + share links |
| GET | `/api/photos` | yes | no | `200 { photos: [...] }` |
| POST | `/api/photos` | yes | yes | Multipart: `photo` file + required `lat`/`lon` (an account-mode upload with no usable GPS is rejected with `422 gps_required`) + optional `takenAt`/`cameraMake`/`cameraModel`. `403 account_pending`/`403 account_disabled` if the account isn't active; `503 uploads_disabled` if the admin has globally disabled uploads. |
| DELETE | `/api/photos/{id}` | yes | yes | Owner-only (404 if not owner) |
| PATCH | `/api/photos/{id}` | yes | yes | `{ lat, lon }` -> updated photo JSON; owner-only (404 if not owner); allowed for any photo, not just currently-GPS-less ones |
| POST | `/api/share-links` | yes | yes | Rotates: revokes any existing active link, creates a new one |
| DELETE | `/api/share-links/{id}` | yes | yes | Soft-revoke only |
| GET | `/api/share/{token}` | no | no | Public read-only view of that account's photos |
| GET | `/api/photos/{id}/file` | signed URL | no | Full-size image bytes |
| GET | `/api/photos/{id}/thumbnail` | signed URL | no | Thumbnail image bytes |
| GET | `/api/geocode?lat=&lon=` | yes | no | Reverse-geocode via Nominatim, cached |
| POST | `/api/admin/login` | no | yes | `{ username, password }` -> `200 { username }`. `503 admin_not_configured` if `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` aren't set. |
| POST | `/api/admin/logout` | admin | yes | `200 { ok: true }` |
| GET | `/api/admin/me` | admin | no | `200 { username }` or `401` |
| GET | `/api/admin/users?q=&status=&sort=&dir=&page=&perPage=` | admin | no | Search/filter/sort user list. Never returns a raw share-link token/URL — only `hasShareLink`/`shareLinkCreatedAt`. |
| POST | `/api/admin/users/{id}/activate` | admin | yes | `{ storageQuotaBytes? }` -> approves the account, optionally sets a per-user quota, emails the user |
| POST | `/api/admin/users/{id}/disable` | admin | yes | Fully suspends the account (not just uploads), emails the user |
| GET/PATCH | `/api/admin/settings` | admin | PATCH only | `{ defaultStorageQuotaBytes, uploadsEnabled }` — the default quota for new users and a global upload kill-switch |
| GET | `/api/admin/stats` | admin | no | User counts by status, total photo count, total bytes stored |

**Admin console (`/admin` in the frontend).** A single hardcoded admin username/password pair
(no multi-admin support in this release), stored as a bcrypt hash — never a reversible
"encryption" — via PHP's own `password_hash()`/`password_verify()`, exactly the primitive
already used for regular user accounts. The admin identity is a separate session flag
(`$_SESSION['admin']`), never backed by a `users` row, and can never coexist in the same
session as a logged-in user (logging into one identity clears the other). Calling `/admin`
"secret" would be misleading — it's a normal SPA route shipped in the same public JS bundle as
everything else; the only real protection is this backend credential check, not URL obscurity.

To set up the admin account:

1. Pick a unique `ADMIN_USERNAME` (not `admin`).
2. Pick a strong password; don't write the plaintext into any config file.
3. Generate the hash: `php -r 'echo password_hash("your-chosen-password", PASSWORD_DEFAULT), PHP_EOL;'`
4. Copy the printed `$2y$...` string into `.env`/`config.php` as `ADMIN_PASSWORD_HASH`.
5. Discard the plaintext — it cannot be recovered from the hash. Repeat with a new password to rotate it later.

Leaving `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` unset does not break anything else: every other
route (registration, login, uploads, sharing) works normally, and only `/api/admin/*` routes
return `503 admin_not_configured`. `ADMIN_NOTIFY_EMAIL` controls where "new registration"
notification emails go; if unset, that notification silently degrades to a logged no-op.
Outgoing mail (registration notice to the admin, activation/deactivation notices to the user)
is sent via PHP's built-in `mail()` (configurable `MAIL_FROM_ADDRESS`/`MAIL_FROM_NAME`), not an
SMTP library — chosen because typical Apache/PHP shared hosts reliably support `mail()` with
zero extra configuration, while outbound SMTP is often blocked there. Mail failures are logged
via `error_log()` and never block the action that triggered them.

Per-account storage quota is no longer a single flat `STORAGE_QUOTA_BYTES` env var — it's
admin-configurable at runtime from the Settings panel (`GET`/`PATCH /api/admin/settings`):
each user optionally has their own `storageQuotaBytes` override, falling back to the
admin-configured global default (seeded at 100MB) when they don't have one.

`thumbnailUrl`/`previewUrl` in photo JSON are short-lived, HMAC-signed URLs (15 min for the
owner context, 10 min for the share context) that are freshly regenerated on every
`/api/photos` or `/api/share/{token}` response — they are never persisted. Share-context
image URLs re-check the share link's revoked status on every fetch, so revoking a link takes
effect immediately even for URLs a client already has cached.

## Registration anti-spam

`POST /api/register` runs a validation chain against every request, in this order, each with
its own distinct error code:

1. **Honeypot** (`bot_detected`, `422`): a hidden, off-screen (not `display:none`) form field
   (`website`) that real users/screen readers/keyboard navigation never fill in, but a bot that
   blindly fills every field on the page does. Non-empty → rejected, logged via `error_log()`,
   no account created.
2. **Timing** (`bot_detected`, `422`): `formRenderedAt` (epoch ms, captured client-side when the
   registration form first renders) must be at least `REGISTRATION_MIN_FORM_SECONDS` (default
   `2`, `0` disables this check) seconds before the request reaches the server. Catches
   scripted submissions that never actually render/wait for a human.
3. **Per-IP rate limit** (`too_many_attempts`, `429`): `RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS`
   per `RATE_LIMIT_REGISTRATION_WINDOW_SECONDS` (defaults `5`/`3600`), backed by a dedicated
   `registration_attempts` table (mirroring `login_attempts`' shape, but recording every POST
   regardless of outcome — not just failures against an existing account, since registration
   has no equivalent "succeeded" concept to filter on).
4. **Disposable email domain** (`disposable_email`, `422`): a static, hardcoded list of ~50
   well-known disposable/throwaway email domains (`DisposableEmailDomainList`), matched
   case-insensitively and including subdomains. Not admin-configurable in this release.
5. The existing checks (email format, password length ≥ 8, email uniqueness) run last, unchanged.

**No third-party CAPTCHA** (no Cloudflare Turnstile, reCAPTCHA, or hCaptcha) is implemented in
this release — a deliberate decision, revisitable if spam signups persist in practice; see
docs/architecture.md's Deep Dives for the full rationale. Since v1.0.0 already gates uploads
behind admin approval, this stack closes the gap one step earlier, stopping bot signups from
ever reaching that admin queue.

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

# 3b. New accounts start "pending" and cannot upload yet (403 account_pending) until an
#     admin activates them — see "Admin console" above. For a local dev server without a
#     real admin flow handy, the quickest path is a direct SQL UPDATE:
#     UPDATE users SET status='active' WHERE email='smoke@example.com';

# 4. Upload a photo with metadata (requires lat/lon in account mode -- a GPS-less upload is
#    rejected with 422 gps_required, mirroring the client-side discard in account mode).
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
  generation/verification (including the share-context revocation check), `ConfigTest` —
  `Config::load()`'s `config.php`-vs-`.env` precedence, malformed-`config.php` handling, and an
  end-to-end check that `Database::connect()` picks up `config.php`-sourced `DB_*` values
  correctly — and `DisposableEmailDomainListTest` (case-insensitivity, subdomain matching,
  non-disposable domains passing through).
- `tests/Feature/` — boots a real `php -S` subprocess per test class and drives it with curl
  over HTTP, so cookies, `Set-Cookie` headers, multipart uploads, and session persistence
  are exercised for real, not simulated in-process. The database and scratch storage
  directory are reset between tests. `SecurityFeatureTest` also asserts no stray `config.php`
  exists in the backend root during this suite's run (which would otherwise silently shadow
  `.env.test` for every Feature test). `RegistrationHardeningFeatureTest` covers the honeypot,
  timing, per-IP rate-limit, and disposable-domain checks (plus a control-case legitimate
  registration), running with its own tightened `envOverrides()` (see below).
- Nominatim is never called for real. `NominatimClient` implements
  `GeocodeClientInterface`; tests inject a `FakeGeocodeClient` (canned responses, records
  call count) for behavioral tests, and a tiny local raw-socket fake HTTP server for the one
  test that verifies `NominatimClient` itself sends the configured `User-Agent` header
  correctly on the wire.
- `.env.test` uses short rate-limit windows (`RATE_LIMIT_LOGIN_WINDOW_SECONDS=2`) and a tiny
  Nominatim spacing interval so the suite doesn't need real multi-second sleeps, except one
  deliberate real-time wait proving a rate-limit window actually expires. Registration rate
  limiting/timing is deliberately loosened in the shared `.env.test`
  (`RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS=1000`, `REGISTRATION_MIN_FORM_SECONDS=0`) because
  dozens of unrelated test classes call the registration flow many times in quick succession
  as ordinary setup — `RegistrationHardeningFeatureTest` overrides these to tight values via
  its own `envOverrides()`, the same pattern `PhotosFeatureTest` uses for `MAX_UPLOAD_BYTES`.
- Not exercised by `composer test` (needs Docker, and is slower/more infrastructure-heavy):
  `deploy/shared-hosting/verify-apache-routing.sh`, an on-demand Apache/mod_rewrite routing check
  against a packaged `release/` artifact (`php -S`, used by the Feature tier above, never
  processes `.htaccess` at all, so this is the only coverage of that surface). Run it manually
  before a shared-hosting deploy or after touching `backend/.htaccess`/`deploy/shared-hosting/*`.

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
