import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OfflineBadge from './OfflineBadge';

function NavItem({ to, children }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
      {children}
    </NavLink>
  );
}

export default function Layout() {
  const { profile, isOwner, can, branches, currentBranchId, switchBranch, signOut } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">🥐 Bakery POS</div>

        {branches.length > 0 && (
          <select
            className="branch-switcher"
            value={currentBranchId || ''}
            onChange={(e) => switchBranch(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

        <nav>
          <div className="nav-group">
            <div className="nav-eyebrow">Sales</div>
            {(isOwner || can('bills.create')) && <NavItem to="/billing">Billing</NavItem>}
            {(isOwner || can('bills.create')) && <NavItem to="/bills">Bills</NavItem>}
            {(isOwner || can('orders.manage') || can('bills.create')) && (
              <NavItem to="/custom-orders">Custom Orders</NavItem>
            )}
          </div>

          <div className="nav-group">
            <div className="nav-eyebrow">Operations</div>
            {(isOwner || can('inventory.view')) && <NavItem to="/inventory">Inventory</NavItem>}
            {(isOwner || can('inventory.view')) && <NavItem to="/availability">Availability</NavItem>}
            {(isOwner || can('inventory.edit')) && <NavItem to="/products">Products</NavItem>}
            {(isOwner || can('data.export') || can('inventory.edit')) && <NavItem to="/data">Import / Export</NavItem>}
            {(isOwner || can('production.edit')) && <NavItem to="/production">Production</NavItem>}
          </div>

          <div className="nav-group">
            <div className="nav-eyebrow">Insights</div>
            <NavItem to="/dashboard">Dashboard</NavItem>
            {(isOwner || can('reports.sales.view') || can('reports.financial.view')) && (
              <NavItem to="/reports">Reports</NavItem>
            )}
          </div>

          {(isOwner || can('staff.manage') || can('branches.manage')) && (
            <div className="nav-group">
              <div className="nav-eyebrow">Admin</div>
              {(isOwner || can('branches.manage')) && <NavItem to="/admin/branches">Branches</NavItem>}
              {(isOwner || can('staff.manage')) && <NavItem to="/admin/staff">Staff & Permissions</NavItem>}
              {(isOwner || can('staff.manage')) && <NavItem to="/admin/activity">Activity Log</NavItem>}
            </div>
          )}
        </nav>
      </aside>

      <div className="main">
        <div className="topbar">
          <OfflineBadge />
          <div style={{ fontSize: 14 }}>
            {profile?.full_name} <span style={{ color: 'var(--ink-soft)' }}>{isOwner ? '· Owner' : ''}</span>
          </div>
          <button className="btn btn-sm" onClick={signOut}>Sign out</button>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
