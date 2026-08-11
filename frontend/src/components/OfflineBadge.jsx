import { useEffect, useState } from 'react';
import { subscribeSyncStatus } from '../lib/syncEngine';

export default function OfflineBadge() {
  const [status, setStatus] = useState({ online: true, syncing: false, pendingCount: 0 });

  useEffect(() => subscribeSyncStatus(setStatus), []);

  if (status.online && status.pendingCount === 0) {
    return (
      <span className="offline-badge ok"><span className="dot" /> Online</span>
    );
  }
  if (!status.online) {
    return (
      <span className="offline-badge bad">
        <span className="dot" /> Offline{status.pendingCount > 0 ? ` · ${status.pendingCount} bill(s) queued` : ''}
      </span>
    );
  }
  return (
    <span className="offline-badge warn">
      <span className="dot" /> {status.syncing ? 'Syncing…' : `${status.pendingCount} bill(s) waiting to sync`}
    </span>
  );
}
