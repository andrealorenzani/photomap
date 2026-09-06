import { useEffect, useState } from 'react';
import { useAdminStore } from '../state/adminStore';
import { fetchAdminSettings } from '../lib/api/adminApi';
import { AdminLoginForm } from '../components/admin/AdminLoginForm';
import { AdminUsersPanel } from '../components/admin/AdminUsersPanel';
import { AdminSettingsPanel } from '../components/admin/AdminSettingsPanel';
import './AdminPage.css';

type Tab = 'users' | 'settings';

/**
 * The `/admin` console: a fully self-contained page/component tree, structured the same way as
 * `SharePage` — it never touches the guest-mode Zustand `photoStore`/`authStore` or any
 * main-app photo-viewing state, and uses its own separate `adminStore` for its own separate
 * (cookie-based) admin session.
 */
export function AdminPage() {
  const status = useAdminStore((s) => s.status);
  const username = useAdminStore((s) => s.username);
  const restoreSession = useAdminStore((s) => s.restoreSession);
  const logout = useAdminStore((s) => s.logout);
  const [tab, setTab] = useState<Tab>('users');
  const [defaultQuotaBytes, setDefaultQuotaBytes] = useState<number | null>(null);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    // Fetched independently of which tab is active, so the Users tab's "activate" quota input
    // is always pre-filled with the current global default even if Settings was never visited.
    fetchAdminSettings()
      .then((settings) => setDefaultQuotaBytes(settings.defaultStorageQuotaBytes))
      .catch(() => {
        // Non-fatal: the activate-quota input simply falls back to an empty default.
      });
  }, [status]);

  if (status === 'idle' || status === 'checking') {
    return (
      <div className="admin-page admin-page--loading" data-testid="admin-page-loading">
        Checking admin session…
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div data-testid="admin-page">
        <AdminLoginForm />
      </div>
    );
  }

  return (
    <div className="admin-page" data-testid="admin-page">
      <header className="admin-page__header">
        <span className="admin-page__brand">Photomap Admin</span>
        <nav className="admin-page__tabs">
          <button
            type="button"
            className={tab === 'users' ? 'admin-page__tab admin-page__tab--active' : 'admin-page__tab'}
            onClick={() => setTab('users')}
          >
            Users
          </button>
          <button
            type="button"
            className={tab === 'settings' ? 'admin-page__tab admin-page__tab--active' : 'admin-page__tab'}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
        </nav>
        <span className="admin-page__account">
          {username}
          <button type="button" onClick={() => logout()}>
            Log out
          </button>
        </span>
      </header>
      <main className="admin-page__main">
        {tab === 'users' ? (
          <AdminUsersPanel defaultQuotaBytes={defaultQuotaBytes} />
        ) : (
          <AdminSettingsPanel onDefaultQuotaChange={setDefaultQuotaBytes} />
        )}
      </main>
    </div>
  );
}
