# Photomap — Architecture

## Status
No architecture exists yet. This document will be filled in and kept current as the initial
build (frontend guest mode, PHP/MySQL accounts backend, then wiring the two together) proceeds.
See `docs/plans.md` for the plan driving this and `docs/code.md` for the code-level view once it
exists.

## Expected shape (to be confirmed/updated once built)
- A single frontend project (TypeScript + Vite) implementing both guest mode (fully client-side:
  IndexedDB, Web Worker EXIF parsing, Leaflet map, custom timeline component) and account mode
  (calls a JSON HTTP API).
- A single PHP 8.x backend project (session-cookie auth, PDO/MySQL, disk storage for uploaded
  images outside the web root) exposing the account-mode API, runnable locally via the PHP
  built-in server against a local MySQL instance.
- No shared code between the two projects; they communicate only over the JSON API, proxied from
  the Vite dev server to the PHP server in local development.
