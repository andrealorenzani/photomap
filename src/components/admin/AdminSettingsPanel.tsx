import { useEffect, useState } from 'react';
import {
  fetchAdminSettings,
  fetchAdminStats,
  updateAdminSettings,
  type AdminSettings,
  type AdminStats,
} from '../../lib/api/adminApi';
import { formatBytes } from '../../lib/adminUsers';
import './AdminSettingsPanel.css';

/**
 * Global settings (default storage quota for new users, global upload enable/disable toggle)
 * plus a basic stats display (user counts, photos uploaded, bytes stored) from
 * `GET /api/admin/stats`.
 */
export function AdminSettingsPanel({
  onDefaultQuotaChange,
}: {
  onDefaultQuotaChange?: (bytes: number) => void;
}) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [quotaInput, setQuotaInput] = useState('');
  const [uploadsEnabled, setUploadsEnabled] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchAdminSettings(), fetchAdminStats()])
      .then(([settingsResponse, statsResponse]) => {
        if (cancelled) return;
        setSettings(settingsResponse);
        setQuotaInput(String(settingsResponse.defaultStorageQuotaBytes));
        setUploadsEnabled(settingsResponse.uploadsEnabled);
        setStats(statsResponse);
        onDefaultQuotaChange?.(settingsResponse.defaultStorageQuotaBytes);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    const quotaBytes = Number(quotaInput);
    if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
      setSaveStatus('Default storage quota must be a positive number.');
      return;
    }
    setSaving(true);
    setSaveStatus(null);
    try {
      const updated = await updateAdminSettings({
        defaultStorageQuotaBytes: quotaBytes,
        uploadsEnabled,
      });
      setSettings(updated);
      setQuotaInput(String(updated.defaultStorageQuotaBytes));
      setUploadsEnabled(updated.uploadsEnabled);
      onDefaultQuotaChange?.(updated.defaultStorageQuotaBytes);
      setSaveStatus('Settings saved.');
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="admin-settings">Loading settings…</div>;
  }

  if (error) {
    return (
      <div className="admin-settings" role="alert">
        {error}
      </div>
    );
  }

  return (
    <div className="admin-settings">
      <section className="admin-settings__section">
        <h2>Global settings</h2>
        <label className="admin-settings__field">
          Default storage quota for new users (bytes)
          <input
            type="number"
            min={1}
            value={quotaInput}
            onChange={(e) => setQuotaInput(e.target.value)}
          />
        </label>
        <label className="admin-settings__checkbox">
          <input
            type="checkbox"
            checked={uploadsEnabled}
            onChange={(e) => setUploadsEnabled(e.target.checked)}
          />
          Uploads enabled globally
        </label>
        <button type="button" onClick={handleSave} disabled={saving}>
          Save settings
        </button>
        {saveStatus && (
          <span role="status" className="admin-settings__save-status">
            {saveStatus}
          </span>
        )}
        {settings && (
          <p className="admin-settings__updated-at">Last updated: {settings.updatedAt}</p>
        )}
      </section>

      {stats && (
        <section className="admin-settings__section">
          <h2>Stats</h2>
          <ul className="admin-settings__stats">
            <li>Total users: {stats.totalUsers}</li>
            <li>Pending approval: {stats.usersByStatus.pending ?? 0}</li>
            <li>Active: {stats.usersByStatus.active ?? 0}</li>
            <li>Disabled: {stats.usersByStatus.disabled ?? 0}</li>
            <li>Photos uploaded: {stats.totalPhotos}</li>
            <li>Total storage used: {formatBytes(stats.totalBytesStored)}</li>
          </ul>
        </section>
      )}
    </div>
  );
}
