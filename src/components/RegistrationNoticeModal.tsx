import './RegistrationNoticeModal.css';

export interface RegistrationNoticeModalProps {
  onAcknowledge: () => void;
  onCancel: () => void;
  submitting: boolean;
}

/**
 * Shown before an account is actually created (gates registration submission — see
 * `TopBanner.tsx`'s `LoggedOutForm`). Sets accurate expectations up front, per the plan:
 * admin approval is required before uploads work, photos are private-by-default and only ever
 * shared via a link the user controls, the account's own email doubles as the notification
 * address for activation/deactivation emails (no separate field), and Guest Mode uploads
 * nothing so it can't be shared.
 */
export function RegistrationNoticeModal({ onAcknowledge, onCancel, submitting }: RegistrationNoticeModalProps) {
  return (
    <div className="registration-notice" role="dialog" aria-modal="true" aria-label="Before you register">
      <div className="registration-notice__box">
        <h2 className="registration-notice__title">Before you register</h2>
        <ul className="registration-notice__list">
          <li>
            <strong>Admin approval is required before you can upload.</strong> You can log in
            right away, but new accounts start out pending — uploads are disabled until an
            administrator activates your account.
          </li>
          <li>
            <strong>Your photos are private by default.</strong> They are never publicly listed
            or searchable. You can generate a shareable link at any time and revoke it whenever
            you want.
          </li>
          <li>
            <strong>The email address you register with doubles as your notification
            address.</strong> There's no separate field — activation and deactivation emails go
            to this same address.
          </li>
          <li>
            <strong>Guest Mode uploads nothing to any account,</strong> so guest-mode photos
            (never leaving this device) can't be shared with friends. Registering is what makes
            sharing possible.
          </li>
        </ul>
        <div className="registration-notice__actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="button" onClick={onAcknowledge} disabled={submitting}>
            I understand, create my account
          </button>
        </div>
      </div>
    </div>
  );
}
