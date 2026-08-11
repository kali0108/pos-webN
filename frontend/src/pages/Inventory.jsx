import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useRealtimeRefresh } from '../lib/realtime';

export default function Inventory() {
  const { currentBranchId, can, isOwner } = useAuth();
  const [stock, setStock] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [consolidated, setConsolidated] = useState(false);
  const [amounts, setAmounts] = useState({}); // rowKey -> typed amount (string)
  const [error, setError] = useState(null);
  const canEdit = isOwner || can('inventory.edit');

  useEffect(() => { load(); }, [currentBranchId, consolidated]);
  useRealtimeRefresh('branch_item_stock', load, !consolidated && currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined);

  async function load() {
    let query = supabase
      .from('branch_item_stock')
      .select('branch_id, quantity, reorder_level, items ( id, name, sku, unit_label )')
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
    load();
  }

  return (
    <div>
      <h1>Inventory</h1>
      <p>Finished-goods stock {consolidated ? 'across all your branches' : 'for the selected branch'}. Type a quantity and press Add or Remove to adjust — no need to click one at a time.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

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

      <table>
        <thead>
          <tr><th>Item</th>{consolidated && <th>Branch</th>}<th className="num">Qty</th><th className="num">Reorder level</th>{canEdit && <th>Adjust stock</th>}</tr>
        </thead>
        <tbody>
          {stock.map((s, i) => {
            const key = rowKey(s.branch_id, s.items?.id);
            return (
              <tr key={i}>
                <td>{s.items?.name} <span style={{ color: 'var(--ink-soft)' }}>({s.items?.sku})</span></td>
                {consolidated && <td>{s.branch_id.slice(0, 8)}…</td>}
                <td className="num">{s.quantity} {s.items?.unit_label}</td>
                <td className="num">
                  {canEdit ? (
                    <input type="number" className="num" style={{ width: 70 }} defaultValue={s.reorder_level}
                      onBlur={(e) => setExactReorderLevel(s.branch_id, s.items.id, e.target.value)} />
                  ) : s.reorder_level}
                </td>
                {canEdit && (
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number"
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
          {stock.length === 0 && <tr><td colSpan={5}>No stock records yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
