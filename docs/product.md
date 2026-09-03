# Photomap — Product

## What it is
Photomap is a web app for browsing your own photo collection on a map and a timeline, using the
GPS coordinates and datetimes embedded in each photo's EXIF metadata.

## Modes
- **Guest mode** (default, no account): fully client-side. Photos and their extracted metadata
  never leave the browser — they live only in memory and IndexedDB for that device/session.
- **Account mode** (logged in): photos are uploaded to a Photomap-operated backend and persist
  across devices. An account holder can generate a shareable read-only permalink to their map,
  and can delete their account (which erases all their data).

## Status
No change has been implemented yet. This document will be updated after each change, starting
with the initial three-phase build (see `docs/plans.md` for the plan and `docs/original_prompts.md`
for the original request).
