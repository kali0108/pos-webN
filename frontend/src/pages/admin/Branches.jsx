import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../lib/realtime';
import { logActivity } from '../../lib/activityLog';

const empty = {
  code: '', name: '', address: '', phone: '',
  tax_label: 'Tax', tax_rate_percent: 0, currency_code: '', currency_symbol: '',
};

// A few common presets so setting up a new country isn't a guessing
// game — still fully editable, this is just a helpful starting point.
const TAX_PRESETS = [
  { label: 'Pakistan — Sales Tax 17%', tax_label: 'Sales Tax', tax_rate_percent: 17, currency_code: 'PKR', currency_symbol: 'Rs' },
  { label: 'Saudi Arabia — VAT 15%', tax_label: 'VAT', tax_rate_percent: 15, currency_code: 'SAR', currency_symbol: 'SAR' },
  { label: 'UAE — VAT 5%', tax_label: 'VAT', tax_rate_percent: 5, currency_code: 'AED', currency_symbol: 'AED' },
  { label: 'United Kingdom — VAT 20%', tax_label: 'VAT', tax_rate_percent: 20, currency_code: 'GBP', currency_symbol: '£' },
  { label: 'United States — Sales Tax (varies)', tax_label: 'Sales Tax', tax_rate_percent: 0, currency_code: 'USD', currency_symbol: '$' },
  { label: 'Custom / other country', tax_label: 'Tax', tax_rate_percent: 0, currency_code: '', currency_symbol: '' },
];

export default function Branches() {
  const { refresh } = useAuth();
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);
  useRealtimeRefresh('branches', load);

  async function load() {
    const { data } = await supabase.from('branches').select('*').order('name');
    setBranches(data || []);
  }

  function applyPreset(label) {
    const preset = TAX_PRESETS.find((p) => p.label === label);
    if (!preset) return;
    setForm((f) => ({ ...f, tax_label: preset.tax_label, tax_rate_percent: preset.tax_rate_percent, currency_code: preset.currency_code, currency_symbol: preset.currency_symbol }));
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    const payload = { ...form, tax_rate_percent: Number(form.tax_rate_percent) || 0 };
    if (editingId) {
      const { error } = await supabase.from('branches').update(payload).eq('id', editingId);
      if (error) { setError(error.message); return; }
      logActivity('branch.update', { branchId: editingId, entityType: 'branch', entityId: editingId, details: { code: payload.code, name: payload.name } });
    } else {
      const { data: newBranch, error } = await supabase.from('branches').insert(payload).select().single();
      if (error) { setError(error.message); return; }
      if (newBranch) {
        logActivity('branch.create', { branchId: newBranch.id, entityType: 'branch', entityId: newBranch.id, details: { code: payload.code, name: payload.name } });
        // Mirror what already happens for a NEW PRODUCT (which gets a
        // zero-stock row at every existing branch): a NEW BRANCH needs
        // a zero-stock row for every existing product too. Without
        // this, Inventory has nothing to adjust for the new branch —
        // there's no row to update — and every item shows as out of
        // stock on Billing, since a missing row and zero stock look
        // the same from there.
        const { data: activeItems } = await supabase.from('items').select('id').eq('is_active', true);
        if (activeItems?.length) {
          await supabase.from('branch_item_stock').upsert(
            activeItems.map((i) => ({ branch_id: newBranch.id, item_id: i.id, quantity: 0, reorder_level: 0 })),
            { onConflict: 'branch_id,item_id' }
          );
        }
      }
    }
    setForm(empty);
    setEditingId(null);
    await load();
    await refresh(); // pick up the new branch (and any tax/currency change) in the current user's switcher
  }

  function edit(b) {
    setForm({
      code: b.code, name: b.name, address: b.address || '', phone: b.phone || '',
      tax_label: b.tax_label, tax_rate_percent: b.tax_rate_percent, currency_code: b.currency_code, currency_symbol: b.currency_symbol,
    });
    setEditingId(b.id);
  }

  async function toggleActive(b) {
    setError(null);
    const { error } = await supabase.from('branches').update({ is_active: !b.is_active }).eq('id', b.id);
    if (error) { setError(error.message); return; }
    logActivity(b.is_active ? 'branch.deactivate' : 'branch.activate', { branchId: b.id, entityType: 'branch', entityId: b.id, details: { code: b.code, name: b.name } });
    load();
  }

  return (
    <div>
      <h1>Branches</h1>
      <p>Add, edit, or deactivate outlets — takes effect for every branch immediately, no deploy needed. Each branch has its own tax rate and currency, so this works the same way whether a branch is in Pakistan, Saudi Arabia, or anywhere else.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <form className="card" onSubmit={save} style={{ maxWidth: 520, marginBottom: 20 }}>
        <h2>{editingId ? 'Edit branch' : 'New branch'}</h2>
        <div className="grid grid-2">
          <div className="field"><label>Branch code (used as invoice prefix)</label><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} disabled={!!editingId} /></div>
          <div className="field"><label>Branch name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        </div>
        <div className="field"><label>Address</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="field"><label>Contact number</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>

        <div className="field">
          <label>Country / tax preset (optional shortcut)</label>
          <select defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
            <option value="" disabled>— pick a starting point, then adjust below —</option>
            {TAX_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
        </div>
        <div className="grid grid-3">
          <div className="field"><label>Tax name</label><input value={form.tax_label} onChange={(e) => setForm({ ...form, tax_label: e.target.value })} placeholder="Sales Tax, VAT, GST…" /></div>
          <div className="field"><label>Tax rate %</label><input type="number" className="num" step="0.01" value={form.tax_rate_percent} onChange={(e) => setForm({ ...form, tax_rate_percent: e.target.value })} /></div>
          <div className="field"><label>Currency symbol</label><input value={form.currency_symbol} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} placeholder="Rs, SAR, $, £…" /></div>
        </div>
        <div className="field" style={{ maxWidth: 160 }}><label>Currency code</label><input value={form.currency_code} onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })} placeholder="PKR, SAR, USD…" /></div>
        <p style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          This tax rate applies automatically to every bill at this branch. Cashiers see it on the bill but can't change it — only staff with the "Apply tax" permission can override it for a specific sale.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit">{editingId ? 'Save changes' : 'Add branch'}</button>
          {editingId && <button className="btn" type="button" onClick={() => { setForm(empty); setEditingId(null); }}>Cancel</button>}
        </div>
      </form>

      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Tax</th><th>Currency</th><th>Status</th><th /></tr></thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.id}>
              <td className="num">{b.code}</td>
              <td>{b.name}</td>
              <td>{b.tax_label} {b.tax_rate_percent}%</td>
              <td>{b.currency_code} ({b.currency_symbol})</td>
              <td><span className={`badge ${b.is_active ? 'badge-success' : 'badge-neutral'}`}>{b.is_active ? 'Active' : 'Inactive'}</span></td>
              <td>
                <button className="btn btn-sm" onClick={() => edit(b)}>Edit</button>{' '}
                <button className="btn btn-sm" onClick={() => toggleActive(b)}>{b.is_active ? 'Deactivate' : 'Reactivate'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
