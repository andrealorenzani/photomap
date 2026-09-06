import { useEffect, useState } from 'react';
import App from './App';
import { SharePage } from './pages/SharePage';
import { AdminPage } from './pages/AdminPage';

/**
 * A small hand-rolled path matcher for exactly three routes (`/`, `/share/:token`, and
 * `/admin`) — matches the project's existing minimal-dependency posture (the backend's own
 * hand-rolled router is documented the same way). Not worth a routing library dependency for a
 * handful of routes with very different rendering needs. `/admin` renders a fully self-contained
 * admin console (its own session/store, see `AdminPage`/`adminStore`), structured the same way
 * as `/share/:token` — neither touches the main app's guest-mode store or photo-viewing state.
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

  if (pathname === '/admin' || pathname === '/admin/') {
    return <AdminPage />;
  }

  return <App />;
}
