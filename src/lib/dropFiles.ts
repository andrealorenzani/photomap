/**
 * Recursively resolves the files inside a dropped folder (or set of dropped files/folders).
 *
 * Browsers only expose top-level entries on `DataTransfer.items`; nested folder contents must be
 * walked manually via the (non-standard but universally supported) `webkitGetAsEntry` /
 * `FileSystemDirectoryReader` APIs. Resulting File objects don't carry `webkitRelativePath` the
 * way `<input webkitdirectory>` picks do, so we assign it manually from the entry's fullPath —
 * this keeps the same downstream cache-key/ingest pipeline working for both input sources.
 *
 * TypeScript's DOM lib types for this API are incomplete/inconsistent across versions, so this
 * module leans on a few pragmatic `any`/cast escapes rather than fighting the ambient types.
 */

interface DirectoryReaderLike {
  readEntries(
    success: (entries: FileSystemEntry[]) => void,
    error?: (err: unknown) => void
  ): void;
}

function readEntryFile(entry: FileSystemEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    (entry as unknown as { file(success: (f: File) => void, error?: (e: unknown) => void): void }).file(
      (file) => {
        try {
          Object.defineProperty(file, 'webkitRelativePath', {
            value: entry.fullPath.replace(/^\//, ''),
            configurable: true,
          });
        } catch {
          // Some environments may not allow redefining this property; fall back to file.name via
          // relativePathOf()'s existing fallback in that case.
        }
        resolve(file);
      },
      reject
    );
  });
}

function readAllDirectoryEntries(reader: DirectoryReaderLike): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    function readBatch() {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(all);
          return;
        }
        all.push(...entries);
        readBatch();
      }, reject);
    }
    readBatch();
  });
}

async function walkEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    try {
      return [await readEntryFile(entry)];
    } catch {
      return [];
    }
  }
  if (entry.isDirectory) {
    const reader = (
      entry as unknown as { createReader(): DirectoryReaderLike }
    ).createReader();
    const entries = await readAllDirectoryEntries(reader);
    const nested = await Promise.all(entries.map((e) => walkEntry(e)));
    return nested.flat();
  }
  return [];
}

export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => e !== null && e !== undefined);

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((e) => walkEntry(e)));
    return nested.flat();
  }

  // Fallback: browsers/environments without webkitGetAsEntry support — just use the flat list.
  return Array.from(dataTransfer.files ?? []);
}
