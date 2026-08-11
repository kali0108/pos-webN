import { useState } from 'react';

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '⌫', '+'];

export default function Calculator({ onClose }) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState(null);

  function press(key) {
    if (key === '⌫') { setExpr((e) => e.slice(0, -1)); setResult(null); return; }
    setExpr((e) => e + key);
    setResult(null);
  }

  function evaluate() {
    try {
      // Only digits, ., and the four operators reach this point (the
      // keypad is the only input source — nothing free-typed), so a
      // direct arithmetic evaluation here is safe.
      const safe = expr.replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-');
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${safe || '0'})`)();
      setResult(Number.isFinite(value) ? value : 'Error');
    } catch {
      setResult('Error');
    }
  }

  function clear() { setExpr(''); setResult(null); }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 300 }} onClick={(e) => e.stopPropagation()}>
        <h2>Calculator</h2>
        <div className="calc-display">{result !== null ? String(result) : (expr || '0')}</div>
        <div className="calc-grid">
          {KEYS.map((k) => (
            <button key={k} className={`calc-key ${'÷×−+'.includes(k) ? 'op' : ''}`} onClick={() => press(k)}>{k}</button>
          ))}
          <button className="calc-key wide" onClick={clear}>Clear</button>
          <button className="calc-key wide op" onClick={evaluate}>=</button>
        </div>
        <button className="btn" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
