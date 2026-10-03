import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import Receipt from '../components/Receipt';
import RefundModal from '../components/RefundModal';
import PermissionGate from '../components/PermissionGate';
import { useRealtimeRefresh } from '../lib/realtime';

const STATUS_BADGE = { held: 'warning', completed: 'success', refunded: 'danger', void: 'neutral' };

export default function Bills() {
  const { currentBranchId, branches } = useAuth();
  const currency = branches.find((b) => b.id === currentBranchId)?.currency_symbol || '';
  const [bills, setBills] = useState([]);
  const [refundedBy, setRefundedBy] = useState({});
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [printing, setPrinting] = useState(null);
  const [refunding, setRefunding] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, [currentBranchId, from, to]);
  useRealtimeRefresh('invoices', load, currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined, !!currentBranchId);
  useRealtimeRefresh('refunds', load, currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined, !!currentBranchId);

  async function load() {
    let query = supabase
      .from('invoices')
      .select('id, invoice_number, customer_name, status, subtotal, total_amount, branch_id, currency_symbol, created_at')
      .eq('branch_id', currentBranchId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to + 'T23:59:59');
    const { data, error: err } = await query;
    if (err) { setError(err.message); return; }
    setError(null);
    setBills(data || []);

    const ids = (data || []).map((b) => b.id);
    if (ids.length) {
      const { data: refs } = await supabase.from('refunds').select('invoice_id, amount').in('invoice_id', ids);
      const sums = {};
      (refs || []).forEach((r) => { sums[r.invoice_id] = (sums[r.invoice_id] || 0) + Number(r.amount); });
      setRefundedBy(sums);
    } else {
      setRefundedBy({});
    }
  }

  const filtered = bills.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return b.invoice_number?.toLowerCase().includes(q) || b.customer_name?.toLowerCase().includes(q);
  });

  return (
    <div>
      <h1>Bills</h1>
      <p>Every bill for this branch — search, view, reprint, refund, return or exchange, any time.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
          <label>Search invoice # or customer</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. GRW-000104" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th className="num">Total</th><th className="num">Refunded</th><th /></tr></thead>
        <tbody>
          {filtered.map((b) => (
            <tr key={b.id}>
              <td className="invoice-number">{b.invoice_number || '—'}</td>
              <td>{b.customer_name || '—'}</td>
              <td className="num">{new Date(b.created_at).toLocaleString()}</td>
              <td><span className={`badge badge-${STATUS_BADGE[b.status] || 'neutral'}`}>{b.status}</span></td>
              <td className="num money">{currency}{Number(b.total_amount).toFixed(2)}</td>
              <td className="num money">{refundedBy[b.id] ? `${currency}${refundedBy[b.id].toFixed(2)}` : '—'}</td>
              <td>
                <button className="btn btn-sm" onClick={() => setPrinting(b.id)}>View / Print</button>{' '}
                {b.status === 'completed' && (
                  <PermissionGate permission="bills.refund">
                    <button className="btn btn-sm" onClick={() => setRefunding(b)}>Refund / Return</button>
                  </PermissionGate>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={7}>No bills found.</td></tr>}
        </tbody>
      </table></div>

      {printing && <Receipt invoiceId={printing} onClose={() => setPrinting(null)} />}
      {refunding && <RefundModal bill={refunding} onClose={() => setRefunding(null)} onDone={load} />}
    </div>
  );
}
