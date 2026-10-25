import { useEffect, useState } from 'react';
import { useHubStatus } from '../hubContext';

export function HudChips({ className = '' }: { className?: string }) {
  const s = useHubStatus(500);
  return (
    <div className={`hudchips ${className}`}>
      <span className={`hchip ${s.watch.up ? 'on' : ''}`}><i />Watch {s.watch.up ? `· ${s.watch.hz} Hz` : '· offline'}</span>
      <span className={`hchip ${s.phone.up ? 'on' : ''}`}><i />Phone {s.phone.up ? `· ${s.phone.hz} Hz` : '· offline'}</span>
    </div>
  );
}

/** Comic starburst with text, placed at screen coordinates. */
/** the overlay's zoom (set from the window size by the app shell); screen positions are divided by it */
export const uiScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;

export function Burst({ x, y, big, small, color = '#d4a017' }: { x: number; y: number; big: string; small?: string; color?: string }) {
  const pts: string[] = [];
  const n = 14;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? 0.62 : 1 - ((i * 37) % 11) / 60;
    pts.push(`${(50 + Math.cos(a) * 50 * r).toFixed(1)},${(50 + Math.sin(a) * 50 * r).toFixed(1)}`);
  }
  return (
    <div className="burst" style={{ left: x / uiScale(), top: y / uiScale() }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <polygon points={pts.join(' ')} fill="#17130e" transform="translate(3 3)" />
        <polygon points={pts.join(' ')} fill={color} stroke="#17130e" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="txt">
        <div className="inked big">{big}</div>
        {small && <div className="inked sm">{small}</div>}
      </div>
    </div>
  );
}

/** Re-render at a steady rate (for HUD numbers that change every frame). */
export function useTicker(ms = 100) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
