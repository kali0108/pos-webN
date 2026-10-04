import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRealtimeRefresh } from '../../lib/realtime';
import { logActivity } from '../../lib/activityLog';
import { useWedgeScanner, handleScannerEnter, sameCode } from '../../lib/scanning';
import { printBarcodeLabels } from '../../lib/barcodeLabel';
import ConfirmPasswordModal from '../../components/ConfirmPasswordModal';
import BarcodeScannerModal from '../../components/BarcodeScannerModal';

const empty = { name: '', sku: '', category_id: '', pricing_mode: 'unit', unit_label: 'pc', unit_price: '', cost_price: '' };

const sameSku = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export default function Items() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [pinnedId, setPinnedId] = useState(null); // set when a scan picked ONE exact product: show only that row
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'warn', text, code? }
  const [scanFor, setScanFor] = useState(null); // 'find' | 'sku' | null (camera scanner open for…)
  const formRef = useRef(null);
  const nameRef = useRef(null);
  const priceRef = useRef(null);

  useEffect(() => { load(); }, [showInactive]);
  useRealtimeRefresh('items', load);
  useRealtimeRefresh('categories', load);

  // A USB/Bluetooth scanner works here without clicking anywhere first:
  // scan a code and the matching product is selected for editing.
  useWedgeScanner((code) => findByCode(code), !deleting && !scanFor);

  async function load() {
    let q = supabase.from('items').select('*, categories ( id, name )').order('name');
    if (!showInactive) q = q.eq('is_active', true);
    const [{ data, error: err }, { data: cats }] = await Promise.all([
      q,
      supabase.from('categories').select('*').order('name'),
    ]);
    if (err) setError(err.message);
    setItems(data || []);
    setCategories(cats || []);
  }

  const textMatches = (item, text) => {
    const t = text.toLowerCase();
    return item.name.toLowerCase().includes(t) || item.sku?.toLowerCase().includes(t) || item.categories?.name?.toLowerCase().includes(t);
  };
  const shown = pinnedId
    ? items.filter((i) => i.id === pinnedId)
    : query.trim() ? items.filter((i) => textMatches(i, query.trim())) : items;

  // Scan (or type + Enter) a code to SELECT a product, or — if no
  // product has that code yet — offer to add one with it.
  function findByCode(raw) {
    const code = String(raw || '').trim();
    if (!code) return;
    const exact = items.find((i) => sameCode(i.sku, code));
    if (exact) {
      setQuery(exact.sku);
      setPinnedId(exact.id); // only this product stays in the list, so Delete / Discontinue / Label are right there
      edit(exact);
      setNotice({ type: 'ok', text: `Selected “${exact.name}” (${exact.sku}). Change it below, or use Discontinue / Delete / Label in the list.` });
      return;
    }
    setPinnedId(null);
    const matches = items.filter((i) => textMatches(i, code));
    if (matches.length === 1) {
      setQuery('');
      edit(matches[0]);
      setNotice({ type: 'ok', text: `Selected “${matches[0].name}”.` });
      return;
    }
    setQuery(code);
    setNotice(matches.length > 0
      ? { type: 'warn', text: `${matches.length} products match “${code}” — pick one from the list.` }
      : { type: 'warn', text: `No product has the code “${code}” yet.`, code });
  }

  function startNewWithCode(code) {
    setEditingId(null);
    setForm({ ...empty, sku: code });
    setNotice(null);
    setQuery('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => nameRef.current?.focus(), 250);
  }

  function generateSku() {
    const taken = new Set(items.map((i) => (i.sku || '').toLowerCase()));
    let code;
    do { code = `BK-${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`; } while (taken.has(code.toLowerCase()));
    setForm((f) => ({ ...f, sku: code }));
  }

  function onSkuScanned(code) {
    setScanFor(null);
    const clash = items.find((i) => sameSku(i.sku, code) && i.id !== editingId);
    setForm((f) => ({ ...f, sku: code }));
    if (clash) setError(`The code “${code}” already belongs to “${clash.name}”. Pick a different code, or select that product to edit it instead.`);
    else setError(null);
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    const sku = form.sku.trim();
    const clash = sku && items.find((i) => sameSku(i.sku, sku) && i.id !== editingId);
    if (clash) { setError(`The code “${sku}” already belongs to “${clash.name}”.`); return; }
    const payload = {
      name: form.name.trim(),
      sku: sku || null,
      category_id: form.category_id || null,
      pricing_mode: form.pricing_mode,
      unit_label: form.unit_label,
      unit_price: Number(form.unit_price) || 0,
      cost_price: Number(form.cost_price) || 0,
    };
    const { data: inserted, error: err } = editingId
      ? await supabase.from('items').update(payload).eq('id', editingId).select().single()
      : await supabase.from('items').insert(payload).select().single();
    if (err) {
      setError(err.code === '23505' ? `The code “${sku}” is already used by another product (it may be a discontinued one — tick “Show discontinued products too”).` : err.message);
      return;
    }
    logActivity(editingId ? 'product.update' : 'product.create', { entityType: 'item', entityId: inserted?.id || editingId, details: { name: payload.name, sku: payload.sku, unit_price: payload.unit_price } });

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
    setPinnedId(null);
    setQuery('');
    setNotice({ type: 'ok', text: editingId ? `Saved “${payload.name}”.` : `Added “${payload.name}”. Scan the next barcode to add another.` });
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
    setError(null);
    // The form sits above a long list — bring it into view.
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function toggleActive(item) {
    const { error: err } = await supabase.from('items').update({ is_active: !item.is_active }).eq('id', item.id);
    if (err) { setError(err.message); return; }
    logActivity(item.is_active ? 'product.discontinue' : 'product.reactivate', { entityType: 'item', entityId: item.id, details: { name: item.name, sku: item.sku } });
    load();
  }

  async function confirmDelete(password) {
    const { data, error: err } = await supabase.rpc('delete_item', { p_item_id: deleting.id, p_password: password });
    if (err) return err.message;
    if (!data?.ok) return data?.error || 'Could not delete this product.';
    if (editingId === deleting.id) { setForm(empty); setEditingId(null); }
    setPinnedId(null);
    setQuery('');
    setDeleting(null);
    load();
    return null;
  }

  function printLabels(list) {
    const res = printBarcodeLabels(list.map((i) => ({ name: i.name, sku: i.sku })));
    if (res.error) setNotice({ type: 'warn', text: res.error });
    else if (res.printed === 0) setNotice({ type: 'warn', text: 'None of these products has a SKU / barcode yet — add one first (use “Generate code”).' });
    else if (res.skipped) setNotice({ type: 'warn', text: `${res.skipped} label(s) skipped — their SKU has characters a barcode can't hold.` });
  }

  return (
    <div>
      <h1>Products</h1>
      <p>The item catalog every branch bills from. Prices and product names are shared across all branches — stock levels aren't (see Inventory).</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Find / select a product</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Search by name, SKU or category — or scan a barcode, then press Enter"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPinnedId(null); setNotice(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findByCode(query); } }}
          />
          <button className="btn btn-sm" type="button" onClick={() => setScanFor('find')}>📷 Scan</button>
          {(query || pinnedId) && <button className="btn btn-sm" type="button" onClick={() => { setQuery(''); setPinnedId(null); setNotice(null); }}>Clear</button>}
        </div>
        <p style={{ fontSize: 12, marginTop: 8 }}>
          With a USB/Bluetooth scanner you can just scan — no need to click anywhere first. Scanning a product's barcode selects it for editing;
          scanning a code that isn't in the catalog yet lets you add it.
        </p>
      </div>

      {notice && (
        <div className={`notice ${notice.type}`}>
          <span>{notice.text}</span>
          {notice.code && <button className="btn btn-sm btn-primary" type="button" onClick={() => startNewWithCode(notice.code)}>Add it as a new product</button>}
        </div>
      )}

      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={() => setShowCategories((s) => !s)}>
        {showCategories ? 'Hide category manager' : 'Manage categories'}
      </button>

      {showCategories && <CategoryManager categories={categories} onChanged={load} />}

      <form ref={formRef} className="card" onSubmit={save} style={{ maxWidth: 520, marginBottom: 20, scrollMarginTop: 12 }}>
        <h2>{editingId ? 'Edit product' : 'New product'}</h2>
        <div className="field"><label>Name</label><input ref={nameRef} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-2">
          <div className="field">
            <label>SKU / barcode (optional)</label>
            <input
              value={form.sku}
              placeholder="scan, type, or generate"
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              onKeyDown={(e) => handleScannerEnter(e, () => (form.name ? priceRef.current : nameRef.current)?.focus())}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" type="button" onClick={() => setScanFor('sku')}>📷 Scan</button>
              <button className="btn btn-sm" type="button" onClick={generateSku}>Generate code</button>
            </div>
          </div>
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
          <div className="field"><label>Selling price</label><input ref={priceRef} type="number" step="0.01" min="0" className="num" required value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} /></div>
        </div>
        <div className="field" style={{ maxWidth: 200 }}><label>Cost price (for profit reports)</label><input type="number" step="0.01" min="0" className="num" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></div>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit">{editingId ? 'Save changes' : 'Add product'}</button>
          {(editingId || form.name || form.sku) && <button className="btn" type="button" onClick={() => { setForm(empty); setEditingId(null); setError(null); }}>{editingId ? 'Cancel' : 'Clear'}</button>}
        </div>
      </form>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show discontinued products too
        </label>
        <button className="btn btn-sm" type="button" onClick={() => printLabels(shown)}>Print barcode labels ({shown.filter((i) => i.sku).length})</button>
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{shown.length} of {items.length} shown</span>
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>SKU</th><th>Category</th><th className="num">Price</th><th>Status</th><th /></tr></thead>
        <tbody>
          {shown.map((item) => (
            <tr key={item.id} className={editingId === item.id ? 'row-selected' : undefined}>
              <td>{item.name}</td>
              <td className="num">{item.sku || '—'}</td>
              <td>{item.categories?.name || '—'}</td>
              <td className="num money">{Number(item.unit_price).toFixed(2)} / {item.unit_label}</td>
              <td><span className={`badge ${item.is_active ? 'badge-success' : 'badge-neutral'}`}>{item.is_active ? 'Active' : 'Discontinued'}</span></td>
              <td>
                <button className="btn btn-sm" onClick={() => edit(item)}>Edit</button>{' '}
                <button className="btn btn-sm" onClick={() => toggleActive(item)}>{item.is_active ? 'Discontinue' : 'Reactivate'}</button>{' '}
                {item.sku && <><button className="btn btn-sm" onClick={() => printLabels([item])}>Label</button>{' '}</>}
                <button className="btn btn-sm btn-danger" onClick={() => setDeleting(item)}>Delete</button>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={6}>{items.length === 0 ? 'No products yet — add your first one above.' : 'Nothing matches your search.'}</td></tr>}
        </tbody>
      </table></div>

      {scanFor && (
        <BarcodeScannerModal
          title={scanFor === 'sku' ? 'Scan the barcode for this product' : 'Scan a product barcode'}
          onClose={() => setScanFor(null)}
          onDetected={(code) => { if (scanFor === 'sku') onSkuScanned(code); else { setScanFor(null); findByCode(code); } }}
        />
      )}

      {deleting && (
        <ConfirmPasswordModal
          title={`Delete "${deleting.name}"?`}
          message="This permanently removes the product and its stock rows. Every past bill that included it keeps the product's name, price and quantity, so old receipts and reports are unaffected."
          confirmLabel="Delete product"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
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
