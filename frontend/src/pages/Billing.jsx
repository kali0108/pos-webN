import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { cacheItems, getCachedItems, queueInvoice, getPendingInvoices } from '../lib/localDb';
import { flushQueue } from '../lib/syncEngine';
import { useAuth } from '../context/AuthContext';
import PermissionGate from '../components/PermissionGate';
import Receipt from '../components/Receipt';
import Calculator from '../components/Calculator';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { useRealtimeRefresh } from '../lib/realtime';

const PAYMENT_MODES = ['cash', 'card', 'mobile_wallet', 'bank_transfer', 'other'];

export default function Billing() {
  const { user, currentBranchId, branches, can, isOwner } = useAuth();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]); // { item_id, item_name, quantity, unit_price }
  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [taxPercent, setTaxPercent] = useState(0);
  const [payments, setPayments] = useState([{ mode: 'cash', amount: '' }]);
  const [cashReceived, setCashReceived] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [heldBills, setHeldBills] = useState([]);
  const [pendingLocal, setPendingLocal] = useState([]);
  const [receiptBill, setReceiptBill] = useState(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showCameraScan, setShowCameraScan] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const scanInputRef = useRef(null);
  const [resumingClientRef, setResumingClientRef] = useState(null); // client_ref of a held bill being edited, so completing it updates the SAME invoice instead of creating a duplicate
  const searchInputRef = useRef(null);

  const canDiscount = isOwner || can('bills.discount');
  const canTax = isOwner || can('bills.tax');
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  const currencySymbol = currentBranch?.currency_symbol || '';
  const taxLabel = currentBranch?.tax_label || 'Tax';

  // Tax defaults to the branch's configured rate the moment the
  // branch changes — a cashier never has to think about it at all;
  // only someone with bills.tax gets a field to override it.
  useEffect(() => {
    setTaxPercent(currentBranch?.tax_rate_percent ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranchId]);

  useEffect(() => {
    loadItems();
    loadHeldBills();
    refreshPendingLocal();
  }, [currentBranchId]);

  // Stock changed at THIS branch — from another terminal's sale, a
  // manual Inventory adjustment, or a new product being provisioned —
  // refresh the on-screen quantities live instead of showing stale
  // numbers until someone happens to reload the page.
  useRealtimeRefresh('branch_item_stock', loadItems, currentBranchId ? `branch_id=eq.${currentBranchId}` : undefined, !!currentBranchId);
  useRealtimeRefresh('items', loadItems);
  useRealtimeRefresh('discount_rules', loadItems);

  // Function-key shortcuts for fast counter use — F-keys are
  // intercepted with preventDefault so the browser's own shortcuts
  // (e.g. F3 opening Firefox's find bar) don't fire instead.
  useEffect(() => {
    function onKeyDown(e) {
      switch (e.key) {
        case 'F2':
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case 'F3':
          e.preventDefault();
          scanInputRef.current?.focus();
          break;
        case 'F4':
          e.preventDefault();
          setShowCalculator(true);
          break;
        case 'F8':
          e.preventDefault();
          if (!busy) submitBill('held');
          break;
        case 'F9':
          e.preventDefault();
          if (!busy) submitBill('completed');
          break;
        case 'Escape':
          if (cart.length > 0 && window.confirm('Clear the current bill?')) resetCart();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, cart.length, resumingClientRef, taxPercent, discount, payments, customerName, customerPhone, cashReceived]);

  async function loadItems() {
    try {
      const { data, error } = await supabase
        .from('items')
        .select('id, name, sku, category_id, pricing_mode, unit_label, unit_price')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;

      const { data: stockRows } = await supabase
        .from('branch_item_stock')
        .select('item_id, quantity')
        .eq('branch_id', currentBranchId);
      const stockMap = Object.fromEntries((stockRows || []).map((s) => [s.item_id, Number(s.quantity)]));

      const { data: ruleRows } = await supabase.from('discount_rules').select('*').eq('is_active', true);
      const itemRuleMap = new Map();
      const categoryRuleMap = new Map();
      (ruleRows || []).forEach((r) => {
        if (r.scope === 'item') itemRuleMap.set(r.item_id, r);
        else categoryRuleMap.set(r.category_id, r);
      });

      function applyRule(price, rule) {
        if (!rule) return price;
        if (rule.discount_type === 'percent') return Math.max(price * (1 - Number(rule.discount_value) / 100), 0);
        return Math.max(price - Number(rule.discount_value), 0);
      }

      // No stock row at all = treated as 0 (can't sell what isn't in the
      // inventory system yet), not as "unlimited" — matches "stock 0 ho
      // to item select na ho" for anything that was never stocked.
      const merged = data.map((i) => {
        // Item-specific discount rule wins over a category-wide one for
        // the same item, per the standing-discount design.
        const rule = itemRuleMap.get(i.id) || categoryRuleMap.get(i.category_id);
        const effectivePrice = Number(applyRule(i.unit_price, rule).toFixed(2));
        return {
          ...i, stock_qty: stockMap[i.id] ?? 0,
          effective_price: effectivePrice,
          discount_label: rule ? rule.label : null,
        };
      });

      setItems(merged);
      cacheItems(merged, currentBranchId);
    } catch {
      const cached = await getCachedItems(currentBranchId);
      setItems(cached);
      setMessage({ type: 'warn', text: 'Offline — showing last saved item list for this branch. Stock levels may be a little out of date until you reconnect.' });
    }
  }

  async function loadHeldBills() {
    if (!currentBranchId || !navigator.onLine) return;
    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_amount, customer_name, created_at')
      .eq('branch_id', currentBranchId)
      .eq('status', 'held')
      .order('created_at', { ascending: false })
      .limit(10);
    setHeldBills(data || []);
  }

  async function refreshPendingLocal() {
    setPendingLocal(await getPendingInvoices());
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q)).slice(0, 30);
  }, [items, search]);

  const subtotal = cart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  const discountAmount = canDiscount ? Number(discount) || 0 : 0;
  const taxableAmount = Math.max(subtotal - discountAmount, 0);
  // Tax applies automatically from the branch's configured rate for
  // everyone — bills.tax only controls whether the % field above can
  // be changed, not whether tax is charged at all.
  const taxAmount = Number((taxableAmount * (Number(taxPercent) || 0) / 100).toFixed(2));
  const total = Math.max(taxableAmount + taxAmount, 0);
  const paidTotal = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const changeDue = Math.max((Number(cashReceived) || 0) - total, 0);

  function addToCart(item) {
    const available = item.stock_qty ?? 0;
    if (available <= 0) {
      setMessage({ type: 'warn', text: `${item.name} is out of stock at this branch — can't add it to the bill.` });
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.item_id === item.id);
      if (existing && item.pricing_mode === 'unit') {
        if (existing.quantity + 1 > available) {
          setMessage({ type: 'warn', text: `Only ${available} ${item.unit_label} of ${item.name} left in stock.` });
          return prev;
        }
        return prev.map((l) => (l.item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (existing) return prev; // weight items: quantity is edited directly in the cart line
      return [
        ...prev,
        {
          item_id: item.id,
          item_name: item.name,
          pricing_mode: item.pricing_mode,
          unit_label: item.unit_label,
          stock_qty: available,
          quantity: item.pricing_mode === 'weight' ? Math.min(0.5, available) : 1,
          unit_price: item.effective_price ?? item.unit_price,
          original_price: item.unit_price,
          discount_label: item.discount_label || null,
        },
      ];
    });
  }

  function handleScan(rawCode) {
    const code = (rawCode || '').trim();
    if (!code) return;
    const match = items.find((i) => i.sku && i.sku.toLowerCase() === code.toLowerCase());
    if (!match) {
      setMessage({ type: 'warn', text: `No product found with SKU/barcode "${code}".` });
      return;
    }
    addToCart(match);
  }

  function updateQty(item_id, quantity) {
    setCart((prev) => prev.map((l) => {
      if (l.item_id !== item_id) return l;
      const max = l.stock_qty ?? Infinity;
      if (quantity > max) {
        setMessage({ type: 'warn', text: `Only ${max} ${l.unit_label} of ${l.item_name} in stock.` });
        return { ...l, quantity: max };
      }
      return { ...l, quantity: Math.max(quantity, 0) };
    }));
  }
  function removeLine(item_id) {
    setCart((prev) => prev.filter((l) => l.item_id !== item_id));
  }

  function resetCart() {
    setCart([]);
    setDiscount(0);
    setDiscountReason('');
    setTaxPercent(currentBranch?.tax_rate_percent ?? 0);
    setPayments([{ mode: 'cash', amount: '' }]);
    setCashReceived('');
    setCustomerName('');
    setCustomerPhone('');
    setResumingClientRef(null);
  }

  function buildPayload(status) {
    return {
      client_ref: resumingClientRef || crypto.randomUUID(),
      branch_id: currentBranchId,
      status,
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      subtotal,
      discount_amount: discountAmount,
      discount_reason: discountAmount > 0 ? discountReason : null,
      tax_amount: taxAmount,
      total_amount: total,
      device_created_at: new Date().toISOString(),
      items: cart.map((l) => ({
        item_id: l.item_id,
        item_name: l.item_name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        line_total: Number((l.quantity * l.unit_price).toFixed(2)),
      })),
      payments: status === 'completed'
        ? payments.filter((p) => Number(p.amount) > 0).map((p) => ({ mode: p.mode, amount: Number(p.amount) }))
        : [],
    };
  }

  async function submitBill(status) {
    if (cart.length === 0) {
      setMessage({ type: 'warn', text: 'Add at least one item first.' });
      return;
    }
    if (status === 'completed' && Math.round(paidTotal * 100) !== Math.round(total * 100)) {
      setMessage({ type: 'warn', text: `Payments (${currencySymbol}${paidTotal.toFixed(2)}) must add up to the total (${currencySymbol}${total.toFixed(2)}).` });
      return;
    }
    setBusy(true);
    const payload = buildPayload(status);
    const branchName = branches.find((b) => b.id === currentBranchId)?.name;

    // Try the direct, confirmed path first when we appear to be
    // online — this is what keeps the "under 2 seconds" response
    // time with a real invoice number in hand. If it fails for any
    // reason (including a connection that just dropped), we fall
    // back to the durable local queue so nothing is lost.
    if (navigator.onLine) {
      try {
        const { data, error } = await supabase.rpc('sync_invoice', { payload });
        if (error) throw error;
        setMessage({ type: 'ok', text: `${status === 'held' ? 'Held' : 'Completed'} — invoice ${data.invoice_number}` });
        if (status === 'completed') {
          setReceiptBill({ ...payload, invoice_number: data.invoice_number, branch_name: branchName, currency_symbol: currencySymbol, tax_label: taxLabel, created_at: new Date().toISOString() });
        }
        resetCart();
        loadHeldBills();
        setBusy(false);
        return;
      } catch (err) {
        // fall through to offline queue below
        console.warn('Direct sync failed, queuing offline:', err.message);
      }
    }

    await queueInvoice(payload);
    setMessage({
      type: 'warn',
      text: 'No connection right now — bill saved on this device and will sync automatically once you\'re back online.',
    });
    if (status === 'completed') {
      // Printable straight away from what's already in memory — the
      // invoice number just isn't assigned yet (that only happens on
      // the server once this syncs), so the receipt shows "Pending
      // sync" there. Once it syncs, the final numbered copy is always
      // available again from the Bills page.
      setReceiptBill({ ...payload, invoice_number: null, branch_name: branchName, currency_symbol: currencySymbol, tax_label: taxLabel, created_at: new Date().toISOString() });
    }
    resetCart();
    await refreshPendingLocal();
    setBusy(false);
  }

  async function resumeHeldBill(invoiceId) {
    const { data: inv, error: invErr } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
    const { data: lines, error: lineErr } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId);
    if (invErr || lineErr || !inv || !lines) {
      setMessage({ type: 'warn', text: `Couldn't load that held bill: ${invErr?.message || lineErr?.message || 'unknown error'}` });
      return;
    }
    // Carrying the ORIGINAL client_ref forward is what makes
    // "Complete bill" update this exact invoice instead of creating a
    // brand new one — without it, the held bill would sit there
    // forever while a separate, duplicate invoice gets completed.
    setResumingClientRef(inv.client_ref);
    setCart(lines.map((l) => {
      const catalogItem = items.find((i) => i.id === l.item_id);
      return {
        item_id: l.item_id, item_name: l.item_name, quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        pricing_mode: catalogItem?.pricing_mode || 'unit',
        unit_label: catalogItem?.unit_label || '',
        stock_qty: catalogItem?.stock_qty ?? Infinity, // unknown items (e.g. discontinued since) aren't stock-blocked here
      };
    }));
    setDiscount(inv.discount_amount);
    const taxableBase = Number(inv.subtotal) - Number(inv.discount_amount);
    setTaxPercent(taxableBase > 0 ? Number(((Number(inv.tax_amount) / taxableBase) * 100).toFixed(2)) : 0);
    setCustomerName(inv.customer_name || '');
    setCustomerPhone(inv.customer_phone || '');
    setMessage({ type: 'ok', text: `Resumed ${inv.invoice_number}. Completing it now will update this same bill.` });
  }

  return (
    <div>
      <h1>Billing</h1>
      <p>Scan/search an item, build the bill, then hold or complete it.</p>

      <button className="btn btn-sm" style={{ marginBottom: 14 }} onClick={() => setShowCalculator(true)}>🖩 Calculator</button>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: -8, marginBottom: 14 }}>
        Shortcuts: <strong>F2</strong> search · <strong>F3</strong> scan · <strong>F4</strong> calculator · <strong>F8</strong> hold · <strong>F9</strong> complete · <strong>Esc</strong> clear bill
      </p>

      {message && (
        <div className={`card`} style={{ marginBottom: 16, borderColor: message.type === 'ok' ? 'var(--success)' : 'var(--warning)' }}>
          {message.text}
        </div>
      )}

      <div className="bill-layout">
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              ref={scanInputRef}
              placeholder="Scan barcode / SKU, then press Enter…"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleScan(scanInput);
                  setScanInput('');
                  scanInputRef.current?.focus();
                }
              }}
              autoFocus
            />
            <button className="btn btn-sm" onClick={() => setShowCameraScan(true)}>📷 Scan</button>
          </div>
          <input ref={searchInputRef} placeholder="Search items by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            {filteredItems.map((item) => {
              const outOfStock = (item.stock_qty ?? 0) <= 0;
              return (
                <button
                  key={item.id}
                  className="btn"
                  disabled={outOfStock}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', minHeight: 72, height: 'auto', paddingTop: 8, paddingBottom: 8 }}
                  onClick={() => addToCart(item)}
                >
                  <strong>{item.name}</strong>
                  {item.discount_label ? (
                    <span className="num" style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ textDecoration: 'line-through', color: 'var(--ink-soft)', fontSize: 11 }}>{currencySymbol}{Number(item.unit_price).toFixed(2)}</span>
                      <span style={{ color: 'var(--success)' }}>{currencySymbol}{Number(item.effective_price).toFixed(2)}</span>
                    </span>
                  ) : (
                    <span className="num">{currencySymbol}{Number(item.unit_price).toFixed(2)} / {item.unit_label}</span>
                  )}
                  {item.discount_label && <span className="badge badge-success" style={{ fontSize: 10 }}>{item.discount_label}</span>}
                  <span className="num" style={{ fontSize: 11, color: outOfStock ? 'var(--danger)' : 'var(--ink-soft)' }}>
                    {outOfStock ? 'Out of stock' : `${item.stock_qty} ${item.unit_label} in stock`}
                  </span>
                </button>
              );
            })}
            {filteredItems.length === 0 && <p>No items found.</p>}
          </div>

          {heldBills.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h2>Held bills (this branch)</h2>
              <div className="table-wrap"><table>
                <thead><tr><th>Invoice</th><th>Customer</th><th className="num">Total</th><th /></tr></thead>
                <tbody>
                  {heldBills.map((h) => (
                    <tr key={h.id}>
                      <td className="invoice-number">{h.invoice_number}</td>
                      <td>{h.customer_name || '—'}</td>
                      <td className="num money">{currencySymbol}{Number(h.total_amount).toFixed(2)}</td>
                      <td><button className="btn btn-sm" onClick={() => resumeHeldBill(h.id)}>Resume</button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {pendingLocal.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h2>Queued on this device</h2>
              <p>These bills haven't reached the server yet — they'll sync automatically.</p>
              <ul>
                {pendingLocal.map((p) => (
                  <li key={p.client_ref} className="num">
                    {currencySymbol}{p.payload.total_amount?.toFixed?.(2)} · {p.status}{p.last_error ? ` · ${p.last_error}` : ''}
                  </li>
                ))}
              </ul>
              <button className="btn btn-sm" onClick={() => flushQueue().then(refreshPendingLocal)}>Retry sync now</button>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Current bill</h2>
          <div className="field">
            <label>Customer name (optional)</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div className="field">
            <label>Customer phone (optional)</label>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </div>

          {cart.length === 0 && <p>No items added yet.</p>}
          {cart.map((line) => (
            <div className="bill-line" key={line.item_id}>
              <span>{line.item_name}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  className="num"
                  style={{ width: 64 }}
                  step={line.pricing_mode === 'weight' ? 0.05 : 1}
                  max={line.stock_qty ?? undefined}
                  value={line.quantity}
                  onChange={(e) => updateQty(line.item_id, Number(e.target.value))}
                />
                <span className="num">× {currencySymbol}{line.unit_price.toFixed(2)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => removeLine(line.item_id)}>✕</button>
              </span>
            </div>
          ))}

          <PermissionGate permission="bills.discount">
            <div className="field" style={{ marginTop: 14 }}>
              <label>Discount amount</label>
              <input type="number" className="num" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <input placeholder="Reason (optional)" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} style={{ marginTop: 6 }} />
            </div>
          </PermissionGate>

          {/* Tax is applied automatically from this branch's configured
              rate for everyone. Only bills.tax holders get a field to
              override it for this specific bill — a cashier just sees
              the resulting line below, never an editable box. */}
          <PermissionGate permission="bills.tax">
            <div className="field" style={{ marginTop: 14, maxWidth: 160 }}>
              <label>{taxLabel} % (override for this bill)</label>
              <input type="number" className="num" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
            </div>
          </PermissionGate>

          {(discountAmount > 0 || taxAmount > 0) && (
            <div className="bill-total-row"><span>Subtotal</span><span className="num money">{currencySymbol}{subtotal.toFixed(2)}</span></div>
          )}
          {discountAmount > 0 && <div className="bill-total-row"><span>Discount</span><span className="num money">-{currencySymbol}{discountAmount.toFixed(2)}</span></div>}
          {taxAmount > 0 && <div className="bill-total-row"><span>{taxLabel} ({Number(taxPercent).toFixed(1)}%)</span><span className="num money">{currencySymbol}{taxAmount.toFixed(2)}</span></div>}
          <div className="bill-total-row grand"><span>Total</span><span className="num money">{currencySymbol}{total.toFixed(2)}</span></div>

          <div style={{ marginTop: 14 }}>
            <label>Payment</label>
            {payments.map((p, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <select value={p.mode} onChange={(e) => setPayments((prev) => prev.map((row, i) => i === idx ? { ...row, mode: e.target.value } : row))}>
                  {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
                <input type="number" className="num" placeholder="Amount" value={p.amount}
                  onChange={(e) => setPayments((prev) => prev.map((row, i) => i === idx ? { ...row, amount: e.target.value } : row))} />
                {payments.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setPayments((prev) => prev.filter((_, i) => i !== idx))}>✕</button>
                )}
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setPayments((prev) => [...prev, { mode: 'cash', amount: '' }])}>+ Add payment mode</button>
          </div>

          <div className="field" style={{ marginTop: 14, maxWidth: 220 }}>
            <label>Cash received from customer</label>
            <input type="number" className="num" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder="e.g. 2000" />
          </div>
          {Number(cashReceived) > 0 && (
            <div className="bill-total-row" style={{ color: changeDue > 0 ? 'var(--success)' : 'var(--ink-soft)' }}>
              <span>Change to return</span>
              <span className="num money">{currencySymbol}{changeDue.toFixed(2)}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn" disabled={busy} onClick={() => submitBill('held')}>Hold bill</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => submitBill('completed')} style={{ flex: 1, justifyContent: 'center' }}>
              Complete bill
            </button>
          </div>
        </div>
      </div>

      {receiptBill && (
        <Receipt
          bill={receiptBill}
          onClose={() => setReceiptBill(null)}
        />
      )}
      {showCalculator && <Calculator onClose={() => setShowCalculator(false)} />}
      {showCameraScan && (
        <BarcodeScannerModal
          onDetected={(code) => { handleScan(code); setShowCameraScan(false); }}
          onClose={() => setShowCameraScan(false)}
        />
      )}
    </div>
  );
}
