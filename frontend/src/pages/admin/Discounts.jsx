import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRealtimeRefresh } from '../../lib/realtime';
import { logActivity } from '../../lib/activityLog';

const empty = { label: '', scope: 'category', category_id: '', item_id: '', discount_type: 'percent', discount_value: '' };

export default function Discounts() {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);
  useRealtimeRefresh('discount_rules', load);

  async function load() {
    const [{ data: ruleRows }, { data: catRows }, { data: itemRows }] = await Promise.all([
      supabase.from('discount_rules').select('*, categories ( name ), items ( name )').order('created_at', { ascending: false }),
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('items').select('id, name').eq('is_active', true).order('name'),
    ]);
    setRules(ruleRows || []);
    setCategories(catRows || []);
    setItems(itemRows || []);
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) { setError('Give this discount a name so it\'s easy to recognize later.'); return; }
    if (form.scope === 'category' && !form.category_id) { setError('Pick a category.'); return; }
    if (form.scope === 'item' && !form.item_id) { setError('Pick a product.'); return; }
    if (!form.discount_value || Number(form.discount_value) <= 0) { setError('Enter a discount amount greater than 0.'); return; }
    if (form.discount_type === 'percent' && Number(form.discount_value) > 100) { setError('A percentage discount can\'t be more than 100%.'); return; }

    const payload = {
      label: form.label.trim(),
      scope: form.scope,
      category_id: form.scope === 'category' ? form.category_id : null,
      item_id: form.scope === 'item' ? form.item_id : null,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
    };
    const { error } = await supabase.from('discount_rules').insert(payload);
    if (error) { setError(error.message); return; }
    logActivity('discount.create', { entityType: 'discount_rule', details: { label: payload.label, scope: payload.scope, discount_type: payload.discount_type, discount_value: payload.discount_value } });
    setForm(empty);
    load();
  }

  async function toggleActive(rule) {
    setError(null);
    const { error } = await supabase.from('discount_rules').update({ is_active: !rule.is_active }).eq('id', rule.id);
    if (error) { setError(error.message); return; }
    logActivity(rule.is_active ? 'discount.pause' : 'discount.resume', { entityType: 'discount_rule', entityId: rule.id, details: { label: rule.label } });
    load();
  }

  async function remove(rule) {
    setError(null);
    const { error } = await supabase.from('discount_rules').delete().eq('id', rule.id);
    if (error) { setError(error.message); return; }
    logActivity('discount.delete', { entityType: 'discount_rule', entityId: rule.id, details: { label: rule.label } });
    load();
  }

  return (
    <div>
      <h1>Discounts</h1>
      <p>Standing discounts that apply automatically the moment a product is added to a bill — the cashier never types anything for these. Set one up per category (e.g. "20% off all Cupcakes") or per specific product (e.g. "Rs 50 off Chocolate Cake"). An item-specific rule takes priority over a category-wide one for that same item.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <form className="card" onSubmit={save} style={{ maxWidth: 480, marginBottom: 20 }}>
        <h2>New discount</h2>
        <div className="field"><label>Name (for your reference)</label><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Weekend Cupcake Sale" /></div>

        <div className="field">
          <label>Applies to</label>
          <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, category_id: '', item_id: '' })}>
            <option value="category">A whole category</option>
            <option value="item">One specific product</option>
          </select>
        </div>

        {form.scope === 'category' ? (
          <div className="field">
            <label>Category</label>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">— choose —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ) : (
          <div className="field">
            <label>Product</label>
            <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
              <option value="">— choose —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-2">
          <div className="field">
            <label>Discount type</label>
            <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
              <option value="percent">Percentage off</option>
              <option value="fixed">Fixed amount off</option>
            </select>
          </div>
          <div className="field">
            <label>{form.discount_type === 'percent' ? 'Percent off' : 'Amount off'}</label>
            <input type="number" className="num" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} />
          </div>
        </div>

        <button className="btn btn-primary" type="submit">Add discount</button>
      </form>

      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Applies to</th><th className="num">Discount</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td>{r.scope === 'category' ? `Category: ${r.categories?.name || '—'}` : `Product: ${r.items?.name || '—'}`}</td>
              <td className="num">{r.discount_type === 'percent' ? `${r.discount_value}%` : r.discount_value}</td>
              <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-neutral'}`}>{r.is_active ? 'Active' : 'Paused'}</span></td>
              <td>
                <button className="btn btn-sm" onClick={() => toggleActive(r)}>{r.is_active ? 'Pause' : 'Resume'}</button>{' '}
                <button className="btn btn-sm" onClick={() => remove(r)}>Delete</button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && <tr><td colSpan={5}>No discounts set up yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
