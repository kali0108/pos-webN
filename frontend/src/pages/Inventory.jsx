import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useRealtimeRefresh } from '../lib/realtime';
import { logActivity } from '../lib/activityLog';
import { useWedgeScanner, sameCode } from '../lib/scanning';
import BarcodeScannerModal from '../components/BarcodeScannerModal';

export default function Inventory() {
  const { currentBranchId, can, isOwner } = useAuth();
  const [stock, setStock] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [consolidated, setConsolidated] = useState(false);
  const [amounts, setAmounts] = useState({}); // rowKey -> typed amount (string)
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState(null);
  const [scanning, setScanning] = useState(false);
  const tableRef = useRef(null);
  const canEdit = isOwner || can('inventory.edit');

  useEffect(() => { load(); }, [currentBranchId, consolidated]);
  useRealtimeRefresh('branch_item_stock', load, !consolidated && currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined);

  async function load() {
    let query = supabase
      .from('branch_item_stock')
      .select('branch_id, quantity, reorder_level, branches ( name ), items ( id, name, sku, unit_label )')
      .order('updated_at', { ascending: false });
    if (!consolidated) query = query.eq('branch_id', currentBranchId);
    const { data, error: loadErr } = await query;
    if (loadErr) setError(loadErr.message);
    // Guard against a dangling row whose item join came back empty
    // (shouldn't happen given the FK is ON DELETE CASCADE, but costs
    // nothing to be defensive rather than crash on s.items.id below).
    setStock((data || []).filter((s) => s.items));

    const { data: low } = await supabase.from('v_low_stock').select('*');
    setLowStock(low || []);
  }

  function rowKey(branch_id, item_id) { return `${branch_id}:${item_id}`; }

  async function backfillMissingProducts() {
    if (consolidated || !currentBranchId) return;
    setError(null);
    const { data: activeItems } = await supabase.from('items').select('id').eq('is_active', true);
    const existingIds = new Set(stock.map((s) => s.items?.id));
    const missing = (activeItems || []).filter((i) => !existingIds.has(i.id));
    if (missing.length === 0) return;
    const { error: upsertErr } = await supabase.from('branch_item_stock').upsert(
      missing.map((i) => ({ branch_id: currentBranchId, item_id: i.id, quantity: 0, reorder_level: 0 })),
      { onConflict: 'branch_id,item_id' }
    );
    if (upsertErr) { setError(upsertErr.message); return; }
    logActivity('inventory.backfill', { branchId: currentBranchId, entityType: 'branch_item_stock', details: { count: missing.length } });
    load();
  }

  async function applyDelta(branch_id, item_id, sign) {
    setError(null);
    const key = rowKey(branch_id, item_id);
    const typed = Number(amounts[key]);
    if (!typed || typed <= 0) return;
    const delta = sign * typed;
    const row = stock.find((s) => s.branch_id === branch_id && s.items?.id === item_id);
    const newQty = Math.max((row?.quantity || 0) + delta, 0);
    // upsert, not update: if this branch/item combination somehow has
    // no stock row yet (e.g. a branch created before this fix, or any
    // other gap), this still works instead of silently touching zero
    // rows and doing nothing.
    const { error: upsertErr } = await supabase.from('branch_item_stock').upsert(
      { branch_id, item_id, quantity: newQty, reorder_level: row?.reorder_level ?? 0 },
      { onConflict: 'branch_id,item_id' }
    );
    if (upsertErr) { setError(upsertErr.message); return; }
    await supabase.from('stock_movements').insert({
      branch_id, item_id, quantity_delta: newQty - (row?.quantity || 0), reason: delta > 0 ? 'restock' : 'correction',
    });
    logActivity(delta > 0 ? 'inventory.restock' : 'inventory.correction', {
      branchId: branch_id, entityType: 'item', entityId: item_id,
      details: { item: row?.items?.name, delta, new_quantity: newQty },
    });
    setAmounts((a) => ({ ...a, [key]: '' }));
    load();
  }

  async function setExactReorderLevel(branch_id, item_id, value) {
    setError(null);
    const row = stock.find((s) => s.branch_id === branch_id && s.items?.id === item_id);
    const { error: upsertErr } = await supabase.from('branch_item_stock').upsert(
      { branch_id, item_id, quantity: row?.quantity ?? 0, reorder_level: Math.max(Number(value) || 0, 0) },
      { onConflict: 'branch_id,item_id' }
    );
    if (upsertErr) { setError(upsertErr.message); return; }
    logActivity('inventory.reorder_level_set', { branchId: branch_id, entityType: 'item', entityId: item_id, details: { item: row?.items?.name, reorder_level: value } });
    load();
  }


  // Scan (or type + Enter) a product code to jump straight to its row
  // with the quantity box ready — scan, type 12, press Enter, done.
  useWedgeScanner((code) => findByCode(code), !scanning);

  function findByCode(raw) {
    const code = String(raw || '').trim();
    if (!code) return;
    // a tolerant exact match (e.g. UPC-A vs EAN-13) narrows to that product's own SKU text
    const exact = stock.find((s) => sameCode(s.items?.sku, code));
    const lookup = exact ? exact.items.sku : code;
    setQuery(lookup);
    const hits = stock.filter((s) => matches(s, lookup));
    if (hits.length === 0) {
      setNotice({ type: 'warn', text: `No stock record matches “${code}”${consolidated ? '' : ' at this branch'}. If it's a new product, add it under Products first.` });
      return;
    }
    setNotice(null);
    // wait for the filtered table to render, then focus the quantity box
    setTimeout(() => tableRef.current?.querySelector('input[data-amount]')?.focus(), 60);
  }

  const matches = (s, text) => {
    const t = text.toLowerCase();
    return s.items?.name?.toLowerCase().includes(t) || s.items?.sku?.toLowerCase().includes(t);
  };
  const shownStock = query.trim() ? stock.filter((s) => matches(s, query.trim())) : stock;

  return (
    <div>
      <h1>Inventory</h1>
      <p>Finished-goods stock {consolidated ? 'across all your branches' : 'for the selected branch'}. Type a quantity and press Add or Remove to adjust — no need to click one at a time.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Search by name or SKU — or scan a barcode and press Enter"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setNotice(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findByCode(query); } }}
          />
          <button className="btn btn-sm" type="button" onClick={() => setScanning(true)}>📷 Scan</button>
          {query && <button className="btn btn-sm" type="button" onClick={() => { setQuery(''); setNotice(null); }}>Clear</button>}
        </div>
      </div>
      {notice && <div className={`notice ${notice.type}`}><span>{notice.text}</span></div>}

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={consolidated} onChange={(e) => setConsolidated(e.target.checked)} />
        Show consolidated (all branches)
      </label>
      {!consolidated && (
        <button className="btn btn-sm" style={{ marginBottom: 16, marginLeft: 10 }} onClick={backfillMissingProducts}>
          Add any missing products to this branch
        </button>
      )}

      {lowStock.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--warning)' }}>
          <h2>⚠ Low stock</h2>
          <ul>
            {lowStock.map((l, i) => (
              <li key={i}>{l.branch_name}: {l.stock_item_name} — {l.quantity} left (reorder at {l.reorder_level})</li>
            ))}
          </ul>
        </div>
      )}

      <div className="table-wrap" ref={tableRef}><table>
        <thead>
          <tr><th>Item</th>{consolidated && <th>Branch</th>}<th className="num">Qty</th><th className="num">Reorder level</th>{canEdit && <th>Adjust stock</th>}</tr>
        </thead>
        <tbody>
          {shownStock.map((s, i) => {
            const key = rowKey(s.branch_id, s.items?.id);
            return (
              <tr key={i}>
                <td>{s.items?.name} <span style={{ color: 'var(--ink-soft)' }}>({s.items?.sku})</span></td>
                {consolidated && <td>{s.branches?.name || '—'}</td>}
                <td className="num">{s.quantity} {s.items?.unit_label}</td>
                <td className="num">
                  {canEdit ? (
                    <input type="number" className="num" style={{ width: 70 }} defaultValue={s.reorder_level}
                      onBlur={(e) => { if (Number(e.target.value) !== Number(s.reorder_level)) setExactReorderLevel(s.branch_id, s.items.id, e.target.value); }} />
                  ) : s.reorder_level}
                </td>
                {canEdit && (
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number"
                        data-amount
                        className="num"
                        placeholder="amount"
                        style={{ width: 80 }}
                        value={amounts[key] || ''}
                        onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') applyDelta(s.branch_id, s.items.id, 1); }}
                      />
                      <button className="btn btn-sm" onClick={() => applyDelta(s.branch_id, s.items.id, 1)}>Add</button>
                      <button className="btn btn-sm" onClick={() => applyDelta(s.branch_id, s.items.id, -1)}>Remove</button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {shownStock.length === 0 && <tr><td colSpan={5}>{stock.length === 0 ? 'No stock records yet.' : 'Nothing matches your search.'}</td></tr>}
        </tbody>
      </table></div>

      {scanning && (
        <BarcodeScannerModal
          title="Scan a product barcode"
          onClose={() => setScanning(false)}
          onDetected={(code) => { setScanning(false); findByCode(code); }}
        />
      )}
    </div>
  );
}
