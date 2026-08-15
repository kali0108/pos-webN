import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import Receipt from '../components/Receipt';
import PermissionGate from '../components/PermissionGate';
import { useRealtimeRefresh } from '../lib/realtime';

const STATUS_BADGE = { held: 'warning', completed: 'success', refunded: 'danger', void: 'neutral' };

export default function Bills() {
  const { currentBranchId, user } = useAuth();
  const [bills, setBills] = useState([]);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [printing, setPrinting] = useState(null); // invoice id
  const [refunding, setRefunding] = useState(null); // bill object
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundError, setRefundError] = useState(null);

  useEffect(() => { load(); }, [currentBranchId, from, to]);
  useRealtimeRefresh('invoices', load, currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined, !!currentBranchId);

  async function load() {
    let query = supabase
      .from('invoices')
      .select('id, invoice_number, customer_name, status, total_amount, created_at')
      .eq('branch_id', currentBranchId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to + 'T23:59:59');
    const { data } = await query;
    setBills(data || []);
  }

  const filtered = bills.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return b.invoice_number?.toLowerCase().includes(q) || b.customer_name?.toLowerCase().includes(q);
  });

  function openRefund(bill) {
    setRefunding(bill);
    setRefundAmount(bill.total_amount);
    setRefundReason('');
    setRefundError(null);
  }

  async function submitRefund() {
    setRefundError(null);
    const amount = Number(refundAmount);
    if (!amount || amount <= 0 || amount > Number(refunding.total_amount)) {
      setRefundError(`Enter an amount between 0 and ${Number(refunding.total_amount).toFixed(2)}.`);
      return;
    }
    const { error: refundErr } = await supabase.from('refunds').insert({
      invoice_id: refunding.id, branch_id: currentBranchId, amount, reason: refundReason || null, processed_by: user.id,
    });
    if (refundErr) { setRefundError(refundErr.message); return; }
    const { error: statusErr } = await supabase.from('invoices').update({ status: 'refunded' }).eq('id', refunding.id);
    if (statusErr) { setRefundError(`Refund was recorded, but marking the bill as refunded failed: ${statusErr.message}`); return; }
    await supabase.rpc('log_activity', {
      p_action: 'bill.refund', p_branch_id: currentBranchId, p_entity_type: 'invoice', p_entity_id: refunding.id,
      p_details: { amount, reason: refundReason },
    });
    setRefunding(null);
    load();
  }

  return (
    <div>
      <h1>Bills</h1>
      <p>Every bill for this branch — search, view, reprint, or refund, any time.</p>

      <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
          <label>Search invoice # or customer</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. GRW-000104" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th className="num">Total</th><th /></tr></thead>
        <tbody>
          {filtered.map((b) => (
            <tr key={b.id}>
              <td className="invoice-number">{b.invoice_number || '—'}</td>
              <td>{b.customer_name || '—'}</td>
              <td className="num">{new Date(b.created_at).toLocaleString()}</td>
              <td><span className={`badge badge-${STATUS_BADGE[b.status] || 'neutral'}`}>{b.status}</span></td>
              <td className="num money">{Number(b.total_amount).toFixed(2)}</td>
              <td>
                <button className="btn btn-sm" onClick={() => setPrinting(b.id)}>View / Print</button>{' '}
                {b.status === 'completed' && (
                  <PermissionGate permission="bills.refund">
                    <button className="btn btn-sm" onClick={() => openRefund(b)}>Refund</button>
                  </PermissionGate>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={6}>No bills found.</td></tr>}
        </tbody>
      </table></div>

      {printing && <Receipt invoiceId={printing} onClose={() => setPrinting(null)} />}

      {refunding && (
        <div className="modal-overlay" onClick={() => setRefunding(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Refund {refunding.invoice_number}</h2>
            <div className="field">
              <label>Refund amount</label>
              <input type="number" className="num" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
            </div>
            <div className="field">
              <label>Reason (optional)</label>
              <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
            </div>
            {refundError && <p style={{ color: 'var(--danger)' }}>{refundError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-danger" onClick={submitRefund}>Confirm refund</button>
              <button className="btn" onClick={() => setRefunding(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
