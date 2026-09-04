import { photoRepository } from './db';

type BlobKind = 'thumbnail' | 'preview';

/**
 * A small LRU cache of `URL.createObjectURL()` results keyed by `${id}:${kind}`, so the
 * thumbnail strip / map popups / full-size viewer can share blob-backed image URLs without
 * leaking memory over a long session. Explicit revocation also happens on photo deletion.
 */
class ObjectUrlCache {
  private urls = new Map<string, string>();
  private order: string[] = [];

  constructor(private readonly maxEntries = 300) {}

  private key(id: string, kind: BlobKind): string {
    return `${id}:${kind}`;
  }

  private touch(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1) this.order.splice(idx, 1);
    this.order.push(key);
  }

  private evictIfNeeded(): void {
    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) {
        const url = this.urls.get(oldest);
        if (url) URL.revokeObjectURL(url);
        this.urls.delete(oldest);
      }
    }
  }

  async get(id: string, kind: BlobKind): Promise<string | undefined> {
    const key = this.key(id, kind);
    const existing = this.urls.get(key);
    if (existing) {
      this.touch(key);
      return existing;
    }
    const blob = await photoRepository.getBlob(id, kind);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    this.order.push(key);
    this.evictIfNeeded();
    return url;
  }

  /** Revokes and forgets every cached URL for a given photo id (both kinds). */
  revokeForPhoto(id: string): void {
    for (const kind of ['thumbnail', 'preview'] as BlobKind[]) {
      const key = this.key(id, kind);
      const url = this.urls.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        this.urls.delete(key);
        const idx = this.order.indexOf(key);
        if (idx !== -1) this.order.splice(idx, 1);
      }
    }
  }

  clear(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.order = [];
  }
}

export const objectUrlCache = new ObjectUrlCache();
