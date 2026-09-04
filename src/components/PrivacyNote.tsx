import './PrivacyNote.css';

/** Persistent, non-dismissible privacy notice — a core promise of guest mode, not a toast. */
export function PrivacyNote() {
  return (
    <div className="privacy-note" role="note">
      Guest mode: your photos never leave this device.
    </div>
  );
}
