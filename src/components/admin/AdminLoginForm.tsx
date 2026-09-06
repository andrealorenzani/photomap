import { useState, type FormEvent } from 'react';
import { useAdminStore } from '../../state/adminStore';
import './AdminLoginForm.css';

/** Username + password form for the `/admin` console. Posts to `POST /api/admin/login`
 * (a single hardcoded operator identity, entirely separate from regular user accounts). */
export function AdminLoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const login = useAdminStore((s) => s.login);
  const error = useAdminStore((s) => s.error);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(username, password);
    } catch {
      // Error message is already surfaced via adminStore's `error` state.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login__form" aria-label="Admin login" onSubmit={handleSubmit}>
        <h1 className="admin-login__title">Photomap Admin</h1>
        <label>
          Username
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting}>
          Log in
        </button>
        {error && (
          <span role="alert" className="admin-login__error">
            {error}
          </span>
        )}
      </form>
    </div>
  );
}
