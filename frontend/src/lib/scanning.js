import { useEffect, useRef } from 'react';

/**
 * Support for ordinary USB / Bluetooth barcode scanners.
 *
 * Those scanners are really just a very fast keyboard: they "type" the
 * code and then press Enter. Two consequences this file deals with:
 *
 *  1. If nothing on the page is focused when a scan arrives, the
 *     characters would simply be lost. useWedgeScanner() listens for
 *     that burst of fast keystrokes anywhere on the page and hands the
 *     finished code to `onScan` — so scanning works without having to
 *     click into a box first.
 *  2. If a text box IS focused, the scanner's Enter would submit its
 *     form half-filled. Use handleScannerEnter() on such inputs to turn
 *     that Enter into "move to the next field" instead.
 *
 * A scan is told apart from a person typing by speed: scanners send a
 * character every few milliseconds, people take far longer. Keystrokes
 * that land in a text field (input/textarea/select) are ignored here —
 * the field handles those itself.
 */
export function useWedgeScanner(onScan, enabled = true) {
  const callbackRef = useRef(onScan);
  callbackRef.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;
    let buffer = '';
    let lastKeyAt = 0;

    function onKeyDown(e) {
      const el = e.target;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = performance.now();
      if (now - lastKeyAt > 80) buffer = ''; // too slow to be a scanner: start over
      lastKeyAt = now;

      if (e.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (code.length >= 3) {
          e.preventDefault();
          callbackRef.current(code);
        }
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

/** onKeyDown for a text field inside a form: Enter moves on instead of submitting. */
export function handleScannerEnter(e, focusNext) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (typeof focusNext === 'function') focusNext();
}

/**
 * Compares two product codes the way scanning needs: case and stray
 * spaces don't matter, and for all-digit codes leading zeros don't
 * either — many scanners report a 12-digit UPC-A as a 13-digit EAN-13
 * with a 0 in front (036000291452 vs 0036000291452), and it's the
 * same product. Letters-and-digits codes (BK-007) are compared as-is,
 * so BK-007 and BK-7 stay different.
 *
 * Use this for LOOKUP (a scan finding its product). Duplicate checks
 * when saving use plain exact matching instead, so two internal codes
 * like 01 and 1 aren't wrongly treated as the same product.
 */
export function normalizeCode(code) {
  const t = String(code ?? '').trim().toLowerCase();
  return /^\d+$/.test(t) ? t.replace(/^0+/, '') : t;
}
export const sameCode = (a, b) => !!a && !!b && normalizeCode(a) === normalizeCode(b);
