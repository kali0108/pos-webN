import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';

const CONFIRM_PHRASE = 'DELETE ALL DATA';

export default function DangerZone() {
  const { isOwner } = useAuth();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  if (!isOwner) {
    return (
      <div>
        <h1>Danger Zone</h1>
        <p>Only the Owner can access this page.</p>
      </div>
    );
  }

  async function runReset() {
    setError(null);
    setResult(null);
    if (typed !== CONFIRM_PHRASE) {
      setError(`Type exactly "${CONFIRM_PHRASE}" to confirm.`);
      return;
    }
    if (!window.confirm('This will permanently erase every bill, product, custom order, and production record for the whole business. Branches and staff logins are kept. This absolutely cannot be undone. Continue?')) {
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('reset_all_business_data', { confirmation_phrase: typed });
      if (error) throw error;
      setResult(data);
      setTyped('');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Danger Zone</h1>
      <p>Irreversible actions live here, and only here — nothing on this page can be undone.</p>

      <div className="card" style={{ maxWidth: 560, borderColor: 'var(--danger)' }}>
        <h2 style={{ color: 'var(--danger)' }}>Reset all business data</h2>
        <p>
          Permanently deletes every bill, payment, refund, custom order, production record, and product/category —
          for every branch, all at once. Use this to wipe out test/sample data before going live with real
          customers, or to start a completely fresh dataset.
        </p>
        <p><strong>What's kept:</strong> your branches (with their tax/currency settings) and every staff login —
          deleting those would lock everyone out of a system they'd need to rebuild from scratch, which isn't what
          "reset the data" usually means. Delete a specific branch or staff account separately if you actually want
          that gone too — see Branches / Staff & Permissions.</p>
        <p><strong>What's NOT kept:</strong> items, categories, discount rules, raw materials, all inventory
          quantities (reset to nothing), every invoice/payment/refund, custom orders, production plans and actuals.
          Every branch's invoice numbering restarts from 1.</p>

        <div className="field" style={{ marginTop: 16 }}>
          <label>Type <code>{CONFIRM_PHRASE}</code> to confirm</label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={CONFIRM_PHRASE} />
        </div>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {result && (
          <div className="card" style={{ borderColor: 'var(--success)', marginBottom: 12 }}>
            <p>Done. {result.branches_kept} branch(es) and {result.staff_kept} staff account(s) were kept; everything else was cleared.</p>
          </div>
        )}

        <button className="btn btn-danger" onClick={runReset} disabled={busy || typed !== CONFIRM_PHRASE}>
          {busy ? 'Resetting…' : 'Permanently reset all business data'}
        </button>
      </div>
    </div>
  );
}
