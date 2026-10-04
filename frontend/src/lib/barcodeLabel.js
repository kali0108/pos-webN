import JsBarcode from 'jsbarcode';

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Opens a print window with a Code 128 barcode label for each product
 * that has a SKU — for sticking on boxes of things you bake yourself,
 * which (unlike packaged goods) don't arrive with a barcode. Anything
 * the scanner reads off these labels is simply the SKU, which is
 * exactly what the Billing screen looks products up by.
 */
export function printBarcodeLabels(entries) {
  const usable = (entries || []).filter((e) => e.sku);
  if (usable.length === 0) return { printed: 0, skipped: 0 };

  const win = window.open('', '_blank', 'width=760,height=820');
  if (!win) return { error: 'Your browser blocked the print window — allow pop-ups for this site and try again.' };

  let skipped = 0;
  const labels = usable.map((e) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    try {
      JsBarcode(svg, e.sku, { format: 'CODE128', width: 2, height: 54, displayValue: true, fontSize: 14, margin: 6 });
    } catch {
      skipped += 1; // e.g. a SKU with characters Code 128 can't encode
      return '';
    }
    return `<div class="label"><div class="name">${escapeHtml(e.name)}</div>${svg.outerHTML}</div>`;
  }).join('');

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 12px; }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .label { border: 1px dashed #999; border-radius: 6px; padding: 8px; text-align: center; break-inside: avoid; }
  .name { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
  svg { max-width: 100%; height: auto; }
  @media print { body { margin: 0; } .label { border: 1px dashed #bbb; } }
</style></head><body><div class="sheet">${labels}</div></body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
  return { printed: usable.length - skipped, skipped };
}
