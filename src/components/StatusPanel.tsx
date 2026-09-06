import { usePhotoStore } from '../state/photoStore';
import './StatusPanel.css';

export function StatusPanel() {
  const status = usePhotoStore((s) => s.status);
  const progressPct = status.total > 0 ? Math.min(100, Math.round((status.processed / status.total) * 100)) : 0;

  return (
    <div className="status-panel" aria-live="polite">
      <div className="status-panel__counts">
        <span>Processed: {status.processed}</span>
        <span>With GPS: {status.withGPS}</span>
        <span>Discarded (No GPS): {status.withoutGPS}</span>
        {status.skipped > 0 && <span>Skipped/unreadable: {status.skipped}</span>}
        {status.uploadFailures > 0 && <span>Not saved: {status.uploadFailures}</span>}
      </div>
      {status.parsing && (
        <div className="status-panel__progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="status-panel__progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
      )}
      {status.storageWarning && (
        <div className="status-panel__warning" role="alert">
          {status.storageWarning}
        </div>
      )}
      {status.gpsRequiredNotice && (
        <div className="status-panel__gps-required" role="alert">
          {status.gpsRequiredNotice}
        </div>
      )}
    </div>
  );
}
