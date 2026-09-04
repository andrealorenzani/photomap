import { useEffect, useState } from 'react';
import App from './App';
import { SharePage } from './pages/SharePage';

/**
 * A small hand-rolled path matcher for exactly two routes (`/` and `/share/:token`) — matches
 * the project's existing minimal-dependency posture (the backend's own hand-rolled router is
 * documented the same way). Not worth a routing library dependency for two routes with very
 * different rendering needs.
 */
function matchShareToken(pathname: string): string | null {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function Router() {
  const [pathname, setPathname] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  useEffect(() => {
    function onPopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const shareToken = matchShareToken(pathname);
  if (shareToken) {
    return <SharePage token={shareToken} />;
  }

  return <App />;
}
