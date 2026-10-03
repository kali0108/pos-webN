import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { buildEffectivePrices } from '../lib/pricing';
import Receipt from './Receipt';

const MODES = [
  { key: 'return', title: 'Return item(s)', desc: 'The customer brings items back. Stock goes back on the shelf automatically and the refund is worked out for you (including its share of any tax or discount).' },
  { key: 'simple', title: 'Money only', desc: 'Give an amount back without any item returning to stock (e.g. a complaint or a price adjustment).' },
  { key: 'exchange', title: 'Replace / exchange', desc: 'The customer returns item(s) and takes different one(s). Stock updates both ways and only the difference is settled.' },
];

const money = (n) => Number(n || 0).toFixed(2);

export default function RefundModal({ bill, onClose, onDone }) {
  const { can, isOwner, branches } = useAuth();
  const currency = bill.currency_symbol || branches.find((b) => b.id === bill.branch_id)?.currency_symbol || '';
  const canExchange = isOwner || can('bills.create');

  const [mode, setMode] = useState('return');
  const [lines, setLines] = useState([]);
  const [returnQty, setReturnQty] = useState({});
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [newLines, setNewLines] = useState([]);
  const [search, setSearch] = useState('');
  const [alreadyRefunded, setAlreadyRefunded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [receiptFor, setReceiptFor] = useState(null);

  // Each returned line is refunded in proportion to what was actually
  // paid for it — same rule the database applies (process_refund).
  const multiplier = Number(bill.subtotal) > 0 ? Number(bill.total_amount) / Number(bill.subtotal) : 1;
  const maxMoney = Math.max(Number(bill.total_amount) - alreadyRefunded, 0);

  useEffect(() => { load(); }, [bill.id]);

  async function load() {
    setLoading(true);
    const [{ data: lineRows }, { data: refundRows }, { data: itemRows }, { data: stockRows }, { data: ruleRows }] = await Promise.all([
      supabase.from('invoice_items').select('*').eq('invoice_id', bill.id),
      supabase.from('refunds').select('id, amount').eq('invoice_id', bill.id),
      supabase.from('items').select('id, name, sku, unit_price, category_id').eq('is_active', true).order('name'),
      supabase.from('branch_item_stock').select('item_id, quantity').eq('branch_id', bill.branch_id),
      supabase.from('discount_rules').select('*').eq('is_active', true),
    ]);
    const returnedByLine = {};
    const refundIds = (refundRows || []).map((r) => r.id);
    if (refundIds.length) {
      const { data: ri } = await supabase.from('refund_items').select('invoice_item_id, quantity').in('refund_id', refundIds);
      (ri || []).forEach((r) => { returnedByLine[r.invoice_item_id] = (returnedByLine[r.invoice_item_id] || 0) + Number(r.quantity); });
    }
    setLines((lineRows || []).map((l) => ({ ...l, remaining: Number(l.quantity) - (returnedByLine[l.id] || 0) })));
    setAlreadyRefunded((refundRows || []).reduce((s, r) => s + Number(r.amount), 0));
    const stockMap = Object.fromEntries((stockRows || []).map((s) => [s.item_id, Number(s.quantity)]));
    setCatalog(buildEffectivePrices(itemRows || [], ruleRows || []).map((i) => ({ ...i, stock_qty: stockMap[i.id] ?? 0 })));
    setLoading(false);
  }

  const returnTotal = lines.reduce(
    (sum, l) => sum + Math.round(Number(l.unit_price) * Number(returnQty[l.id] || 0) * multiplier * 100) / 100, 0
  );
  const newTotal = newLines.reduce((sum, l) => sum + Number(l.unit_price) * Number(l.quantity), 0);
  const net = newTotal - returnTotal;

  function setQty(line, raw) {
    const n = Math.max(0, Math.min(Number(raw) || 0, line.remaining));
    setReturnQty((q) => ({ ...q, [line.id]: n || '' }));
  }
  function addNewItem(item) {
    setNewLines((prev) => {
      const existing = prev.find((l) => l.item_id === item.id);
      if (existing) return prev.map((l) => (l.item_id === item.id ? { ...l, quantity: Math.min(l.quantity + 1, item.stock_qty) } : l));
      return [...prev, { item_id: item.id, item_name: item.name, unit_price: item.effective_price, quantity: 1, stock_qty: item.stock_qty }];
    });
  }
  function setNewQty(item_id, raw) {
    setNewLines((prev) => prev.map((l) => (l.item_id === item_id
      ? { ...l, quantity: Math.max(0, Math.min(Number(raw) || 0, l.stock_qty)) } : l)).filter((l) => l.quantity > 0));
  }

  async function submit() {
    setError(null);
    const returnItems = lines
      .map((l) => ({ invoice_item_id: l.id, quantity: Number(returnQty[l.id] || 0) }))
      .filter((x) => x.quantity > 0);

    if (mode === 'simple') {
      const amt = Number(amount);
      if (!amt || amt <= 0) return setError('Enter the amount to give back.');
      if (amt > maxMoney + 0.01) return setError(`The most that can still be refunded on this bill is ${currency}${money(maxMoney)}.`);
    } else {
      if (returnItems.length === 0) return setError('Choose at least one item that is being returned.');
      if (mode === 'exchange' && newLines.length === 0) return setError('Choose the replacement item(s) the customer is taking.');
    }

    const payload = { invoice_id: bill.id, refund_type: mode, reason: reason || null };
    if (mode === 'simple') payload.amount = Number(amount);
    else payload.return_items = returnItems;
    if (mode === 'exchange') {
      payload.new_items = newLines.map((l) => ({ item_id: l.item_id, item_name: l.item_name, quantity: l.quantity, unit_price: l.unit_price }));
    }

    setBusy(true);
    const { data, error: rpcErr } = await supabase.rpc('process_refund', { payload });
    setBusy(false);
    if (rpcErr) return setError(rpcErr.message);
    setResult(data);
  }

  const matches = catalog
    .filter((i) => !search.trim() || i.name.toLowerCase().includes(search.toLowerCase()) || i.sku?.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8);

  if (receiptFor) return <Receipt invoiceId={receiptFor} onClose={() => setReceiptFor(null)} />;

  if (result) {
    return (
      <div className="modal-overlay">
        <div className="modal-card" style={{ maxWidth: 480 }}>
          <h2 style={{ color: 'var(--success)' }}>Done</h2>
          <p>Bill {bill.invoice_number}: <strong>{currency}{money(result.amount)}</strong> {mode === 'exchange' ? 'credited for the returned item(s)' : 'refunded'}.</p>
          {mode !== 'simple' && <p>Returned items are back in stock.</p>}
          {mode === 'exchange' && (
            <>
              <p>Replacement bill <strong>{result.exchange_invoice_number}</strong> created and the new item(s) taken out of stock.</p>
              <p style={{ fontSize: 16, color: 'var(--ink)' }}>
                {Number(result.net_amount_due) > 0 && <>Customer pays <strong>{currency}{money(result.net_amount_due)}</strong> more.</>}
                {Number(result.net_amount_due) < 0 && <>Give the customer <strong>{currency}{money(-result.net_amount_due)}</strong> back.</>}
                {Number(result.net_amount_due) === 0 && <>Even swap — nothing to pay either way.</>}
              </p>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {mode === 'exchange' && result.exchange_invoice_id && (
              <button className="btn" onClick={() => setReceiptFor(result.exchange_invoice_id)}>Print replacement receipt</button>
            )}
            <button className="btn btn-primary" onClick={() => { onDone(); onClose(); }}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-card" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <h2>Refund / return — {bill.invoice_number}</h2>
        <p>Bill total <span className="num">{currency}{money(bill.total_amount)}</span>
          {alreadyRefunded > 0 && <> · already refunded <span className="num">{currency}{money(alreadyRefunded)}</span></>}</p>

        {loading ? <p>Loading…</p> : (
          <>
            <div className="mode-grid">
              {MODES.map((m) => {
                const disabled = m.key === 'exchange' && !canExchange;
                return (
                  <button key={m.key} type="button" disabled={disabled}
                    className={`mode-card${mode === m.key ? ' selected' : ''}`} onClick={() => setMode(m.key)}>
                    <strong>{m.title}</strong>
                    <span>{disabled ? 'Needs the "Create / edit bills" permission too.' : m.desc}</span>
                  </button>
                );
              })}
            </div>

            {mode === 'simple' && (
              <div className="field" style={{ marginTop: 14, maxWidth: 220 }}>
                <label>Amount to give back (max {currency}{money(maxMoney)})</label>
                <input type="number" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            )}

            {mode !== 'simple' && (
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table>
                  <thead><tr><th>Item</th><th className="num">Bought</th><th className="num">Can return</th><th className="num">Return qty</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.item_name}</td>
                        <td className="num">{Number(l.quantity)}</td>
                        <td className="num">{l.remaining}</td>
                        <td className="num">
                          <input type="number" className="num" style={{ width: 80 }} min={0} max={l.remaining}
                            disabled={l.remaining <= 0} value={returnQty[l.id] ?? ''} onChange={(e) => setQty(l, e.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ textAlign: 'right' }}>Refund for returned item(s): <strong className="num">{currency}{money(returnTotal)}</strong></p>
              </div>
            )}

            {mode === 'exchange' && (
              <div style={{ marginTop: 10 }}>
                <h3>Replacement item(s)</h3>
                <input placeholder="Search a product to hand over…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  {matches.map((i) => (
                    <button key={i.id} type="button" className="btn" disabled={i.stock_qty <= 0}
                      style={{ flexDirection: 'column', alignItems: 'flex-start' }} onClick={() => addNewItem(i)}>
                      <strong>{i.name}</strong>
                      <span className="num">{currency}{money(i.effective_price)} · {i.stock_qty > 0 ? `${i.stock_qty} in stock` : 'Out of stock'}</span>
                    </button>
                  ))}
                </div>
                {newLines.length > 0 && (
                  <div className="table-wrap" style={{ marginTop: 10 }}>
                    <table>
                      <thead><tr><th>Item</th><th className="num">Price</th><th className="num">Qty</th></tr></thead>
                      <tbody>
                        {newLines.map((l) => (
                          <tr key={l.item_id}>
                            <td>{l.item_name}</td>
                            <td className="num">{currency}{money(l.unit_price)}</td>
                            <td className="num"><input type="number" className="num" style={{ width: 80 }} min={0} max={l.stock_qty} value={l.quantity} onChange={(e) => setNewQty(l.item_id, e.target.value)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="card" style={{ marginTop: 10 }}>
                  <div className="bill-total-row"><span>Returned item(s) credit</span><span className="num">{currency}{money(returnTotal)}</span></div>
                  <div className="bill-total-row"><span>Replacement item(s)</span><span className="num">{currency}{money(newTotal)}</span></div>
                  <div className="bill-total-row grand">
                    <span>{net > 0 ? 'Customer pays' : net < 0 ? 'Give back to customer' : 'Even swap'}</span>
                    <span className="num">{currency}{money(Math.abs(net))}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="field" style={{ marginTop: 14 }}>
              <label>Reason (optional)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong flavour, damaged, changed mind" />
            </div>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? 'Processing…' : mode === 'exchange' ? 'Confirm exchange' : mode === 'return' ? 'Confirm return' : 'Confirm refund'}
              </button>
              <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
