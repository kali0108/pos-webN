import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * Two ways to use this:
 *  - <Receipt bill={{...}} onClose={...} /> — prints straight from data
 *    already in memory (e.g. the bill you just completed). Works even
 *    if it hasn't synced to the server yet — the invoice number just
 *    shows as "Pending sync" until it has.
 *  - <Receipt invoiceId="..." onClose={...} /> — fetches a past
 *    invoice from the server, for reprinting from Bills history.
 */
export default function Receipt({ bill, invoiceId, onClose }) {
  const [data, setData] = useState(bill || null);
  const [loading, setLoading] = useState(!bill && !!invoiceId);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (bill || !invoiceId) return;
    loadFromServer();
  }, [invoiceId]);

  async function loadFromServer() {
    setLoading(true);
    setError(null);
    const [{ data: inv, error: invErr }, { data: items }, { data: payments }] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', invoiceId).single(),
      supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId),
      supabase.from('payments').select('*').eq('invoice_id', invoiceId),
    ]);
    if (invErr || !inv) { setError('Could not load this bill.'); setLoading(false); return; }
    setData({
      invoice_number: inv.invoice_number,
      // Branch/cashier details come from the snapshot stored ON the
      // bill, so an old receipt still prints correctly (and still
      // reprints at all) after that branch or cashier has been deleted.
      branch_name: inv.branch_name, branch_address: inv.branch_address, branch_phone: inv.branch_phone,
      currency_symbol: inv.currency_symbol || '', tax_label: inv.tax_label || 'Tax',
      served_by: inv.created_by_name,
      customer_name: inv.customer_name, created_at: inv.created_at,
      items: (items || []).map((i) => ({ item_name: i.item_name, quantity: i.quantity, unit_price: i.unit_price, line_total: i.line_total })),
      subtotal: inv.subtotal, discount_amount: inv.discount_amount, tax_amount: inv.tax_amount, total_amount: inv.total_amount,
      payments: (payments || []).map((p) => ({ mode: p.mode, amount: p.amount })),
    });
    setLoading(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        {loading && <p>Loading receipt…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {data && (
          <div className="receipt-print-area">
            <h2 style={{ textAlign: 'center', fontFamily: 'var(--font-ui)' }}>{data.branch_name || 'Receipt'}</h2>
            {data.branch_address && <p style={{ textAlign: 'center', margin: 2 }}>{data.branch_address}</p>}
            {data.branch_phone && <p style={{ textAlign: 'center', margin: 2 }}>{data.branch_phone}</p>}
            <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px dashed var(--border)' }} />
            <p style={{ margin: '4px 0' }}>Invoice: {data.invoice_number || 'Pending sync'}</p>
            <p style={{ margin: '4px 0' }}>{new Date(data.created_at || Date.now()).toLocaleString()}</p>
            {data.customer_name && <p style={{ margin: '4px 0' }}>Customer: {data.customer_name}</p>}
            {data.served_by && <p style={{ margin: '4px 0' }}>Served by: {data.served_by}</p>}
            <table style={{ width: '100%', marginTop: 10 }}>
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.items.map((l, i) => (
                  <tr key={i}>
                    <td>{l.item_name}</td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{Number(l.unit_price).toFixed(2)}</td>
                    <td className="num">{Number(l.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bill-total-row"><span>Subtotal</span><span className="num">{data.currency_symbol}{Number(data.subtotal).toFixed(2)}</span></div>
            {data.discount_amount > 0 && <div className="bill-total-row"><span>Discount</span><span className="num">-{data.currency_symbol}{Number(data.discount_amount).toFixed(2)}</span></div>}
            {data.tax_amount > 0 && <div className="bill-total-row"><span>{data.tax_label || 'Tax'}</span><span className="num">{data.currency_symbol}{Number(data.tax_amount).toFixed(2)}</span></div>}
            <div className="bill-total-row grand"><span>Total</span><span className="num">{data.currency_symbol}{Number(data.total_amount).toFixed(2)}</span></div>
            {data.payments?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {data.payments.map((p, i) => (
                  <div className="bill-line" key={i}><span>{p.mode.replace('_', ' ')}</span><span className="num">{data.currency_symbol}{Number(p.amount).toFixed(2)}</span></div>
                ))}
              </div>
            )}
            <p style={{ textAlign: 'center', marginTop: 18, fontFamily: 'var(--font-ui)' }}>Thank you!</p>
          </div>
        )}

        <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {data && <button className="btn btn-primary" onClick={() => window.print()}>Print</button>}
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
