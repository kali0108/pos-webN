import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import PermissionGate from '../../components/PermissionGate';
import { logActivity } from '../../lib/activityLog';

function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
      } catch (err) {
        reject(new Error('Could not read that file — make sure it\'s a valid .xlsx or .csv export.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

function downloadSheet(rows, sheetName, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function ResultSummary({ result }) {
  if (!result) return null;
  return (
    <div className="card" style={{ marginTop: 12, borderColor: result.skipped.length ? 'var(--warning)' : 'var(--success)' }}>
      {'created' in result && <p>{result.created} product(s) created.</p>}
      {'updated' in result && <p>{result.updated} row(s) updated.</p>}
      {result.skipped.length > 0 && (
        <>
          <p style={{ color: 'var(--danger)' }}>{result.skipped.length} row(s) skipped:</p>
          <ul style={{ maxHeight: 180, overflow: 'auto' }}>
            {result.skipped.map((s, i) => <li key={i} style={{ fontSize: 13 }}>{s}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

export default function DataManager() {
  const { currentBranchId, branches } = useAuth();
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  const [productImporting, setProductImporting] = useState(false);
  const [productResult, setProductResult] = useState(null);
  const [inventoryImporting, setInventoryImporting] = useState(false);
  const [inventoryResult, setInventoryResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // ---------------- Products ----------------

  async function exportProducts() {
    setError(null);
    const { data, error } = await supabase
      .from('items')
      .select('name, sku, unit_price, cost_price, pricing_mode, unit_label, is_active, categories ( name )')
      .order('name');
    if (error) { setError(error.message); return; }
    downloadSheet(
      (data || []).map((i) => ({
        name: i.name, sku: i.sku || '', category: i.categories?.name || '',
        pricing_mode: i.pricing_mode, unit_label: i.unit_label,
        unit_price: i.unit_price, cost_price: i.cost_price || 0,
        is_active: i.is_active ? 'yes' : 'no',
      })),
      'Products', `products_export_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  function downloadProductTemplate() {
    downloadSheet(
      [{ name: 'Chocolate Cake', sku: 'CAKE-CHOC', category: 'Cakes', pricing_mode: 'unit', unit_label: 'pc', unit_price: 1200, cost_price: 700 }],
      'Products', 'products_template.xlsx'
    );
  }

  async function importProducts(file) {
    setProductResult(null);
    setProductImporting(true);
    try {
      const rows = await parseExcelFile(file);
      if (rows.length === 0) throw new Error('That file has no data rows.');

      const { data: existingCats } = await supabase.from('categories').select('id, name');
      const catMap = new Map((existingCats || []).map((c) => [c.name.toLowerCase(), c.id]));
      const { data: existingItems } = await supabase.from('items').select('id, sku').not('sku', 'is', null);
      const skuMap = new Map((existingItems || []).map((i) => [i.sku.toLowerCase(), i.id]));

      const result = { created: 0, updated: 0, skipped: [] };
      const toInsert = [];
      const toUpdate = [];
      const seenNewSkus = new Set(); // guards against the same new SKU appearing twice in one file — a single batch insert with a duplicate SKU fails atomically for every row, not just the duplicate, so this has to be caught before it reaches the database

      for (const [idx, row] of rows.entries()) {
        const rowNum = idx + 2; // header is row 1
        const name = String(row.name ?? row.Name ?? '').trim();
        const unitPrice = Number(row.unit_price ?? row['unit price'] ?? row.price ?? row.Price);
        if (!name) { result.skipped.push(`Row ${rowNum}: missing product name.`); continue; }
        if (!unitPrice || unitPrice <= 0) { result.skipped.push(`Row ${rowNum} (${name}): missing or invalid unit_price.`); continue; }

        const sku = String(row.sku ?? row.SKU ?? '').trim() || null;
        const categoryName = String(row.category ?? row.Category ?? '').trim();
        let categoryId = null;
        if (categoryName) {
          const key = categoryName.toLowerCase();
          if (catMap.has(key)) {
            categoryId = catMap.get(key);
          } else {
            const { data: newCat, error: catErr } = await supabase.from('categories').insert({ name: categoryName }).select().single();
            if (!catErr && newCat) { categoryId = newCat.id; catMap.set(key, newCat.id); }
          }
        }
        const pricingModeRaw = String(row.pricing_mode ?? row['pricing mode'] ?? 'unit').trim().toLowerCase();
        const payload = {
          name, sku, category_id: categoryId,
          pricing_mode: pricingModeRaw === 'weight' ? 'weight' : 'unit',
          unit_label: String(row.unit_label ?? row['unit label'] ?? row.unit ?? 'pc').trim() || 'pc',
          unit_price: unitPrice,
          cost_price: Number(row.cost_price ?? row['cost price'] ?? 0) || 0,
        };

        const existingId = sku ? skuMap.get(sku.toLowerCase()) : null;
        if (existingId) {
          toUpdate.push({ id: existingId, ...payload });
        } else if (sku && seenNewSkus.has(sku.toLowerCase())) {
          result.skipped.push(`Row ${rowNum} (${name}): SKU "${sku}" appears more than once in this file — only the first was imported.`);
        } else {
          if (sku) seenNewSkus.add(sku.toLowerCase());
          toInsert.push(payload);
        }
      }

      let newlyCreatedIds = [];
      if (toInsert.length) {
        const { data: inserted, error: insErr } = await supabase.from('items').insert(toInsert).select('id');
        if (insErr) throw insErr;
        newlyCreatedIds = (inserted || []).map((i) => i.id);
        result.created = toInsert.length;
      }
      for (const row of toUpdate) {
        const { id, ...payload } = row;
        const { error: updErr } = await supabase.from('items').update(payload).eq('id', id);
        if (!updErr) result.updated++;
        else result.skipped.push(`SKU ${row.sku}: ${updErr.message}`);
      }

      // Same auto-provisioning the Products admin page does for a
      // single new product — every newly imported product gets a
      // zero-stock row at every active branch immediately.
      if (newlyCreatedIds.length) {
        const { data: activeBranches } = await supabase.from('branches').select('id').eq('is_active', true);
        if (activeBranches?.length) {
          const stockRows = [];
          for (const b of activeBranches) for (const itemId of newlyCreatedIds) stockRows.push({ branch_id: b.id, item_id: itemId, quantity: 0, reorder_level: 0 });
          await supabase.from('branch_item_stock').upsert(stockRows, { onConflict: 'branch_id,item_id' });
        }
      }

      setProductResult(result);
      logActivity('data.products_imported', { entityType: 'items', details: { created: result.created, updated: result.updated, skipped: result.skipped.length } });
    } catch (err) {
      setProductResult({ created: 0, updated: 0, skipped: [err.message || 'Import failed.'] });
    } finally {
      setProductImporting(false);
    }
  }

  // ---------------- Inventory (current branch) ----------------

  async function exportInventory() {
    setError(null);
    const { data, error } = await supabase
      .from('branch_item_stock')
      .select('quantity, reorder_level, items ( name, sku, unit_label )')
      .eq('branch_id', currentBranchId);
    if (error) { setError(error.message); return; }
    downloadSheet(
      (data || []).map((s) => ({ name: s.items?.name, sku: s.items?.sku || '', unit: s.items?.unit_label, quantity: s.quantity, reorder_level: s.reorder_level })),
      'Inventory', `inventory_${currentBranch?.code || 'branch'}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  function downloadInventoryTemplate() {
    downloadSheet([{ sku: 'CAKE-CHOC', quantity: 10, reorder_level: 2 }], 'Inventory', 'inventory_template.xlsx');
  }

  async function importInventory(file) {
    setInventoryResult(null);
    setInventoryImporting(true);
    try {
      const rows = await parseExcelFile(file);
      if (rows.length === 0) throw new Error('That file has no data rows.');

      const { data: existingItems } = await supabase.from('items').select('id, sku').not('sku', 'is', null);
      const skuMap = new Map((existingItems || []).map((i) => [i.sku.toLowerCase(), i.id]));

      const result = { updated: 0, skipped: [] };
      const upsertRows = [];
      const seenItemIds = new Set(); // a single upsert batch can't contain the same conflict key twice — Postgres rejects "ON CONFLICT DO UPDATE... affect row a second time" — so duplicates within the file are caught here first
      for (const [idx, row] of rows.entries()) {
        const rowNum = idx + 2;
        const sku = String(row.sku ?? row.SKU ?? '').trim();
        if (!sku) { result.skipped.push(`Row ${rowNum}: missing SKU.`); continue; }
        const itemId = skuMap.get(sku.toLowerCase());
        if (!itemId) { result.skipped.push(`Row ${rowNum}: no product found with SKU "${sku}" — import products first.`); continue; }
        if (seenItemIds.has(itemId)) { result.skipped.push(`Row ${rowNum}: SKU "${sku}" appears more than once in this file — only the first was applied.`); continue; }
        seenItemIds.add(itemId);
        const quantity = Math.max(Number(row.quantity ?? row.Quantity ?? 0) || 0, 0);
        const reorderLevel = Math.max(Number(row.reorder_level ?? row['reorder level'] ?? 0) || 0, 0);
        upsertRows.push({ branch_id: currentBranchId, item_id: itemId, quantity, reorder_level: reorderLevel });
      }
      if (upsertRows.length) {
        const { error: upErr } = await supabase.from('branch_item_stock').upsert(upsertRows, { onConflict: 'branch_id,item_id' });
        if (upErr) throw upErr;
        result.updated = upsertRows.length;
      }
      setInventoryResult(result);
      logActivity('data.inventory_imported', { branchId: currentBranchId, entityType: 'branch_item_stock', details: { updated: result.updated, skipped: result.skipped.length } });
    } catch (err) {
      setInventoryResult({ updated: 0, skipped: [err.message || 'Import failed.'] });
    } finally {
      setInventoryImporting(false);
    }
  }

  // ---------------- Customers (export only) ----------------

  async function exportCustomers() {
    setError(null);
    setBusy(true);
    try {
      const [{ data: fromInvoices }, { data: fromOrders }] = await Promise.all([
        supabase.from('invoices').select('customer_name, customer_phone').not('customer_name', 'is', null),
        supabase.from('custom_orders').select('customer_name, customer_phone'),
      ]);
      const merged = new Map();
      [...(fromInvoices || []), ...(fromOrders || [])].forEach((c) => {
        if (!c.customer_name) return;
        const key = (c.customer_phone || c.customer_name).toLowerCase();
        if (!merged.has(key)) merged.set(key, { name: c.customer_name, phone: c.customer_phone || '' });
      });
      downloadSheet(Array.from(merged.values()), 'Customers', `customers_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Import / Export</h1>
      <p>Bring in an existing product list instead of typing everything by hand, or take data out for backups and reporting.</p>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="card" style={{ marginBottom: 20, maxWidth: 640 }}>
        <h2>Products</h2>
        <p>Columns expected: <code>name</code>, <code>sku</code>, <code>category</code>, <code>pricing_mode</code> (unit or weight), <code>unit_label</code>, <code>unit_price</code>, <code>cost_price</code>. A product with a SKU that already exists gets updated; a new SKU (or no SKU) creates a new product. Unknown categories are created automatically.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PermissionGate permission="data.export"><button className="btn btn-sm" onClick={exportProducts}>Export all products</button></PermissionGate>
          <button className="btn btn-sm" onClick={downloadProductTemplate}>Download import template</button>
          <PermissionGate permission="inventory.edit">
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              {productImporting ? 'Importing…' : 'Import products'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={productImporting}
                onChange={(e) => { if (e.target.files[0]) importProducts(e.target.files[0]); e.target.value = ''; }} />
            </label>
          </PermissionGate>
        </div>
        <ResultSummary result={productResult} />
      </div>

      <div className="card" style={{ marginBottom: 20, maxWidth: 640 }}>
        <h2>Inventory — {currentBranch?.name || 'current branch'}</h2>
        <p>Columns expected: <code>sku</code>, <code>quantity</code>, <code>reorder_level</code>. Import sets stock for products that already exist (by SKU) at the currently-selected branch only — switch branches to import for a different one.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PermissionGate permission="data.export"><button className="btn btn-sm" onClick={exportInventory}>Export this branch's stock</button></PermissionGate>
          <button className="btn btn-sm" onClick={downloadInventoryTemplate}>Download import template</button>
          <PermissionGate permission="inventory.edit">
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              {inventoryImporting ? 'Importing…' : 'Import stock levels'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={inventoryImporting}
                onChange={(e) => { if (e.target.files[0]) importInventory(e.target.files[0]); e.target.value = ''; }} />
            </label>
          </PermissionGate>
        </div>
        <ResultSummary result={inventoryResult} />
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <h2>Customers</h2>
        <p>Every unique customer name/phone seen across bills and custom orders, for your own marketing or records — this app doesn't store more than name and phone.</p>
        <PermissionGate permission="data.export"><button className="btn btn-sm" onClick={exportCustomers} disabled={busy}>{busy ? 'Exporting…' : 'Export customers'}</button></PermissionGate>
      </div>

      <p style={{ marginTop: 16, fontSize: 13 }}>Looking for sales/bills export instead? See the Reports page — it exports invoices for a date range to Excel or PDF.</p>
    </div>
  );
}
