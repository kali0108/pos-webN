import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useRealtimeRefresh } from '../lib/realtime';

export default function Dashboard() {
  const { branches, isOwner } = useAuth();
  const [summary, setSummary] = useState([]);
  const [drill, setDrill] = useState(null);

  useEffect(() => { load(); }, [branches]);
  useRealtimeRefresh('invoices', load);

  async function load() {
    if (branches.length === 0) return;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('invoices')
      .select('branch_id, total_amount, status')
      .in('branch_id', branches.map((b) => b.id))
      .eq('status', 'completed')
      .gte('created_at', startOfDay.toISOString());

    const map = {};
    branches.forEach((b) => { map[b.id] = { branch: b, total: 0, count: 0 }; });
    (data || []).forEach((r) => {
      if (map[r.branch_id]) { map[r.branch_id].total += Number(r.total_amount); map[r.branch_id].count += 1; }
    });
    setSummary(Object.values(map));
  }

  const companyTotal = summary.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Today's performance{isOwner ? ' across all active branches' : ' for your branches'}.</p>

      <div className="card" style={{ marginBottom: 16, maxWidth: 260 }}>
        <h2>Company-wide, today</h2>
        <p className="num" style={{ fontSize: 28, color: 'var(--ink)' }}>{companyTotal.toFixed(2)}</p>
      </div>

      <div className="grid grid-3">
        {summary.map((s) => (
          <div className="card" key={s.branch.id} style={{ cursor: 'pointer' }} onClick={() => setDrill(s)}>
            <h2>{s.branch.name}</h2>
            <p className="num" style={{ fontSize: 22, color: 'var(--ink)' }}>{s.total.toFixed(2)}</p>
            <p>{s.count} bill(s) today</p>
          </div>
        ))}
      </div>

      {drill && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2>{drill.branch.name} — detail</h2>
          <p>Branch code: {drill.branch.code}</p>
          <p>Today: {drill.count} bills, {drill.total.toFixed(2)} total. See the Reports page (with this branch selected) for line-level detail and exports.</p>
          <button className="btn btn-sm" onClick={() => setDrill(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
