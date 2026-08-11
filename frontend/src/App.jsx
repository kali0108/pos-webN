import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Billing from './pages/Billing'; // kept as a normal (non-lazy) import: this is the highest-traffic
// screen and must be ready the instant the shell loads, per the sub-2-second billing requirement.
import Inventory from './pages/Inventory';
import Availability from './pages/Availability';
import Items from './pages/admin/Items';
import DataManager from './pages/admin/DataManager';
import Bills from './pages/Bills';
import CustomOrders from './pages/CustomOrders';
import Production from './pages/Production';
import Branches from './pages/admin/Branches';
import Staff from './pages/admin/Staff';
import ActivityLog from './pages/admin/ActivityLog';

// Reports pulls in Chart.js + jsPDF + SheetJS — a few hundred KB
// nobody needs just to ring up a bill. Splitting it into its own
// chunk keeps those off the critical path for Billing.
const Reports = lazy(() => import('./pages/Reports'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/billing" element={<ProtectedRoute requirePermission="bills.create"><Billing /></ProtectedRoute>} />
            <Route path="/bills" element={<ProtectedRoute requirePermission="bills.create"><Bills /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute requirePermission="inventory.view"><Inventory /></ProtectedRoute>} />
            <Route path="/availability" element={<ProtectedRoute requirePermission="inventory.view"><Availability /></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute requirePermission="inventory.edit"><Items /></ProtectedRoute>} />
            <Route path="/data" element={<DataManager />} />
            <Route path="/custom-orders" element={<CustomOrders />} />
            <Route path="/production" element={<ProtectedRoute requirePermission="production.edit"><Production /></ProtectedRoute>} />
            <Route path="/reports" element={<Suspense fallback={<div className="page-loading">Loading…</div>}><Reports /></Suspense>} />
            <Route path="/admin/branches" element={<ProtectedRoute requirePermission="branches.manage"><Branches /></ProtectedRoute>} />
            <Route path="/admin/staff" element={<ProtectedRoute requirePermission="staff.manage"><Staff /></ProtectedRoute>} />
            <Route path="/admin/activity" element={<ProtectedRoute requirePermission="staff.manage"><ActivityLog /></ProtectedRoute>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
