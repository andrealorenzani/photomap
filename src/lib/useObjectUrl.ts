import { useEffect, useState } from 'react';
import { objectUrlCache } from './objectUrlCache';

/** React hook wrapper around the shared object-URL LRU cache for a photo's blob. */
export function useObjectUrl(id: string, kind: 'thumbnail' | 'preview'): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    objectUrlCache.get(id, kind).then((result) => {
      if (!cancelled) setUrl(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, kind]);

  return url;
}
