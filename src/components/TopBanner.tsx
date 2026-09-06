import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../state/authStore';
import { createShareLink } from '../lib/api/shareLinksApi';
import { RegistrationNoticeModal } from './RegistrationNoticeModal';
import './TopBanner.css';

function LoggedOutForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showRegistrationNotice, setShowRegistrationNotice] = useState(false);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'register') {
      // The registration-time notice must be seen and acknowledged before an account is
      // actually created — see RegistrationNoticeModal / handleAcknowledgeRegistration.
      setShowRegistrationNotice(true);
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      // Error message is already surfaced via authStore's `error` state.
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcknowledgeRegistration() {
    setSubmitting(true);
    try {
      await register(email, password);
      setShowRegistrationNotice(false);
    } catch {
      // Error message is already surfaced via authStore's `error` state; keep the modal open
      // (over the form) so the user can see it and retry without re-entering their details.
      setShowRegistrationNotice(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="top-banner__auth" aria-label="Login or register" onSubmit={handleSubmit}>
      <input
        type="email"
        name="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        name="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {mode === 'login' ? 'Log in' : 'Register'}
      </button>
      <button
        type="button"
        className="top-banner__mode-switch"
        onClick={() => {
          clearError();
          setMode((m) => (m === 'login' ? 'register' : 'login'));
        }}
      >
        {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
      </button>
      {error && (
        <span role="alert" className="top-banner__error">
          {error}
        </span>
      )}
      {showRegistrationNotice && (
        <RegistrationNoticeModal
          submitting={submitting}
          onAcknowledge={handleAcknowledgeRegistration}
          onCancel={() => setShowRegistrationNotice(false)}
        />
      )}
    </form>
  );
}

function LoggedInControls({ email }: { email: string }) {
  const logout = useAuthStore((s) => s.logout);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleCopyShareLink() {
    setShareStatus(null);
    try {
      const link = await createShareLink();
      const fullUrl = `${window.location.origin}${link.url}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
        setShareStatus('Share link copied to clipboard.');
      } else {
        setShareStatus(`Share link: ${fullUrl}`);
      }
    } catch {
      setShareStatus('Could not create a share link. Please try again.');
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccount();
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="top-banner__account">
      <span className="top-banner__email" data-testid="account-email">
        {email}
      </span>
      <button type="button" onClick={handleCopyShareLink}>
        Copy share link
      </button>
      <button type="button" onClick={() => logout()}>
        Log out
      </button>
      {!confirmingDelete ? (
        <button type="button" className="top-banner__delete" onClick={() => setConfirmingDelete(true)}>
          Delete account
        </button>
      ) : (
        <span className="top-banner__confirm-delete">
          Delete your account and all photos? This cannot be undone.
          <button type="button" onClick={handleDeleteAccount} disabled={deleting}>
            Yes, delete
          </button>
          <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
            Cancel
          </button>
        </span>
      )}
      {shareStatus && (
        <span role="status" className="top-banner__share-status">
          {shareStatus}
        </span>
      )}
    </div>
  );
}

/**
 * Real login/register when logged out; account email + copy-share-link + delete-account when
 * authenticated. Guest mode (no session) shows the login/register form and makes no network
 * calls until the user actually submits it.
 */
export function TopBanner() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  return (
    <header className="top-banner">
      <div className="top-banner__brand">Photomap</div>
      {status === 'authenticated' && user ? (
        <LoggedInControls email={user.email} />
      ) : (
        <LoggedOutForm />
      )}
    </header>
  );
}
