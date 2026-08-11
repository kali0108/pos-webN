import { useAuth } from '../context/AuthContext';

/**
 * Usage: <PermissionGate permission="bills.refund"><button>Refund</button></PermissionGate>
 * Purely a UI convenience — the real enforcement is server-side RLS
 * (see supabase/migrations/0005_rls_policies.sql), so hiding a button
 * here is about a clean, uncluttered interface for staff, not security.
 */
export default function PermissionGate({ permission, fallback = null, children }) {
  const { can, isOwner } = useAuth();
  if (isOwner || can(permission)) return children;
  return fallback;
}
