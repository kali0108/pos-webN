import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Pages that work on "the selected branch" can't do anything with no
// branch at all — a brand-new system after a reset, or a staff member
// not assigned anywhere yet. Say so plainly instead of showing broken,
// empty screens (or failed queries for a branch id that doesn't exist).
export default function BranchRequired({ children }) {
  const { currentBranchId, isOwner, loading } = useAuth();
  if (loading) return null;
  if (currentBranchId) return children;
  return (
    <div className="page-empty">
      <h2>No branch to work in yet</h2>
      {isOwner ? (
        <p>Add your first branch to get started — <Link to="/admin/branches">Admin → Branches</Link>.</p>
      ) : (
        <p>You haven't been assigned to a branch yet. Ask the Owner to assign you from Admin → Staff &amp; Permissions.</p>
      )}
    </div>
  );
}
