import { supabase } from './supabaseClient';
import {
  getPendingInvoices,
  markInvoiceSynced,
  markInvoiceSyncing,
  markInvoiceError,
} from './localDb';

// Minimal pub-sub so any component (e.g. the offline badge in the
// header) can reflect live sync status without prop-drilling.
const listeners = new Set();
let state = { online: navigator.onLine, syncing: false, pendingCount: 0, lastError: null };

function emit() {
  listeners.forEach((fn) => fn(state));
}

export function subscribeSyncStatus(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

async function refreshPendingCount() {
  const pending = await getPendingInvoices();
  state = { ...state, pendingCount: pending.length };
  emit();
  return pending;
}

/**
 * Push every queued bill to Supabase, one at a time, in the order it
 * was created. Each call is idempotent (same client_ref = safe to
 * retry), so this can be called as often as we like — on reconnect,
 * on a timer, or manually — without ever risking a duplicate bill.
 */
export async function flushQueue() {
  if (!navigator.onLine) return;
  const pending = await refreshPendingCount();
  if (pending.length === 0) return;

  state = { ...state, syncing: true };
  emit();

  for (const row of pending) {
    try {
      await markInvoiceSyncing(row.client_ref);
      const { error } = await supabase.rpc('sync_invoice', { payload: row.payload });
      if (error) throw error;
      await markInvoiceSynced(row.client_ref);
      state = { ...state, lastError: null };
    } catch (err) {
      await markInvoiceError(row.client_ref, err.message || String(err));
      state = { ...state, lastError: err.message || String(err) };
      // Stop on first failure rather than hammering the API if
      // something structural is wrong (e.g. RLS denies it) — the
      // remaining items stay queued and will retry next pass.
      break;
    }
  }

  state = { ...state, syncing: false };
  await refreshPendingCount();
}

let intervalHandle = null;

/** Call once at app startup. */
export function startSyncEngine() {
  window.addEventListener('online', () => {
    state = { ...state, online: true };
    emit();
    flushQueue();
  });
  window.addEventListener('offline', () => {
    state = { ...state, online: false };
    emit();
  });

  // Belt-and-suspenders: retry every 20s even without a browser
  // 'online' event, since flaky wifi doesn't always fire one cleanly.
  intervalHandle = setInterval(flushQueue, 20000);

  refreshPendingCount();
  if (navigator.onLine) flushQueue();
}

export function stopSyncEngine() {
  if (intervalHandle) clearInterval(intervalHandle);
}
