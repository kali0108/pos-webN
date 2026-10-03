import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import ConfirmPasswordModal from '../../components/ConfirmPasswordModal';

const CONFIRM_PHRASE = 'DELETE ALL DATA';

export default function DangerZone() {
  const { isOwner, refresh } = useAuth();
  const [typed, setTyped] = useState('');
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(null);

  if (!isOwner) {
    return (
      <div>
        <h1>Danger Zone</h1>
        <p>Only the Owner can access this page.</p>
      </div>
    );
  }

  // Both safeguards are checked by the database itself (the exact
  // phrase AND the Owner's password), not just by this page.
  async function runReset(password) {
    const { data, error } = await supabase.rpc('reset_all_business_data', {
      p_confirmation_phrase: typed,
      p_password: password,
    });
    if (error) return error.message;
    if (!data?.ok) return data?.error || 'The reset did not go through.';
    setDone(data);
    setTyped('');
    setAsking(false);
    refresh();
    return null;
  }

  return (
    <div>
      <h1>Danger Zone</h1>
      <p>Irreversible actions live here, and only here — nothing on this page can be undone.</p>

      {done && (
        <div className="card" style={{ borderColor: 'var(--success)', marginBottom: 16, maxWidth: 560 }}>
          <h2 style={{ color: 'var(--success)' }}>The system has been reset</h2>
          <p>
            Everything was cleared: {done.branches_removed} branch(es) and {done.staff_removed} other staff
            login(s) were removed along with all bills, products, stock and records. Your own login is untouched.
            Start fresh from Admin → Branches.
          </p>
        </div>
      )}

      <div className="card" style={{ maxWidth: 560, borderColor: 'var(--danger)' }}>
        <h2 style={{ color: 'var(--danger)' }}>Reset the whole system — start over like new</h2>
        <p>
          Wipes the website back to a brand-new, empty state. Use it to clear out test/sample data before going
          live with real customers.
        </p>
        <p><strong>Everything below is permanently erased:</strong></p>
        <ul style={{ color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          <li>All bills, payments, refunds, exchanges and the History archive</li>
          <li>All products, categories, discounts, raw materials and every stock level</li>
          <li>All custom orders and production records</li>
          <li>All branches, and every other staff login</li>
          <li>Dashboard adjustments (expenses, corrections) and the whole activity log</li>
          <li>Invoice numbering — every new branch starts again from 1</li>
        </ul>
        <p>
          <strong>Kept:</strong> only <em>your own</em> Owner login (so you can sign back in and set things up
          again) and the list of permissions/role templates, which are system settings rather than your data.
        </p>

        <div className="field" style={{ marginTop: 16 }}>
          <label>Type <code>{CONFIRM_PHRASE}</code> to unlock the button</label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={CONFIRM_PHRASE} />
        </div>

        <button className="btn btn-danger" onClick={() => setAsking(true)} disabled={typed !== CONFIRM_PHRASE}>
          Reset everything…
        </button>
      </div>

      {asking && (
        <ConfirmPasswordModal
          title="Last chance — reset everything?"
          message="This erases ALL data and every other login, permanently. It cannot be undone and there is no backup inside the app."
          confirmLabel="Yes, erase everything"
          onConfirm={runReset}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  );
}
