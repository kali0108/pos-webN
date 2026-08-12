import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import OfflineBadge from './OfflineBadge';

function NavItem({ to, children }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
      {children}
    </NavLink>
  );
}

// Collapsible nav section — starts open only if the current page lives
// inside it, closed otherwise, and click the header to expand/collapse.
function NavGroup({ title, paths, children }) {
  const location = useLocation();
  const containsActive = paths.some((p) => location.pathname.startsWith(p));
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <div className="nav-group">
      <button type="button" className="nav-eyebrow-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="nav-eyebrow" style={{ marginBottom: 0 }}>{title}</span>
        <span className={`nav-caret${open ? ' open' : ''}`}>▾</span>
      </button>
      {open && <div>{children}</div>}
    </div>
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
          <NavGroup title="Sales" paths={['/billing', '/bills', '/custom-orders']}>
            {(isOwner || can('bills.create')) && <NavItem to="/billing">Billing</NavItem>}
            {(isOwner || can('bills.create')) && <NavItem to="/bills">Bills</NavItem>}
            {(isOwner || can('orders.manage') || can('bills.create')) && (
              <NavItem to="/custom-orders">Custom Orders</NavItem>
            )}
          </NavGroup>

          <NavGroup title="Operations" paths={['/inventory', '/availability', '/products', '/data', '/production']}>
            {(isOwner || can('inventory.view')) && <NavItem to="/inventory">Inventory</NavItem>}
            {(isOwner || can('inventory.view')) && <NavItem to="/availability">Availability</NavItem>}
            {(isOwner || can('inventory.edit')) && <NavItem to="/products">Products</NavItem>}
            {(isOwner || can('data.export') || can('inventory.edit')) && <NavItem to="/data">Import / Export</NavItem>}
            {(isOwner || can('production.edit')) && <NavItem to="/production">Production</NavItem>}
          </NavGroup>

          <NavGroup title="Insights" paths={['/dashboard', '/reports']}>
            <NavItem to="/dashboard">Dashboard</NavItem>
            {(isOwner || can('reports.sales.view') || can('reports.financial.view')) && (
              <NavItem to="/reports">Reports</NavItem>
            )}
          </NavGroup>

          {(isOwner || can('staff.manage') || can('branches.manage') || can('discounts.manage')) && (
            <NavGroup title="Admin" paths={['/admin', '/discounts']}>
              {(isOwner || can('branches.manage')) && <NavItem to="/admin/branches">Branches</NavItem>}
              {(isOwner || can('staff.manage')) && <NavItem to="/admin/staff">Staff & Permissions</NavItem>}
              {(isOwner || can('discounts.manage')) && <NavItem to="/discounts">Discounts</NavItem>}
              {(isOwner || can('staff.manage')) && <NavItem to="/admin/activity">Activity Log</NavItem>}
            </NavGroup>
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
