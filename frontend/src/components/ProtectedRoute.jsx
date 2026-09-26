import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, requirePermission, requireOwner }) {
  const { session, loading, can, isOwner } = useAuth();

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;

  // Stricter than requirePermission: no permission, delegated or
  // otherwise, ever satisfies this — only the actual Owner account.
  // Used for irreversible, business-wide actions (see Danger Zone)
  // where "someone I gave staff.manage to" isn't the right bar.
  if (requireOwner && !isOwner) {
    return (
      <div className="page-empty">
        <h2>No access</h2>
        <p>Only the Owner account can access this page.</p>
      </div>
    );
  }

  if (requirePermission && !isOwner && !can(requirePermission)) {
    return (
      <div className="page-empty">
        <h2>No access</h2>
        <p>Your account doesn't have permission to view this page. Ask the Owner to grant it from Admin → Staff.</p>
      </div>
    );
  }

  return children;
}
