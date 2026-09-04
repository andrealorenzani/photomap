import './TopBanner.css';

/**
 * Branding + a purely visual, inert auth placeholder for what Phase 2/3 will wire up.
 * Deliberately: no form submit handler, no network call, no fake "logged in" state change.
 * Inputs/button are disabled so it cannot be mistaken for a working login.
 */
export function TopBanner() {
  return (
    <header className="top-banner">
      <div className="top-banner__brand">Photomap</div>
      <form
        className="top-banner__auth"
        aria-label="Login (coming soon)"
        onSubmit={(e) => e.preventDefault()}
      >
        <input
          type="text"
          name="username"
          placeholder="Username"
          disabled
          aria-disabled="true"
          title="Coming soon: accounts are not available in guest mode"
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          disabled
          aria-disabled="true"
          title="Coming soon: accounts are not available in guest mode"
        />
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Coming soon: accounts are not available in guest mode"
        >
          Login / Register (coming soon)
        </button>
      </form>
    </header>
  );
}
