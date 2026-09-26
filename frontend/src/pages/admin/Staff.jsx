import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../lib/realtime';
import PasswordInput from '../../components/PasswordInput';
import { logActivity } from '../../lib/activityLog';

export default function Staff() {
  const { profile: me } = useAuth();
  const [staff, setStaff] = useState([]);
  const [roleTemplates, setRoleTemplates] = useState([]);
  const [branches, setBranches] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '', role_template_id: '', branch_ids: [] });
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadAll(); }, []);
  useRealtimeRefresh('profiles', loadAll);

  async function loadAll() {
    const [{ data: staffRows }, { data: templates }, { data: branchRows }, { data: permRows }] = await Promise.all([
      supabase.from('profiles').select('*, role_templates ( name )').order('full_name'),
      supabase.from('role_templates').select('*').order('name'),
      supabase.from('branches').select('*').eq('is_active', true).order('name'),
      supabase.from('permissions').select('*').order('category'),
    ]);
    setStaff(staffRows || []);
    setRoleTemplates(templates || []);
    setBranches(branchRows || []);
    setPermissions(permRows || []);
  }

  async function createStaff(e) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) {
        setError('Your session has expired — please sign out and sign in again, then retry.');
        return;
      }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify(newUser),
      });
      let json;
      try {
        json = await res.json();
      } catch {
        setError(`Unexpected response from the server (status ${res.status}). Is the create-staff-user Edge Function deployed?`);
        return;
      }
      if (!res.ok) { setError(json.error || 'Failed to create user'); return; }
      setShowNew(false);
      setNewUser({ full_name: '', email: '', password: '', role_template_id: '', branch_ids: [] });
      loadAll();
    } catch (err) {
      setError(err.message || 'Something went wrong creating the account.');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(s) {
    setError(null);
    const { error } = await supabase.from('profiles').update({ is_active: !s.is_active }).eq('id', s.id);
    if (error) { setError(error.message); return; }
    logActivity(s.is_active ? 'staff.deactivate' : 'staff.activate', { entityType: 'profile', entityId: s.id, details: { full_name: s.full_name, email: s.email } });
    loadAll();
  }

  async function removeStaff(s) {
    setError(null);
    if (!window.confirm(`Permanently delete "${s.full_name}"'s account? This can't be undone. If they have any bills, refunds, or other records, the delete will be blocked automatically — deactivate them instead in that case.`)) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) throw new Error('Your session has expired — sign in again and retry.');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-staff-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ user_id: s.id }),
      });
      let json;
      try { json = await res.json(); } catch { throw new Error(`Unexpected response (status ${res.status}). Is delete-staff-user deployed?`); }
      if (!res.ok) throw new Error(json.error || 'Failed to delete account');
      loadAll();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    }
  }

  if (!me) return <div className="page-loading">Loading…</div>;

  return (
    <div>
      <h1>Staff & Permissions</h1>
      <p>Create logins, assign branches, and fine-tune exactly what each person can do.</p>
      {error && !showNew && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => setShowNew((s) => !s)}>
        {showNew ? 'Cancel' : '+ New staff account'}
      </button>

      {showNew && (
        <form className="card" onSubmit={createStaff} style={{ maxWidth: 480, marginBottom: 20 }}>
          <div className="field"><label>Full name</label><input required value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} /></div>
          <div className="field"><label>Email</label><input type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></div>
          <div className="field"><label>Temporary password</label><PasswordInput required minLength={8} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} autoComplete="new-password" /></div>
          <div className="field">
            <label>Role template (starting point)</label>
            <select value={newUser.role_template_id} onChange={(e) => setNewUser({ ...newUser, role_template_id: e.target.value })}>
              <option value="">— choose —</option>
              {roleTemplates.filter((t) => t.name !== 'Owner').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Branches</label>
            {branches.map((b) => (
              <label key={b.id} style={{ display: 'block', fontSize: 14 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={newUser.branch_ids.includes(b.id)}
                  onChange={(e) => setNewUser((u) => ({
                    ...u, branch_ids: e.target.checked ? [...u.branch_ids, b.id] : u.branch_ids.filter((id) => id !== b.id),
                  }))} /> {b.name}
              </label>
            ))}
          </div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create account'}</button>
        </form>
      )}

      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Template</th><th>Status</th><th /></tr></thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id}>
              <td>{s.full_name}{s.is_owner && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Owner</span>}</td>
              <td>{s.email}</td>
              <td>{s.role_templates?.name || '—'}</td>
              <td><span className={`badge ${s.is_active ? 'badge-success' : 'badge-neutral'}`}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
              <td>
                <button className="btn btn-sm" onClick={() => setSelected(s)}>Permissions</button>{' '}
                <button className="btn btn-sm" onClick={() => setEditing(s)}>Edit</button>{' '}
                {!s.is_owner && s.id !== me?.id && (
                  <>
                    <button className="btn btn-sm" onClick={() => toggleActive(s)}>{s.is_active ? 'Deactivate' : 'Reactivate'}</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => removeStaff(s)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {selected && (
        <PermissionMatrix
          user={selected}
          branches={branches}
          permissions={permissions}
          onClose={() => { setSelected(null); loadAll(); }}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          roleTemplates={roleTemplates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadAll(); }}
        />
      )}
    </div>
  );
}

function EditUserModal({ user, roleTemplates, onClose, onSaved }) {
  const [fullName, setFullName] = useState(user.full_name);
  const [roleTemplateId, setRoleTemplateId] = useState(user.role_template_id || '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    if (newPassword && newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ full_name: fullName, ...(user.is_owner ? {} : { role_template_id: roleTemplateId || null }) })
        .eq('id', user.id);
      if (profErr) throw profErr;
      logActivity('staff.update', { entityType: 'profile', entityId: user.id, details: { full_name: fullName, role_template_id: roleTemplateId || null } });

      if (newPassword) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session?.access_token) throw new Error('Your session has expired — sign in again and retry.');
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-staff-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
          body: JSON.stringify({ user_id: user.id, password: newPassword }),
        });
        let json;
        try { json = await res.json(); } catch { throw new Error(`Unexpected response (status ${res.status}). Is update-staff-password deployed?`); }
        if (!res.ok) throw new Error(json.error || 'Failed to update password');
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Edit {user.full_name}</h2>

        <div className="field"><label>Full name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>

        {!user.is_owner && (
          <div className="field">
            <label>Role template</label>
            <select value={roleTemplateId} onChange={(e) => setRoleTemplateId(e.target.value)}>
              <option value="">— none —</option>
              {roleTemplates.filter((t) => t.name !== 'Owner').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        <div className="field">
          <label>Set new password (leave blank to keep the current one)</label>
          <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" minLength={8} autoComplete="new-password" />
        </div>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function PermissionMatrix({ user, branches, permissions, onClose }) {
  const [templateDefaults, setTemplateDefaults] = useState({});
  const [overrides, setOverrides] = useState({});
  const [userBranches, setUserBranches] = useState([]);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => { load(); }, [user.id]);
  useRealtimeRefresh('user_permission_overrides', load, `user_id=eq.${user.id}`);
  useRealtimeRefresh('user_branches', load, `user_id=eq.${user.id}`);

  async function load() {
    const [{ data: defaults }, { data: over }, { data: ub }] = await Promise.all([
      user.role_template_id
        ? supabase.from('role_template_permissions').select('*').eq('role_template_id', user.role_template_id)
        : Promise.resolve({ data: [] }),
      supabase.from('user_permission_overrides').select('*').eq('user_id', user.id),
      supabase.from('user_branches').select('branch_id').eq('user_id', user.id),
    ]);
    setTemplateDefaults(Object.fromEntries((defaults || []).map((d) => [d.permission_key, d.allowed])));
    setOverrides(Object.fromEntries((over || []).map((o) => [o.permission_key, o.allowed])));
    setUserBranches((ub || []).map((r) => r.branch_id));
  }

  async function setOverride(key, value) {
    // value: 'default' | 'allow' | 'deny'
    setError(null);
    setSavingKey(key);
    const previous = overrides;

    // Update the dropdown immediately (optimistic) so it never looks
    // like "nothing happened" — then confirm against the server, and
    // roll back with a clear error if the write is actually rejected
    // (e.g. by the anti-privilege-escalation RLS rule).
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === 'default') delete next[key];
      else next[key] = value === 'allow';
      return next;
    });

    const { error } = value === 'default'
      ? await supabase.from('user_permission_overrides').delete().eq('user_id', user.id).eq('permission_key', key)
      : await supabase.from('user_permission_overrides').upsert(
          { user_id: user.id, permission_key: key, allowed: value === 'allow' },
          { onConflict: 'user_id,permission_key' }
        );

    setSavingKey(null);
    if (error) {
      setOverrides(previous); // roll back
      setError(`Couldn't update "${key}": ${error.message}`);
    } else {
      // Especially worth auditing: exactly who granted/revoked which
      // permission, for whom, and when.
      logActivity('permission.override_changed', {
        entityType: 'profile', entityId: user.id,
        details: { target_user: user.full_name, permission_key: key, new_value: value },
      });
    }
  }

  async function toggleBranch(branchId) {
    setError(null);
    const has = userBranches.includes(branchId);
    const previous = userBranches;
    setUserBranches((prev) => (has ? prev.filter((id) => id !== branchId) : [...prev, branchId]));

    const { error } = has
      ? await supabase.from('user_branches').delete().eq('user_id', user.id).eq('branch_id', branchId)
      : await supabase.from('user_branches').insert({ user_id: user.id, branch_id: branchId });

    if (error) {
      setUserBranches(previous);
      setError(`Couldn't update branch access: ${error.message}`);
    } else {
      logActivity(has ? 'permission.branch_access_revoked' : 'permission.branch_access_granted', {
        branchId, entityType: 'profile', entityId: user.id, details: { target_user: user.full_name },
      });
    }
  }

  const grouped = permissions.reduce((acc, p) => { (acc[p.category] ||= []).push(p); return acc; }, {});

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>{user.full_name} — access</h2>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <h3 style={{ marginTop: 14 }}>Branches</h3>
      {branches.map((b) => (
        <label key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 16 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={userBranches.includes(b.id)} onChange={() => toggleBranch(b.id)} /> {b.name}
        </label>
      ))}

      <h3 style={{ marginTop: 18 }}>Permissions</h3>
      <p>"Default" follows the {user.role_templates?.name || 'role'} template. Override any individual function as needed.</p>
      <div className="table-wrap">
      <table className="matrix-table">
        <thead><tr><th>Function</th><th>Template default</th><th>This user</th></tr></thead>
        <tbody>
          {Object.entries(grouped).map(([category, perms]) => (
            <>
              <tr key={category}><td colSpan={3} style={{ fontWeight: 700, background: 'var(--surface-sunken)' }}>{category}</td></tr>
              {perms.map((p) => {
                const def = templateDefaults[p.key] || false;
                const effectiveAllowed = p.key in overrides ? overrides[p.key] : def;
                return (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td><span className={`badge ${def ? 'badge-success' : 'badge-neutral'}`}>{def ? 'Allowed' : 'Not allowed'}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                        <span className={`badge ${effectiveAllowed ? 'badge-success' : 'badge-neutral'}`}>
                          {effectiveAllowed ? 'Allowed' : 'Not allowed'}
                        </span>
                        <select
                          value={p.key in overrides ? (overrides[p.key] ? 'allow' : 'deny') : 'default'}
                          onChange={(e) => setOverride(p.key, e.target.value)}
                          disabled={user.is_owner || savingKey === p.key}
                        >
                          <option value="default">Default ({def ? 'Allowed' : 'Not allowed'})</option>
                          <option value="allow">Force allow</option>
                          <option value="deny">Force deny</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </>
          ))}
        </tbody>
      </table></div>
      {user.is_owner && <p style={{ marginTop: 10 }}>The Owner account is unrestricted and ignores this matrix entirely.</p>}

      <button className="btn" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
    </div>
  );
}
