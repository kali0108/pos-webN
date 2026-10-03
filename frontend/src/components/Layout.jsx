import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import OfflineBadge from './OfflineBadge';

function NavItem({ to, children, onNavigate }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} onClick={onNavigate}>
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  // Navigating anywhere closes the mobile drawer automatically — a
  // cashier tapping a link expects the menu to get out of the way,
  // not to have to close it themselves as a second step.
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNavOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <span>🥐 Bakery POS</span>
          <button className="sidebar-close-btn" onClick={closeMobileNav} aria-label="Close menu">✕</button>
        </div>

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
            {(isOwner || can('bills.create')) && <NavItem to="/billing" onNavigate={closeMobileNav}>Billing</NavItem>}
            {(isOwner || can('bills.create')) && <NavItem to="/bills" onNavigate={closeMobileNav}>Bills</NavItem>}
            {(isOwner || can('orders.manage') || can('bills.create')) && (
              <NavItem to="/custom-orders" onNavigate={closeMobileNav}>Custom Orders</NavItem>
            )}
          </NavGroup>

          <NavGroup title="Operations" paths={['/inventory', '/availability', '/products', '/data', '/production']}>
            {(isOwner || can('inventory.view')) && <NavItem to="/inventory" onNavigate={closeMobileNav}>Inventory</NavItem>}
            {(isOwner || can('inventory.view')) && <NavItem to="/availability" onNavigate={closeMobileNav}>Availability</NavItem>}
            {(isOwner || can('inventory.edit')) && <NavItem to="/products" onNavigate={closeMobileNav}>Products</NavItem>}
            {(isOwner || can('data.export') || can('inventory.edit')) && <NavItem to="/data" onNavigate={closeMobileNav}>Import / Export</NavItem>}
            {(isOwner || can('production.edit')) && <NavItem to="/production" onNavigate={closeMobileNav}>Production</NavItem>}
          </NavGroup>

          <NavGroup title="Insights" paths={['/dashboard', '/reports', '/history']}>
            <NavItem to="/dashboard" onNavigate={closeMobileNav}>Dashboard</NavItem>
            {(isOwner || can('reports.sales.view') || can('reports.financial.view')) && (
              <NavItem to="/reports" onNavigate={closeMobileNav}>Reports</NavItem>
            )}
            {(isOwner || can('reports.sales.view')) && <NavItem to="/history" onNavigate={closeMobileNav}>History</NavItem>}
          </NavGroup>

          {(isOwner || can('staff.manage') || can('branches.manage') || can('discounts.manage')) && (
            <NavGroup title="Admin" paths={['/admin', '/discounts']}>
              {(isOwner || can('branches.manage')) && <NavItem to="/admin/branches" onNavigate={closeMobileNav}>Branches</NavItem>}
              {(isOwner || can('staff.manage')) && <NavItem to="/admin/staff" onNavigate={closeMobileNav}>Staff & Permissions</NavItem>}
              {(isOwner || can('discounts.manage')) && <NavItem to="/discounts" onNavigate={closeMobileNav}>Discounts</NavItem>}
              {(isOwner || can('staff.manage')) && <NavItem to="/admin/activity" onNavigate={closeMobileNav}>Activity Log</NavItem>}
              {isOwner && <NavItem to="/admin/danger-zone" onNavigate={closeMobileNav}>Danger Zone</NavItem>}
            </NavGroup>
          )}
        </nav>
      </aside>

      <div className={`sidebar-backdrop${mobileNavOpen ? ' open' : ''}`} onClick={closeMobileNav} />

      <div className="main">
        <div className="topbar">
          <button className="hamburger-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">☰</button>
          <div className="topbar-right">
            <OfflineBadge />
            <div style={{ fontSize: 14 }}>
              <span className="username-text">{profile?.full_name}</span> <span style={{ color: 'var(--ink-soft)' }}>{isOwner ? '· Owner' : ''}</span>
            </div>
            <button className="btn btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
