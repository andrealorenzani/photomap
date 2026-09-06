export function formatDateTime(iso: string | undefined): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleString();
}

/**
 * Formats a raw backend datetime string (MySQL's `YYYY-MM-DD HH:MM:SS`, no timezone marker —
 * always UTC) the same way `apiPhotoRepository.ts` already converts `takenAt`/`createdAt`
 * values: treat it as UTC by inserting `T`/`Z` before parsing.
 */
export function formatServerDateTime(raw: string | null | undefined): string {
  if (!raw) return 'Unknown date';
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  return formatDateTime(iso);
}
