import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRealtimeRefresh } from '../../lib/realtime';

const empty = { name: '', sku: '', category_id: '', pricing_mode: 'unit', unit_label: 'pc', unit_price: '', cost_price: '' };

export default function Items() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, [showInactive]);
  useRealtimeRefresh('items', load);
  useRealtimeRefresh('categories', load);

  async function load() {
    let query = supabase.from('items').select('*, categories ( id, name )').order('name');
    if (!showInactive) query = query.eq('is_active', true);
    const [{ data, error }, { data: cats }] = await Promise.all([
      query,
      supabase.from('categories').select('*').order('name'),
    ]);
    if (error) setError(error.message);
    setItems(data || []);
    setCategories(cats || []);
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    const payload = {
      name: form.name,
      sku: form.sku || null,
      category_id: form.category_id || null,
      pricing_mode: form.pricing_mode,
      unit_label: form.unit_label,
      unit_price: Number(form.unit_price) || 0,
      cost_price: Number(form.cost_price) || 0,
    };
    const { data: inserted, error } = editingId
      ? await supabase.from('items').update(payload).eq('id', editingId).select().single()
      : await supabase.from('items').insert(payload).select().single();
    if (error) { setError(error.message); return; }

    if (!editingId) {
      // New product: give it a (zero) stock row at every active branch
      // right away, so it shows up in Inventory immediately instead of
      // being invisible until someone happens to adjust its stock.
      const { data: activeBranches } = await supabase.from('branches').select('id').eq('is_active', true);
      if (activeBranches?.length) {
        await supabase.from('branch_item_stock').upsert(
          activeBranches.map((b) => ({ branch_id: b.id, item_id: inserted.id, quantity: 0, reorder_level: 0 })),
          { onConflict: 'branch_id,item_id' }
        );
      }
    }
    setForm(empty);
    setEditingId(null);
    load();
  }

  function edit(item) {
    setForm({
      name: item.name, sku: item.sku || '', category_id: item.category_id || '',
      pricing_mode: item.pricing_mode, unit_label: item.unit_label,
      unit_price: item.unit_price, cost_price: item.cost_price || '',
    });
    setEditingId(item.id);
  }

  async function toggleActive(item) {
    const { error } = await supabase.from('items').update({ is_active: !item.is_active }).eq('id', item.id);
    if (error) { setError(error.message); return; }
    load();
  }

  return (
    <div>
      <h1>Products</h1>
      <p>The item catalog every branch bills from. Prices and product names are shared across all branches — stock levels aren't (see Inventory).</p>

      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => setShowCategories((s) => !s)}>
        {showCategories ? 'Hide category manager' : 'Manage categories'}
      </button>

      {showCategories && <CategoryManager categories={categories} onChanged={load} />}

      <form className="card" onSubmit={save} style={{ maxWidth: 480, marginBottom: 20 }}>
        <h2>{editingId ? 'Edit product' : 'New product'}</h2>
        <div className="field"><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-2">
          <div className="field"><label>SKU (optional)</label><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
          <div className="field">
            <label>Category</label>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">— none —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-3">
          <div className="field">
            <label>Priced by</label>
            <select value={form.pricing_mode} onChange={(e) => setForm({ ...form, pricing_mode: e.target.value })}>
              <option value="unit">Piece (unit)</option>
              <option value="weight">Weight</option>
            </select>
          </div>
          <div className="field"><label>Unit label</label><input placeholder="pc, kg, box…" value={form.unit_label} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} /></div>
          <div className="field"><label>Selling price</label><input type="number" className="num" required value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} /></div>
        </div>
        <div className="field" style={{ maxWidth: 160 }}><label>Cost price (optional, for margin reports)</label><input type="number" className="num" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></div>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit">{editingId ? 'Save changes' : 'Add product'}</button>
          {editingId && <button className="btn" type="button" onClick={() => { setForm(empty); setEditingId(null); }}>Cancel</button>}
        </div>
      </form>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show discontinued products too
      </label>

      <table>
        <thead><tr><th>Name</th><th>SKU</th><th>Category</th><th className="num">Price</th><th>Status</th><th /></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td className="num">{item.sku || '—'}</td>
              <td>{item.categories?.name || '—'}</td>
              <td className="num money">{Number(item.unit_price).toFixed(2)} / {item.unit_label}</td>
              <td><span className={`badge ${item.is_active ? 'badge-success' : 'badge-neutral'}`}>{item.is_active ? 'Active' : 'Discontinued'}</span></td>
              <td>
                <button className="btn btn-sm" onClick={() => edit(item)}>Edit</button>{' '}
                <button className="btn btn-sm" onClick={() => toggleActive(item)}>{item.is_active ? 'Discontinue' : 'Reactivate'}</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={6}>No products yet — add your first one above.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CategoryManager({ categories, onChanged }) {
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [error, setError] = useState(null);

  async function addCategory(e) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    const { error } = await supabase.from('categories').insert({ name: newName.trim() });
    if (error) { setError(error.message); return; }
    setNewName('');
    onChanged();
  }

  async function rename(cat) {
    if (!renaming?.name.trim()) return;
    const { error } = await supabase.from('categories').update({ name: renaming.name.trim() }).eq('id', cat.id);
    if (error) { setError(error.message); return; }
    setRenaming(null);
    onChanged();
  }

  async function remove(cat) {
    // Products in this category simply become uncategorized (category_id
    // is set to NULL by the database) — nothing else is deleted.
    const { error } = await supabase.from('categories').delete().eq('id', cat.id);
    if (error) { setError(error.message); return; }
    onChanged();
  }

  return (
    <div className="card" style={{ marginBottom: 20, maxWidth: 420 }}>
      <h2>Categories</h2>
      <form onSubmit={addCategory} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input placeholder="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn btn-sm" type="submit">Add</button>
      </form>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {categories.length === 0 && <p>No categories yet.</p>}
      {categories.map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {renaming?.id === c.id ? (
            <>
              <input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => rename(c)}>Save</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(null)}>✕</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }}>{c.name}</span>
              <button className="btn btn-sm" onClick={() => setRenaming({ id: c.id, name: c.name })}>Rename</button>
              <button className="btn btn-sm" onClick={() => remove(c)}>Delete</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
