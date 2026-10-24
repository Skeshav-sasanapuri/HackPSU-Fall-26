import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function Qr({ value }: { value: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#17130e', light: '#0000' } })
      .then((s) => { if (live) setSvg(s); })
      .catch(() => { if (live) setSvg(''); });
    return () => { live = false; };
  }, [value]);
  return <div className="qr" role="img" aria-label={`QR code for ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
