import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import PermissionGate from '../components/PermissionGate';

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip);

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

export default function Reports() {
  const { currentBranchId, can, isOwner } = useAuth();
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(daysAgo(0));
  const [consolidated, setConsolidated] = useState(false);
  const [rows, setRows] = useState([]);
  const canSeeFinancial = isOwner || can('reports.financial.view');
  const canExport = isOwner || can('data.export');

  useEffect(() => { load(); }, [currentBranchId, from, to, consolidated]);

  async function load() {
    let query = supabase
      .from('invoices')
      .select('invoice_number, branch_id, total_amount, discount_amount, status, created_at, branches ( name )')
      .eq('status', 'completed')
      .gte('created_at', from)
      .lte('created_at', to + 'T23:59:59');
    if (!consolidated) query = query.eq('branch_id', currentBranchId);
    const { data } = await query.order('created_at', { ascending: false });
    setRows(data || []);
  }

  const byDay = useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const day = r.created_at.slice(0, 10);
      map[day] = (map[day] || 0) + Number(r.total_amount);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const totalSales = rows.reduce((s, r) => s + Number(r.total_amount), 0);
  const totalDiscount = rows.reduce((s, r) => s + Number(r.discount_amount), 0);

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      Invoice: r.invoice_number, Branch: r.branches?.name, Date: r.created_at,
      Total: r.total_amount, Discount: r.discount_amount,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales');
    XLSX.writeFile(wb, `sales_${from}_to_${to}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF();
    doc.text(`Sales report: ${from} to ${to}`, 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [['Invoice', 'Branch', 'Date', 'Total', 'Discount']],
      body: rows.map((r) => [r.invoice_number, r.branches?.name, r.created_at.slice(0, 10), Number(r.total_amount).toFixed(2), Number(r.discount_amount).toFixed(2)]),
    });
    doc.save(`sales_${from}_to_${to}.pdf`);
  }

  return (
    <div>
      <h1>Sales Reports</h1>

      <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={consolidated} onChange={(e) => setConsolidated(e.target.checked)} /> Company-wide
        </label>
        <PermissionGate permission="data.export">
          <button className="btn btn-sm" onClick={exportExcel}>Export Excel</button>
          <button className="btn btn-sm" onClick={exportPdf}>Export PDF</button>
        </PermissionGate>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card"><h2>Total sales</h2><p className="num" style={{ fontSize: 24, color: 'var(--ink)' }}>{totalSales.toFixed(2)}</p></div>
        <div className="card"><h2>Bills</h2><p className="num" style={{ fontSize: 24, color: 'var(--ink)' }}>{rows.length}</p></div>
        {canSeeFinancial && <div className="card"><h2>Total discounts given</h2><p className="num" style={{ fontSize: 24, color: 'var(--ink)' }}>{totalDiscount.toFixed(2)}</p></div>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Daily sales</h2>
        <Bar
          data={{ labels: byDay.map(([d]) => d), datasets: [{ label: 'Sales', data: byDay.map(([, v]) => v), backgroundColor: '#a8632a' }] }}
          options={{ responsive: true, plugins: { legend: { display: false } } }}
        />
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>Invoice</th>{consolidated && <th>Branch</th>}<th>Date</th><th className="num">Total</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoice_number}>
              <td className="invoice-number">{r.invoice_number}</td>
              {consolidated && <td>{r.branches?.name}</td>}
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td className="num money">{Number(r.total_amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
