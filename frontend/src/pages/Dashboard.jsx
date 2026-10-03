import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useRealtimeRefresh } from '../lib/realtime';
import { logActivity } from '../lib/activityLog';

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const ymd = (d) => d.toLocaleDateString('en-CA'); // local YYYY-MM-DD, not UTC
function startOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfYear() { const d = new Date(); return new Date(d.getFullYear(), 0, 1); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

const PRESETS = [
  { key: 'today', label: 'Today', range: () => [new Date(), new Date()] },
  { key: '7d', label: 'Last 7 days', range: () => [daysAgo(6), new Date()] },
  { key: '30d', label: 'Last 30 days', range: () => [daysAgo(29), new Date()] },
  { key: 'month', label: 'This month', range: () => [startOfMonth(), new Date()] },
  { key: 'year', label: 'This year', range: () => [startOfYear(), new Date()] },
];

const ADJ_CATEGORIES = [
  { key: 'expense', label: 'Expense (rent, salary, utilities…)', sign: -1 },
  { key: 'other_income', label: 'Other income', sign: 1 },
  { key: 'inventory_writeoff', label: 'Stock written off (spoiled / lost)', sign: -1 },
  { key: 'cash_correction', label: 'Cash drawer correction', sign: 0 },
  { key: 'data_entry_fix', label: 'Fix for a data-entry mistake', sign: 0 },
  { key: 'other', label: 'Other', sign: 0 },
];
const CAT_LABEL = Object.fromEntries(ADJ_CATEGORIES.map((c) => [c.key, c.label.split(' (')[0]]));

const n = (v) => Number(v || 0);

export default function Dashboard() {
  const { isOwner, can, branches, currentBranchId, user } = useAuth();
  const canFinancial = isOwner || can('reports.financial.view');
  if (!canFinancial) return <SimpleDashboard />;
  return <FinancialDashboard isOwner={isOwner} branches={branches} currentBranchId={currentBranchId} user={user} />;
}

function FinancialDashboard({ isOwner, branches, currentBranchId, user }) {
  const [preset, setPreset] = useState('30d');
  const [from, setFrom] = useState(ymd(daysAgo(29)));
  const [to, setTo] = useState(ymd(new Date()));
  const [branchFilter, setBranchFilter] = useState('all');
  const [summary, setSummary] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingAdj, setDeletingAdj] = useState(null);

  const scopeBranches = branchFilter === 'all' ? branches : branches.filter((b) => b.id === branchFilter);
  const currencies = [...new Set(scopeBranches.map((b) => b.currency_code).filter(Boolean))];
  const mixedCurrency = currencies.length > 1;
  const symbol = mixedCurrency ? '' : (scopeBranches[0]?.currency_symbol || '');
  const money = (v) => `${symbol}${n(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => { load(); }, [from, to, branchFilter]);
  useRealtimeRefresh('invoices', load);
  useRealtimeRefresh('refunds', load);
  useRealtimeRefresh('financial_adjustments', load);

  function choosePreset(p) {
    setPreset(p.key);
    const [a, b] = p.range();
    setFrom(ymd(a));
    setTo(ymd(b));
  }

  async function load() {
    setLoading(true);
    const branchArg = branchFilter === 'all' ? null : branchFilter;
    const { data, error: err } = await supabase.rpc('dashboard_summary', { p_from: from, p_to: to, p_branch_id: branchArg, p_tz: TZ });
    if (err) { setError(err.message); setLoading(false); return; }
    setError(null);
    setSummary(data);

    let adjQuery = supabase.from('financial_adjustments')
      .select('id, amount, category, reason, created_by_name, created_at, branch_id, branches ( name )')
      .gte('created_at', new Date(from + 'T00:00:00').toISOString())
      .lte('created_at', new Date(to + 'T23:59:59').toISOString())
      .order('created_at', { ascending: false });
    if (branchArg) adjQuery = adjQuery.eq('branch_id', branchArg);
    const { data: adj } = await adjQuery;
    setAdjustments(adj || []);
    setLoading(false);
  }

  async function removeAdjustment(a) {
    const { error: err } = await supabase.from('financial_adjustments').delete().eq('id', a.id);
    if (err) { setError(err.message); return; }
    logActivity('adjustment.delete', { branchId: a.branch_id, entityType: 'financial_adjustment', entityId: a.id, details: { category: a.category, amount: a.amount, reason: a.reason } });
    setDeletingAdj(null);
    load();
  }

  const s = summary;
  const trendData = useMemo(() => {
    if (!s) return null;
    const labels = s.trend.map((t) => {
      const d = new Date(t.bucket + 'T00:00:00');
      return s.range.bucket === 'month' ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    });
    return {
      labels,
      datasets: [
        { label: 'Sales', data: s.trend.map((t) => n(t.sales)), backgroundColor: '#a8632a' },
        { label: 'Refunds', data: s.trend.map((t) => n(t.refunds)), backgroundColor: '#ae2e24' },
      ],
    };
  }, [s]);

  const profit = s ? n(s.net_profit) : 0;
  const maxMode = s ? Math.max(...s.payment_modes.map((m) => n(m.amount)), 1) : 1;
  const maxItem = s ? Math.max(...s.top_items.map((i) => n(i.revenue)), 1) : 1;

  return (
    <div>
      <h1>Dashboard</h1>
      <p>How the business is doing — sales, profit, cash and stock in one place.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {mixedCurrency && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: 14 }}>
          <strong>Mixed currencies:</strong> the branches here use different currencies ({currencies.join(', ')}). Figures for
          “All branches” add them together as plain numbers — pick one branch for accurate money amounts.
        </div>
      )}

      <div className="card dash-controls">
        <div className="dash-presets">
          {PRESETS.map((p) => (
            <button key={p.key} className={`btn btn-sm ${preset === p.key ? 'btn-primary' : ''}`} onClick={() => choosePreset(p)}>{p.label}</button>
          ))}
        </div>
        <div className="dash-range">
          <div className="field" style={{ marginBottom: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} /></div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Branch</label>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="all">{isOwner ? 'All branches' : 'All my branches'}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading && !s && <p>Loading…</p>}

      {s && (
        <>
          <div className="grid grid-4 dash-kpis">
            <Kpi label="Net sales" value={money(s.net_sales)} sub={`${s.bill_count} bills · avg ${money(s.avg_bill)}`} />
            <Kpi label="Gross profit" value={money(s.gross_profit)} sub="after cost of goods, excl. tax" />
            <Kpi label={profit >= 0 ? 'Net profit' : 'Net loss'} value={money(s.net_profit)} tone={profit >= 0 ? 'good' : 'bad'} sub="after expenses & adjustments" />
            <Kpi label="Cash in hand (estimate)" value={money(s.cash_in_hand_estimate)} sub="cash sales − refunds − expenses" />
          </div>
          <div className="grid grid-4 dash-kpis">
            <Kpi label="Refunds" value={money(s.refunds_total)} sub={`${s.refund_count} refund${s.refund_count === 1 ? '' : 's'} / exchanges`} />
            <Kpi label="Tax to pay (net)" value={money(n(s.tax_collected) - n(s.tax_refunded))} sub="collected minus refunded" />
            <Kpi label="Money tied up in stock" value={money(s.stock_value)} sub={`${s.low_stock_count} item${s.low_stock_count === 1 ? '' : 's'} running low`} tone={s.low_stock_count > 0 ? 'warn' : undefined} />
            <Kpi label="Discounts given" value={money(s.discounts_given)} sub={`${s.held_bills} held bill${s.held_bills === 1 ? '' : 's'} waiting`} />
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h2>Profit &amp; loss</h2>
              <PnlRow label="Sales (incl. tax)" value={money(s.gross_sales)} />
              <PnlRow label="− Refunds" value={money(-n(s.refunds_total))} />
              <PnlRow label="= Net sales" value={money(s.net_sales)} strong />
              <PnlRow label="− Tax collected (net of refunds)" value={money(-(n(s.tax_collected) - n(s.tax_refunded)))} />
              <PnlRow label="= Net sales excluding tax" value={money(s.net_sales_ex_tax)} strong />
              <PnlRow label="− Cost of goods sold" value={money(-n(s.cogs))} />
              <PnlRow label="= Gross profit" value={money(s.gross_profit)} strong />
              <PnlRow label="± Expenses & adjustments" value={money(s.adjustments_total)} />
              <PnlRow label={profit >= 0 ? '= Net profit' : '= Net loss'} value={money(s.net_profit)} strong tone={profit >= 0 ? 'good' : 'bad'} />
              <p style={{ fontSize: 12, marginTop: 10 }}>
                Cost of goods uses each product's cost price at the time of sale — set a cost price on every product (Admin → Products)
                for accurate profit. Rent, salaries and other costs the POS can't see go in as expenses below.
              </p>
            </div>

            <div className="card">
              <h2>Sales vs refunds{s.range.bucket === 'month' ? ' (by month)' : ' (by day)'}</h2>
              {trendData && <Bar data={trendData} options={{ responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }} />}
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h2>How customers paid</h2>
              {s.payment_modes.length === 0 && <p>No payments in this period.</p>}
              {s.payment_modes.map((m) => (
                <div key={m.mode} className="bar-row">
                  <span className="bar-label">{m.mode === 'exchange_credit' ? 'exchange credit' : m.mode.replace('_', ' ')}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(n(m.amount) / maxMode) * 100}%` }} /></span>
                  <span className="num bar-value">{money(m.amount)}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <h2>Best-selling products</h2>
              {s.top_items.length === 0 && <p>No sales in this period.</p>}
              {s.top_items.map((i) => (
                <div key={i.name} className="bar-row">
                  <span className="bar-label">{i.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(n(i.revenue) / maxItem) * 100}%` }} /></span>
                  <span className="num bar-value">{money(i.revenue)} <small>×{n(i.qty)}</small></span>
                </div>
              ))}
            </div>
          </div>

          <AdjustmentsPanel
            adjustments={adjustments} branches={branches} defaultBranchId={branchFilter !== 'all' ? branchFilter : currentBranchId}
            user={user} isOwner={isOwner} money={money} onSaved={load} onDelete={(a) => setDeletingAdj(a)} setError={setError}
          />
        </>
      )}

      {deletingAdj && (
        <div className="modal-overlay" onClick={() => setDeletingAdj(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Remove this entry?</h2>
            <p>{CAT_LABEL[deletingAdj.category]}: {money(deletingAdj.amount)} — “{deletingAdj.reason}”. The Dashboard figures will update, and the removal is recorded in the activity log.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-danger" onClick={() => removeAdjustment(deletingAdj)}>Remove entry</button>
              <button className="btn" onClick={() => setDeletingAdj(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`card kpi${tone ? ` kpi-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function PnlRow({ label, value, strong, tone }) {
  return (
    <div className={`pnl-row${strong ? ' strong' : ''}${tone ? ` tone-${tone}` : ''}`}>
      <span>{label}</span><span className="num">{value}</span>
    </div>
  );
}

function AdjustmentsPanel({ adjustments, branches, defaultBranchId, user, isOwner, money, onSaved, onDelete, setError }) {
  const [form, setForm] = useState({ category: 'expense', amount: '', direction: -1, reason: '', branch_id: defaultBranchId || '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm((f) => ({ ...f, branch_id: defaultBranchId || f.branch_id })); }, [defaultBranchId]);

  const cat = ADJ_CATEGORIES.find((c) => c.key === form.category);

  async function save(e) {
    e.preventDefault();
    setError(null);
    const raw = Math.abs(Number(form.amount));
    if (!raw) return setError('Enter an amount.');
    if (!form.reason.trim()) return setError('Write a short reason so this entry makes sense later.');
    if (!form.branch_id) return setError('Pick a branch.');
    const sign = cat.sign !== 0 ? cat.sign : Number(form.direction);
    setBusy(true);
    const { error: err } = await supabase.from('financial_adjustments').insert({
      branch_id: form.branch_id, amount: raw * sign, category: form.category, reason: form.reason.trim(), created_by: user.id,
    });
    setBusy(false);
    if (err) return setError(err.message);
    logActivity('adjustment.create', { branchId: form.branch_id, entityType: 'financial_adjustment', details: { category: form.category, amount: raw * sign, reason: form.reason.trim() } });
    setForm((f) => ({ ...f, amount: '', reason: '' }));
    onSaved();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Expenses &amp; corrections</h2>
      <p>
        Past bills are never edited — that would erase your audit trail. If something is off (rent not counted, cash drawer
        short, a mistake in a figure), record it here as a visible entry; it flows straight into profit and cash above. A wrong
        entry can be removed by the Owner.
      </p>
      <form onSubmit={save} className="adj-form">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Type</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {ADJ_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        {cat.sign === 0 && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Effect</label>
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: Number(e.target.value) })}>
              <option value={1}>Adds money</option>
              <option value={-1}>Takes money away</option>
            </select>
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Amount</label>
          <input type="number" className="num" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Branch</label>
          <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
            <option value="">— pick —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 2, minWidth: 200 }}>
          <label>Reason</label>
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. October shop rent" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add entry'}</button>
      </form>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Branch</th><th>Reason</th><th>By</th><th className="num">Amount</th>{isOwner && <th />}</tr></thead>
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.id}>
                <td className="num">{new Date(a.created_at).toLocaleDateString()}</td>
                <td>{CAT_LABEL[a.category] || a.category}</td>
                <td>{a.branches?.name || '—'}</td>
                <td>{a.reason}</td>
                <td>{a.created_by_name || '—'}</td>
                <td className="num money" style={{ color: n(a.amount) < 0 ? 'var(--danger)' : 'var(--success)' }}>{money(a.amount)}</td>
                {isOwner && <td><button className="btn btn-sm" onClick={() => onDelete(a)}>Remove</button></td>}
              </tr>
            ))}
            {adjustments.length === 0 && <tr><td colSpan={isOwner ? 7 : 6}>No entries in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Staff without financial access still get a useful at-a-glance page:
// today's sales for the branches they work at, nothing about profit.
function SimpleDashboard() {
  const { branches } = useAuth();
  const [rows, setRows] = useState([]);

  useEffect(() => { load(); }, [branches]);
  useRealtimeRefresh('invoices', load);

  async function load() {
    if (branches.length === 0) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { data } = await supabase.from('invoices').select('branch_id, total_amount')
      .in('branch_id', branches.map((b) => b.id)).eq('status', 'completed').gte('created_at', start.toISOString());
    const map = {};
    branches.forEach((b) => { map[b.id] = { branch: b, total: 0, count: 0 }; });
    (data || []).forEach((r) => { if (map[r.branch_id]) { map[r.branch_id].total += n(r.total_amount); map[r.branch_id].count += 1; } });
    setRows(Object.values(map));
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Today's sales for your branch{branches.length === 1 ? '' : 'es'}.</p>
      <div className="grid grid-3">
        {rows.map((r) => (
          <div className="card" key={r.branch.id}>
            <h2>{r.branch.name}</h2>
            <p className="num" style={{ fontSize: 24, color: 'var(--ink)' }}>{r.branch.currency_symbol}{r.total.toFixed(2)}</p>
            <p>{r.count} bill(s) today</p>
          </div>
        ))}
        {rows.length === 0 && <p>You haven't been assigned to a branch yet.</p>}
      </div>
    </div>
  );
}
