import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import Receipt from '../components/Receipt';

const STATUS_BADGE = { held: 'warning', completed: 'success', refunded: 'danger', void: 'neutral' };

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); }

export default function History() {
  const { isOwner, can } = useAuth();
  const [tab, setTab] = useState('bills');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const [search, setSearch] = useState('');
  const [onlyDeleted, setOnlyDeleted] = useState(false);
  const [bills, setBills] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [deletions, setDeletions] = useState([]);
  const [error, setError] = useState(null);
  const [printing, setPrinting] = useState(null);
  const canSeeLog = isOwner || can('staff.manage');

  useEffect(() => { load(); }, [tab, from, to]);

  async function load() {
    setError(null);
    const start = new Date(from + 'T00:00:00').toISOString();
    const end = new Date(to + 'T23:59:59').toISOString();
    if (tab === 'bills') {
      const { data, error: err } = await supabase
        .from('invoices')
        .select('id, invoice_number, branch_id, branch_name, branch_code, created_by_name, customer_name, status, total_amount, currency_symbol, created_at')
        .gte('created_at', start).lte('created_at', end)
        .order('created_at', { ascending: false }).limit(500);
      if (err) setError(err.message);
      setBills(data || []);
    } else if (tab === 'refunds') {
      const { data, error: err } = await supabase
        .from('refunds')
        .select('id, branch_id, branch_name, processed_by_name, refund_type, amount, net_amount_due, reason, created_at, invoices!refunds_invoice_id_fkey ( invoice_number, currency_symbol )')
        .gte('created_at', start).lte('created_at', end)
        .order('created_at', { ascending: false }).limit(500);
      if (err) setError(err.message);
      setRefunds(data || []);
    } else {
      const { data, error: err } = await supabase
        .from('activity_log')
        .select('id, action, user_name, details, created_at')
        .or('action.like.*.delete,action.eq.system.data_reset')
        .gte('created_at', start).lte('created_at', end)
        .order('created_at', { ascending: false }).limit(500);
      if (err) setError(err.message);
      setDeletions(data || []);
    }
  }

  const q = search.trim().toLowerCase();
  const shownBills = bills.filter((b) => {
    if (onlyDeleted && b.branch_id) return false;
    if (!q) return true;
    return [b.invoice_number, b.customer_name, b.branch_name, b.created_by_name].some((v) => v?.toLowerCase().includes(q));
  });
  const shownRefunds = refunds.filter((r) => !q || [r.invoices?.invoice_number, r.branch_name, r.processed_by_name, r.reason].some((v) => v?.toLowerCase().includes(q)));

  return (
    <div>
      <h1>History</h1>
      <p>
        Every bill, refund and exchange ever recorded — including ones from branches, products or staff that have since
        been deleted. Those records keep the original names, so nothing is lost for your accounts or tracking.
        {!isOwner && ' (Bills from deleted branches are visible to the Owner only.)'}
      </p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'bills' ? 'btn-primary' : ''}`} onClick={() => setTab('bills')}>Bills</button>
        <button className={`btn btn-sm ${tab === 'refunds' ? 'btn-primary' : ''}`} onClick={() => setTab('refunds')}>Refunds &amp; exchanges</button>
        {canSeeLog && <button className={`btn btn-sm ${tab === 'deleted' ? 'btn-primary' : ''}`} onClick={() => setTab('deleted')}>Deletion log</button>}
      </div>

      <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {tab !== 'deleted' && (
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="invoice, branch, cashier, customer…" />
          </div>
        )}
        {tab === 'bills' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={onlyDeleted} onChange={(e) => setOnlyDeleted(e.target.checked)} />
            Only bills from deleted branches
          </label>
        )}
      </div>

      {tab === 'bills' && (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Invoice</th><th>Branch</th><th>Cashier</th><th>Customer</th><th>Status</th><th className="num">Total</th><th /></tr></thead>
          <tbody>
            {shownBills.map((b) => (
              <tr key={b.id}>
                <td className="num">{new Date(b.created_at).toLocaleString()}</td>
                <td className="invoice-number">{b.invoice_number || '—'}</td>
                <td>{b.branch_name || '—'} {!b.branch_id && <span className="badge badge-neutral">deleted branch</span>}</td>
                <td>{b.created_by_name || '—'}</td>
                <td>{b.customer_name || '—'}</td>
                <td><span className={`badge badge-${STATUS_BADGE[b.status] || 'neutral'}`}>{b.status}</span></td>
                <td className="num money">{b.currency_symbol}{Number(b.total_amount).toFixed(2)}</td>
                <td><button className="btn btn-sm" onClick={() => setPrinting(b.id)}>View / Print</button></td>
              </tr>
            ))}
            {shownBills.length === 0 && <tr><td colSpan={8}>No bills in this period.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'refunds' && (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Bill</th><th>Branch</th><th>Type</th><th className="num">Refunded</th><th className="num">Exchange difference</th><th>By</th><th>Reason</th></tr></thead>
          <tbody>
            {shownRefunds.map((r) => {
              const cur = r.invoices?.currency_symbol || '';
              return (
                <tr key={r.id}>
                  <td className="num">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="invoice-number">{r.invoices?.invoice_number || '—'}</td>
                  <td>{r.branch_name || '—'} {!r.branch_id && <span className="badge badge-neutral">deleted branch</span>}</td>
                  <td><span className="badge badge-warning">{r.refund_type === 'return' ? 'item return' : r.refund_type === 'exchange' ? 'exchange' : 'money only'}</span></td>
                  <td className="num money">{cur}{Number(r.amount).toFixed(2)}</td>
                  <td className="num money">{r.refund_type === 'exchange' ? `${cur}${Number(r.net_amount_due).toFixed(2)}` : '—'}</td>
                  <td>{r.processed_by_name || '—'}</td>
                  <td>{r.reason || '—'}</td>
                </tr>
              );
            })}
            {shownRefunds.length === 0 && <tr><td colSpan={8}>No refunds or exchanges in this period.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'deleted' && (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>What</th><th>Name</th><th>By</th></tr></thead>
          <tbody>
            {deletions.map((d) => (
              <tr key={d.id}>
                <td className="num">{new Date(d.created_at).toLocaleString()}</td>
                <td>{d.action === 'system.data_reset' ? 'Full system reset' : d.action.replace('.delete', ' deleted')}</td>
                <td>{d.details?.name || d.details?.full_name || d.details?.code || '—'}</td>
                <td>{d.user_name || '—'}</td>
              </tr>
            ))}
            {deletions.length === 0 && <tr><td colSpan={4}>Nothing has been deleted in this period.</td></tr>}
          </tbody>
        </table></div>
      )}

      {printing && <Receipt invoiceId={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
