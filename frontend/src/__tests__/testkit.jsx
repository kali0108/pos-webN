import { vi } from 'vitest';

// ---------------------------------------------------------------
// A tiny stand-in for the Supabase client: every table is just an
// in-memory array, every query resolves with it. Enough to render
// every page and drive the scanner flows without a network.
// ---------------------------------------------------------------
export const db = {};
export const calls = [];   // every write the app attempts: { table, op, payload }
export const rpcResults = {}; // name -> value returned by supabase.rpc(name)

function builder(table) {
  const state = { table, single: false };
  const api = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve) => {
          const rows = db[table] || [];
          resolve({ data: state.single ? (rows[0] ?? null) : rows, error: null });
        };
      }
      if (prop === 'single' || prop === 'maybeSingle') return () => { state.single = true; return api; };
      if (['insert', 'update', 'upsert', 'delete'].includes(prop)) {
        return (payload) => { calls.push({ table, op: prop, payload }); return api; };
      }
      return () => api; // select / eq / in / order / limit / gte / lte / or / not / ...
    },
  });
  return api;
}

export const supabaseStub = {
  from: (table) => builder(table),
  rpc: (name) => Promise.resolve({ data: rpcResults[name] ?? null, error: null }),
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
  auth: {
    getSession: () => Promise.resolve({ data: { session: { access_token: 't', user: { id: 'u1', email: 'o@x.com' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
  },
};

export const BRANCH = { id: 'b1', code: 'LHR', name: 'Lahore', tax_label: 'Sales Tax', tax_rate_percent: 10, currency_code: 'PKR', currency_symbol: 'Rs' };

export function makeAuth(overrides = {}) {
  return {
    session: { access_token: 't' }, loading: false, user: { id: 'u1', email: 'o@x.com' },
    profile: { id: 'u1', full_name: 'The Owner', is_owner: true },
    isOwner: true, can: () => true,
    branches: [BRANCH], currentBranchId: 'b1',
    switchBranch: () => {}, refresh: async () => {}, signOut: async () => {},
    ...overrides,
  };
}

export function resetDb() {
  Object.keys(db).forEach((k) => delete db[k]);
  Object.keys(rpcResults).forEach((k) => delete rpcResults[k]);
  calls.length = 0;
  Object.assign(db, {
    categories: [{ id: 'c1', name: 'Cakes' }],
    items: [
      { id: 'i1', name: 'Chocolate Cake', sku: 'CAKE', category_id: 'c1', categories: { id: 'c1', name: 'Cakes' }, pricing_mode: 'unit', unit_label: 'pc', unit_price: 500, cost_price: 300, is_active: true },
      { id: 'i2', name: 'Vanilla Cupcake', sku: 'CUP', category_id: null, categories: null, pricing_mode: 'unit', unit_label: 'pc', unit_price: 100, cost_price: 60, is_active: true },
    ],
    branch_item_stock: [
      { branch_id: 'b1', item_id: 'i1', quantity: 5, reorder_level: 1, branches: { name: 'Lahore' }, items: { id: 'i1', name: 'Chocolate Cake', sku: 'CAKE', unit_label: 'pc' } },
      { branch_id: 'b1', item_id: 'i2', quantity: 9, reorder_level: 1, branches: { name: 'Lahore' }, items: { id: 'i2', name: 'Vanilla Cupcake', sku: 'CUP', unit_label: 'pc' } },
    ],
    discount_rules: [], branches: [BRANCH], profiles: [], invoices: [], refunds: [], activity_log: [], custom_orders: [],
    production_plans: [], production_actuals: [], financial_adjustments: [], v_low_stock: [],
  });
}

export const SUMMARY = {
  range: { from: '2026-10-01', to: '2026-10-04', bucket: 'day' },
  gross_sales: 2390, refunds_total: 1045, net_sales: 1345, tax_collected: 190, tax_refunded: 95, net_sales_ex_tax: 1250,
  discounts_given: 100, cogs: 780, gross_profit: 470, adjustments_total: -150, expenses: -200, net_profit: 320,
  bill_count: 4, refund_count: 2, avg_bill: 597.5, cash_in_hand_estimate: 1195,
  payment_modes: [{ mode: 'cash', amount: 2090 }, { mode: 'exchange_credit', amount: 300 }],
  trend: [{ bucket: '2026-10-03', sales: 1000, refunds: 495, adjustments: 0 }, { bucket: '2026-10-04', sales: 1390, refunds: 550, adjustments: -150 }],
  top_items: [{ name: 'Cake', qty: 4, revenue: 2000 }, { name: 'Bun', qty: 3, revenue: 300 }],
  stock_value: 17220, low_stock_count: 1, held_bills: 0,
};

// Send a burst of keystrokes the way a barcode scanner does (fast, then Enter).
export function scanCode(code, target = document.body) {
  for (const ch of code) target.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

export { vi };
