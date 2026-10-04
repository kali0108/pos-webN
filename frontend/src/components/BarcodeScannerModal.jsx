import { useEffect, useRef, useState } from 'react';

const NATIVE_FORMATS = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'];

function friendlyCameraError(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Click the camera / lock icon in the address bar, choose "Allow", then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Use a USB / Bluetooth scanner, or type the code below.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The camera is being used by another app or browser tab. Close it and try again.';
  }
  return err?.message || 'Could not start the camera.';
}

/**
 * Camera scanner for barcodes and QR codes.
 *
 * Uses the browser's built-in BarcodeDetector where it exists (Chrome
 * on Android) and otherwise falls back to a JavaScript decoder (ZXing)
 * — so it also works on Windows Chrome/Edge, Firefox and iPhone Safari,
 * where the built-in one doesn't exist. The fallback is only downloaded
 * the first time someone actually taps Scan.
 *
 * Needs an https:// page (or localhost) — browsers refuse camera access
 * on plain http. A typed-in code box is always shown as a last resort.
 */
export default function BarcodeScannerModal({ onDetected, onClose, title = 'Scan barcode / QR' }) {
  const videoRef = useRef(null);
  const detectedRef = useRef(onDetected);
  detectedRef.current = onDetected; // always call the parent's latest handler
  const doneRef = useRef(false);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const [manual, setManual] = useState('');

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let zxingControls = null;
    let frame = null;

    function finish(code) {
      const text = String(code || '').trim();
      if (!text || doneRef.current || stopped) return;
      doneRef.current = true;
      detectedRef.current(text);
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('The camera only works on a secure page. Open this site with https:// (or type the code below).');
        setStarting(false);
        return;
      }
      const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
      try {
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: NATIVE_FORMATS });
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
          const video = videoRef.current;
          video.srcObject = stream;
          await video.play();
          setStarting(false);
          const loop = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              if (codes.length > 0) { finish(codes[0].rawValue); return; }
            } catch { /* transient decode errors mid-stream are normal */ }
            frame = requestAnimationFrame(loop);
          };
          loop();
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
            import('@zxing/browser'),
            import('@zxing/library'),
          ]);
          if (stopped) return;
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          ]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 });
          zxingControls = await reader.decodeFromConstraints(constraints, videoRef.current, (result) => {
            if (result) finish(result.getText());
          });
          if (stopped) { zxingControls.stop(); return; }
          setStarting(false);
        }
      } catch (err) {
        if (!stopped) { setError(friendlyCameraError(err)); setStarting(false); }
      }
    }

    start();
    return () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      try { zxingControls?.stop(); } catch { /* already stopped */ }
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  function submitManual(e) {
    e.preventDefault();
    const text = manual.trim();
    if (!text || doneRef.current) return;
    doneRef.current = true;
    detectedRef.current(text);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {!error && starting && <p>Starting the camera…</p>}
        {!error && !starting && <p style={{ fontSize: 13 }}>Hold the barcode or QR code steady inside the camera view.</p>}
        <video
          ref={videoRef}
          className="scan-video"
          style={{ display: error ? 'none' : 'block' }}
          muted
          playsInline
        />
        <form onSubmit={submitManual} style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input placeholder="Or type the code here" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn btn-sm" type="submit" disabled={!manual.trim()}>Use</button>
        </form>
        <button className="btn" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
