import { useAuthStore } from '../state/authStore';
import './PrivacyNote.css';

/**
 * Persistent, non-dismissible privacy notice — a core promise of guest mode, not a toast.
 * Mutually exclusive with AccountNotice: hidden for the duration of an authenticated session,
 * since the "never leaves this device" guarantee does not apply to account-mode uploads.
 */
export function PrivacyNote() {
  const status = useAuthStore((s) => s.status);

  if (status === 'authenticated') return null;

  return (
    <div className="privacy-note" role="note">
      Guest mode: your photos never leave this device.
    </div>
  );
}
