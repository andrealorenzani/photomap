import { useAuthStore } from '../state/authStore';
import './AccountNotice.css';

/**
 * Persistent, non-dismissible banner (same pattern as PrivacyNote, distinctly styled) shown for
 * the entire duration of an authenticated session — trivially satisfies "shown before the first
 * upload" with no "have they seen this" state to track anywhere. Mutually exclusive with
 * PrivacyNote (guest mode).
 */
export function AccountNotice() {
  const status = useAuthStore((s) => s.status);

  if (status !== 'authenticated') return null;

  return (
    <div className="account-notice" role="note">
      Account mode: your uploaded photos are stored on the server for this account.
    </div>
  );
}
