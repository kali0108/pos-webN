import { useEffect, useRef, useState } from 'react';

export default function BarcodeScannerModal({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    if (!supported) return;
    let stream;
    let cancelled = false;
    let detector;

    async function start() {
      try {
        detector = new window.BarcodeDetector({
          formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scanLoop();
      } catch (err) {
        setError(err.message || 'Could not access the camera.');
      }
    }

    async function scanLoop() {
      if (cancelled) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0) {
          onDetected(codes[0].rawValue);
          return; // stop after first hit — caller decides what happens next
        }
      } catch {
        // transient decode errors are normal mid-stream, just keep trying
      }
      requestAnimationFrame(scanLoop);
    }

    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Scan barcode / QR</h2>
        {!supported && (
          <p>Your browser doesn't support camera scanning. This works in Chrome or Edge — or just use the "Scan barcode" field with a USB/Bluetooth scanner instead.</p>
        )}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {supported && !error && (
          <video ref={videoRef} style={{ width: '100%', borderRadius: 8, background: '#000' }} muted playsInline />
        )}
        <button className="btn" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
