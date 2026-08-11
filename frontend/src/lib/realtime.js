import { useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

/**
 * Re-runs `onChange` whenever a row in `table` is inserted, updated,
 * or deleted — the fix for "I have to refresh to see what someone
 * else just did". Requires the table to be in the `supabase_realtime`
 * publication (see supabase/migrations/0011_realtime.sql); RLS still
 * governs which changes a given user actually receives.
 *
 * `filter` is an optional Postgres Changes filter string, e.g.
 * `branch_id=eq.${currentBranchId}` — pass it when the page only
 * cares about one branch, so a busy branch elsewhere doesn't cause
 * needless refetches here.
 *
 * Pass `enabled: false` to skip subscribing entirely (e.g. before
 * the current user's id is known yet) rather than subscribing with
 * no filter, which would ask for every row in the table.
 *
 * onChange is called via a ref internally so callers don't need to
 * memoize it themselves — the subscription is only re-created when
 * the table, filter, or enabled flag actually changes.
 */
export function useRealtimeRefresh(table, onChange, filter, enabled = true) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`rt:${table}:${filter || 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => onChangeRef.current()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, enabled]);
}
