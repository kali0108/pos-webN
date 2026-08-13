import { supabase } from './supabaseClient';

/**
 * Records an entry in the activity log via the log_activity() RPC —
 * the only sanctioned way to write to activity_log (see
 * supabase/migrations/0006_functions_triggers.sql): user_id is always
 * taken server-side from the caller's own session, so an entry can
 * never be forged as someone else.
 *
 * Deliberately fire-and-forget: a logging failure should never block
 * or roll back the actual action the user just took. If this fails,
 * it fails silently (aside from a console warning for debugging) —
 * the branch/product/permission change itself has already succeeded.
 */
export async function logActivity(action, { branchId = null, entityType = null, entityId = null, details = null } = {}) {
  try {
    const { error } = await supabase.rpc('log_activity', {
      p_action: action,
      p_branch_id: branchId,
      p_entity_type: entityType,
      p_entity_id: entityId ? String(entityId) : null,
      p_details: details,
    });
    if (error) console.warn('Activity log write failed:', error.message);
  } catch (err) {
    console.warn('Activity log write failed:', err.message);
  }
}
