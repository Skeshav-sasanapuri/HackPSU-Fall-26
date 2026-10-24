export type ChipState = 'on' | 'wait' | 'off';

export function DeviceChip({ label, state, text, meta }: { label: string; state: ChipState; text: string; meta?: string }) {
  return (
    <div className={`chip ${state}`} role="status">
      <span className="dot" aria-hidden />
      <span>{label}</span>
      <span className="meta">{meta ? `${text} · ${meta}` : text}</span>
    </div>
  );
}

/** "Move it and watch the bar" check for a device. */
export function ActivityBar({ level }: { level: number }) {
  const n = 14, filled = Math.round(Math.min(1, level) * n);
  return (
    <div className="bars" aria-hidden>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < filled ? 'f' : ''} />)}
    </div>
  );
}
