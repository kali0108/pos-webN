import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRealtimeRefresh } from '../../lib/realtime';

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [filterUser, setFilterUser] = useState('');
  const [staff, setStaff] = useState([]);

  useEffect(() => { loadStaff(); }, []);
  useEffect(() => { load(); }, [filterUser]);
  useRealtimeRefresh('activity_log', load);

  async function loadStaff() {
    const { data } = await supabase.from('profiles').select('id, full_name').order('full_name');
    setStaff(data || []);
  }

  async function load() {
    let query = supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (filterUser) query = query.eq('user_id', filterUser);
    const { data } = await query;
    setLogs(data || []);
  }

  return (
    <div>
      <h1>Activity Log</h1>
      <p>Every logged action, with who did it, when, and at which branch.</p>

      <div className="field" style={{ maxWidth: 260, marginBottom: 16 }}>
        <label>Filter by staff member</label>
        <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
          <option value="">Everyone</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Branch</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="num">{new Date(l.created_at).toLocaleString()}</td>
              <td>{l.user_name || '—'}</td>
              <td>{l.branch_name || '—'}</td>
              <td>{l.action}</td>
              <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{l.details ? JSON.stringify(l.details) : ''}</td>
            </tr>
          ))}
          {logs.length === 0 && <tr><td colSpan={5}>No activity recorded yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
