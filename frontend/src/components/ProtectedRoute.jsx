import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, requirePermission }) {
  const { session, loading, can, isOwner } = useAuth();

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;

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
