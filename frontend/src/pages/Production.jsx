import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useRealtimeRefresh } from '../lib/realtime';
import { logActivity } from '../lib/activityLog';

function today() { return new Date().toISOString().slice(0, 10); }

export default function Production() {
  const { currentBranchId, user } = useAuth();
  const [date, setDate] = useState(today());
  const [items, setItems] = useState([]);
  const [plans, setPlans] = useState([]);
  const [actuals, setActuals] = useState([]);
  const [entry, setEntry] = useState({}); // item_id -> { planned, actual, wastage }
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, [currentBranchId, date]);
  useRealtimeRefresh('production_plans', load, currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined, !!currentBranchId);
  useRealtimeRefresh('production_actuals', load, currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined, !!currentBranchId);

  async function load() {
    const { data: itemRows } = await supabase.from('items').select('id, name, unit_label').eq('is_active', true).order('name');
    setItems(itemRows || []);
    const { data: planRows } = await supabase.from('production_plans').select('*').eq('branch_id', currentBranchId).eq('plan_date', date);
    setPlans(planRows || []);
    const { data: actualRows } = await supabase.from('production_actuals').select('*').eq('branch_id', currentBranchId).eq('production_date', date);
    setActuals(actualRows || []);
  }

  function planFor(item_id) { return plans.find((p) => p.item_id === item_id); }
  function actualFor(item_id) { return actuals.find((a) => a.item_id === item_id); }

  async function savePlan(item_id) {
    setError(null);
    const planned = Number(entry[item_id]?.planned || 0);
    const { error: err } = await supabase.from('production_plans').upsert(
      { branch_id: currentBranchId, item_id, plan_date: date, planned_quantity: planned, created_by: user.id },
      { onConflict: 'branch_id,item_id,plan_date' }
    );
    if (err) { setError(err.message); return; }
    logActivity('production.plan_saved', { branchId: currentBranchId, entityType: 'item', entityId: item_id, details: { date, planned_quantity: planned } });
    load();
  }

  async function saveActual(item_id) {
    setError(null);
    const actual = Number(entry[item_id]?.actual || 0);
    const wastage = Number(entry[item_id]?.wastage || 0);
    const plan = planFor(item_id);
    const { error: err } = await supabase.from('production_actuals').insert({
      plan_id: plan?.id || null, branch_id: currentBranchId, item_id, production_date: date,
      actual_quantity: actual, wastage_quantity: wastage, recorded_by: user.id,
    });
    if (err) { setError(err.message); return; }
    logActivity('production.actual_logged', { branchId: currentBranchId, entityType: 'item', entityId: item_id, details: { date, actual_quantity: actual, wastage_quantity: wastage } });
    load();
  }

  return (
    <div>
      <h1>Production Tracking</h1>
      <p>Plan vs. actual for {date}. Saving an actual auto-deducts raw materials via the recipe and adds finished goods to stock.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="field" style={{ maxWidth: 200, marginBottom: 16 }}>
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="table-wrap"><table>
        <thead>
          <tr><th>Item</th><th className="num">Planned</th><th className="num">Actual so far</th><th className="num">Wastage so far</th><th>Log actual</th></tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const plan = planFor(item.id);
            const totalActual = actuals.filter((a) => a.item_id === item.id).reduce((s, a) => s + Number(a.actual_quantity), 0);
            const totalWastage = actuals.filter((a) => a.item_id === item.id).reduce((s, a) => s + Number(a.wastage_quantity), 0);
            return (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td className="num">
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <input type="number" className="num" style={{ width: 70 }} defaultValue={plan?.planned_quantity || ''}
                      onChange={(e) => setEntry((s) => ({ ...s, [item.id]: { ...s[item.id], planned: e.target.value } }))} />
                    <button className="btn btn-sm" onClick={() => savePlan(item.id)}>Save</button>
                  </div>
                </td>
                <td className="num">{totalActual}</td>
                <td className="num">{totalWastage}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="number" className="num" placeholder="actual" style={{ width: 64 }}
                      onChange={(e) => setEntry((s) => ({ ...s, [item.id]: { ...s[item.id], actual: e.target.value } }))} />
                    <input type="number" className="num" placeholder="wastage" style={{ width: 64 }}
                      onChange={(e) => setEntry((s) => ({ ...s, [item.id]: { ...s[item.id], wastage: e.target.value } }))} />
                    <button className="btn btn-sm" onClick={() => saveActual(item.id)}>Log</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
