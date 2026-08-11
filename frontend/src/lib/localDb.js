import Dexie from 'dexie';

// One IndexedDB database per browser/machine. This is what lets
// billing continue for a few minutes during a dropped connection:
// - `itemsCache` is a read-only mirror of the item catalog, refreshed
//   whenever we're online, so the billing screen can still look up
//   prices with no network at all.
// - `pendingInvoices` is the offline write queue. A bill created
//   offline is written here FIRST (instant, always succeeds), then
//   the sync engine (syncEngine.js) pushes it to Supabase the moment
//   connectivity returns. The row is only deleted locally after the
//   server confirms it was saved.
export const db = new Dexie('bakery_pos_local');

db.version(1).stores({
  itemsCache: 'id, name, sku, category',
  pendingInvoices: 'client_ref, branch_id, status, created_at',
  meta: 'key',
});

/** Save/refresh the local item catalog cache, scoped to one branch —
 *  each branch's stock levels are cached separately so switching
 *  branches while offline never shows a stale snapshot from whatever
 *  branch happened to be selected last time there was a connection. */
export async function cacheItems(items, branchId) {
  await db.meta.put({ key: `itemsCache:${branchId}`, value: items });
  await db.meta.put({ key: `itemsCachedAt:${branchId}`, value: new Date().toISOString() });
}

export async function getCachedItems(branchId) {
  const row = await db.meta.get(`itemsCache:${branchId}`);
  return row?.value || [];
}

/**
 * Queue a bill locally. `invoicePayload` is the full shape the server
 * expects (invoice fields + line items + payments). `client_ref` is
 * generated here, in the browser, and travels with the bill forever —
 * it's the idempotency key the server uses to avoid ever creating a
 * duplicate if the same bill gets synced twice (e.g. a retry after a
 * flaky connection). See docs/ARCHITECTURE.md, "Offline sync design".
 */
export async function queueInvoice(invoicePayload) {
  const row = {
    client_ref: invoicePayload.client_ref,
    branch_id: invoicePayload.branch_id,
    status: 'pending', // pending -> syncing -> synced (then removed) | error
    created_at: new Date().toISOString(),
    payload: invoicePayload,
    attempts: 0,
    last_error: null,
  };
  await db.pendingInvoices.put(row);
  return row;
}

export async function getPendingInvoices() {
  return db.pendingInvoices.where('status').notEqual('synced').toArray();
}

export async function markInvoiceSynced(client_ref) {
  await db.pendingInvoices.delete(client_ref);
}

export async function markInvoiceError(client_ref, message) {
  const row = await db.pendingInvoices.get(client_ref);
  if (!row) return;
  await db.pendingInvoices.put({
    ...row,
    status: 'error',
    attempts: (row.attempts || 0) + 1,
    last_error: message,
  });
}

export async function markInvoiceSyncing(client_ref) {
  const row = await db.pendingInvoices.get(client_ref);
  if (!row) return;
  await db.pendingInvoices.put({ ...row, status: 'syncing' });
}
