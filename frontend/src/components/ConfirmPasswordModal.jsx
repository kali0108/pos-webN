import { useState } from 'react';
import PasswordInput from './PasswordInput';

/**
 * Asks the person to re-type their own password before a destructive
 * action goes ahead. `onConfirm(password)` should resolve to an error
 * message string on failure (shown inline, modal stays open) or a
 * falsy value on success (the caller closes the modal).
 *
 * The password is verified on the SERVER by whatever onConfirm calls
 * (delete_branch / delete_item / reset_all_business_data, or the
 * delete-staff-user Edge Function) — this component is only the
 * prompt, so skipping it in the browser doesn't skip the check.
 */
export default function ConfirmPasswordModal({ title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onClose, children }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password) { setError('Enter your password to continue.'); return; }
    setBusy(true);
    setError(null);
    try {
      const err = await onConfirm(password);
      if (err) setError(err);
    } catch (ex) {
      setError(ex.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={danger ? { color: 'var(--danger)' } : undefined}>{title}</h2>
        <p>{message}</p>
        {children}
        <div className="field" style={{ marginTop: 12 }}>
          <label>Confirm with your password</label>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
