/**
 * Deterministic, synchronous id derivation for a File, used as the IndexedDB cache key so that
 * re-opening the same folder can skip re-parsing unchanged files.
 *
 * id = FNV-1a hash of `${relativePath}|${size}|${lastModified}`
 *
 * This is intentionally cheap (no file bytes are read) and per-file rather than per-folder,
 * since `<input webkitdirectory>` / drag-and-drop give no stable OS-level folder identity.
 */

// 32-bit FNV-1a. Good enough for a cache key (collision-resistant in practice for this use
// case); not intended as a cryptographic hash.
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned 32-bit hex string.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeStableId(relativePath: string, size: number, lastModified: number): string {
  return fnv1a(`${relativePath}|${size}|${lastModified}`);
}

/** Extracts the best-available relative path from a File (webkitRelativePath, else name). */
export function relativePathOf(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath && withPath.webkitRelativePath.length > 0
    ? withPath.webkitRelativePath
    : file.name;
}

export function stableIdForFile(file: File): string {
  return computeStableId(relativePathOf(file), file.size, file.lastModified);
}
