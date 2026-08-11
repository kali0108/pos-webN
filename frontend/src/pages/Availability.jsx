import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useRealtimeRefresh } from '../lib/realtime';

export default function Availability() {
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);
  useRealtimeRefresh('branch_item_stock', load);
  useRealtimeRefresh('items', load);
  useRealtimeRefresh('branches', load);

  async function load() {
    const [{ data: itemRows }, { data: branchRows }, { data: stock }] = await Promise.all([
      supabase.from('items').select('id, name, sku, unit_label').eq('is_active', true).order('name'),
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('branch_item_stock').select('branch_id, item_id, quantity'),
    ]);
    setItems(itemRows || []);
    setBranches(branchRows || []);
    setStockRows(stock || []);
  }

  const stockMap = {};
  stockRows.forEach((s) => { stockMap[`${s.branch_id}:${s.item_id}`] = Number(s.quantity); });

  const filtered = items.filter((i) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q);
  });

  return (
    <div>
      <h1>Availability</h1>
      <p>Which branches have a product in stock right now, without switching the branch selector — useful when a customer calls asking "is this available at your other branch?"</p>

      <input placeholder="Search product name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320, marginBottom: 16 }} />

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              {branches.map((b) => <th key={b.id} className="num">{b.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>{item.name} <span style={{ color: 'var(--ink-soft)' }}>({item.sku || '—'})</span></td>
                {branches.map((b) => {
                  const qty = stockMap[`${b.id}:${item.id}`];
                  const has = qty !== undefined;
                  return (
                    <td key={b.id} className="num">
                      {has ? (
                        <span className={`badge ${qty > 0 ? 'badge-success' : 'badge-danger'}`}>
                          {qty > 0 ? `${qty} ${item.unit_label}` : 'Out'}
                        </span>
                      ) : (
                        <span className="badge badge-neutral">Not stocked</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={branches.length + 1}>No products found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
