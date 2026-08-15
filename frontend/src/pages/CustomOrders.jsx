import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import PermissionGate from '../components/PermissionGate';
import { useRealtimeRefresh } from '../lib/realtime';
import { logActivity } from '../lib/activityLog';

const STATUSES = ['Placed', 'In Production', 'Ready', 'Delivered', 'Cancelled'];
const STATUS_BADGE = { Placed: 'neutral', 'In Production': 'warning', Ready: 'success', Delivered: 'success', Cancelled: 'danger' };

export default function CustomOrders() {
  const { currentBranchId } = useAuth();
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', description: '', deposit_amount: 0, total_amount: 0, due_date: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, [currentBranchId]);
  useRealtimeRefresh('custom_orders', load, currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined, !!currentBranchId);

  async function load() {
    const { data } = await supabase.from('custom_orders').select('*').eq('branch_id', currentBranchId).order('due_date');
    setOrders(data || []);
  }

  async function createOrder(e) {
    e.preventDefault();
    setError(null);
    const { data: inserted, error } = await supabase.from('custom_orders').insert({ ...form, branch_id: currentBranchId }).select().single();
    if (error) { setError(error.message); return; }
    logActivity('custom_order.create', { branchId: currentBranchId, entityType: 'custom_order', entityId: inserted?.id, details: { customer_name: form.customer_name, total_amount: form.total_amount } });
    setForm({ customer_name: '', customer_phone: '', description: '', deposit_amount: 0, total_amount: 0, due_date: '' });
    setShowForm(false);
    load();
  }

  async function advanceStatus(order) {
    setError(null);
    const idx = STATUSES.indexOf(order.status);
    const next = STATUSES[Math.min(idx + 1, 3)]; // never auto-advance into Cancelled
    const { error } = await supabase.from('custom_orders').update({ status: next }).eq('id', order.id);
    if (error) { setError(error.message); return; }
    logActivity('custom_order.status_change', { branchId: currentBranchId, entityType: 'custom_order', entityId: order.id, details: { customer_name: order.customer_name, new_status: next } });
    await supabase.from('custom_order_status_history').insert({ order_id: order.id, status: next });
    load();
  }

  return (
    <div>
      <h1>Custom Orders</h1>
      <p>Cake bookings and advance deposits, tracked from placement to delivery.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <PermissionGate permission="orders.manage">
        <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ New order'}
        </button>
      </PermissionGate>

      {showForm && (
        <form className="card" onSubmit={createOrder} style={{ marginBottom: 16, maxWidth: 480 }}>
          <div className="grid grid-2">
            <div className="field"><label>Customer name</label><input required value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
            <div className="field"><label>Phone</label><input required value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></div>
          </div>
          <div className="field"><label>Order details (flavor, size, message)</label><textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="grid grid-3">
            <div className="field"><label>Deposit</label><input type="number" className="num" value={form.deposit_amount} onChange={(e) => setForm({ ...form, deposit_amount: e.target.value })} /></div>
            <div className="field"><label>Total price</label><input type="number" className="num" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} /></div>
            <div className="field"><label>Due date</label><input type="datetime-local" required value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary" type="submit">Save order</button>
        </form>
      )}

      <div className="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Details</th><th className="num">Deposit</th><th className="num">Total</th><th>Due</th><th>Status</th><th /></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.customer_name}<br /><span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{o.customer_phone}</span></td>
              <td>{o.description}</td>
              <td className="num money">{Number(o.deposit_amount).toFixed(2)}</td>
              <td className="num money">{Number(o.total_amount).toFixed(2)}</td>
              <td>{new Date(o.due_date).toLocaleDateString()}</td>
              <td><span className={`badge badge-${STATUS_BADGE[o.status]}`}>{o.status}</span></td>
              <td>
                <PermissionGate permission="orders.manage">
                  {o.status !== 'Delivered' && o.status !== 'Cancelled' && (
                    <button className="btn btn-sm" onClick={() => advanceStatus(o)}>Advance →</button>
                  )}
                </PermissionGate>
              </td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={7}>No custom orders for this branch yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
