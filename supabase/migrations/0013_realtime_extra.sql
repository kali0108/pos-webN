-- =====================================================================
-- 0013_realtime_extra.sql
-- A couple more tables worth watching live: production tracking is
-- often logged by more than one person through a shift, and the
-- activity log is the Owner's live audit trail.
-- =====================================================================

alter publication supabase_realtime add table
  production_plans,
  production_actuals,
  activity_log;
