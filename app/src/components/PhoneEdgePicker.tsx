import { Clock } from '../core/vec';

/* Side view of the upper arm with the phone strapped on. The thick bar marks the phone's TOP edge (the edge with the
 * front camera and speaker). '6' = top edge toward the shoulder, '12' = top edge toward the elbow. */
function Arm({ edge }: { edge: 'shoulder' | 'elbow' }) {
  const x = edge === 'shoulder' ? 78 : 152;
  return (
    <svg viewBox="0 0 240 92" aria-hidden fill="none" stroke="currentColor" strokeWidth="3">
      <circle cx="30" cy="46" r="22" />
      <path d="M44 28 H196 M44 64 H196" />
      <circle cx="204" cy="46" r="18" />
      <rect x="82" y="26" width="76" height="40" rx="4" fill="currentColor" fillOpacity=".14" />
      <path d={`M${x} 26 V66`} stroke="#c3261c" strokeWidth="8" />
      <text x="30" y="88" textAnchor="middle" fontSize="13" fill="currentColor" stroke="none" fontFamily="inherit">shoulder</text>
      <text x="204" y="88" textAnchor="middle" fontSize="13" fill="currentColor" stroke="none" fontFamily="inherit">elbow</text>
    </svg>
  );
}

export function PhoneEdgePicker({ value, onChange }: { value: Clock; onChange: (c: Clock) => void }) {
  return (
    <div>
      <span className="lbl">Which way does the phone's top edge point?</span>
      <div className="pick">
        <button aria-pressed={value === '6'} onClick={() => onChange('6')}>
          <Arm edge="shoulder" />
          <b>Toward shoulder</b>
        </button>
        <button aria-pressed={value === '12'} onClick={() => onChange('12')}>
          <Arm edge="elbow" />
          <b>Toward elbow</b>
        </button>
      </div>
      <p className="hint">Red bar = the top edge, where the front camera is. If the boxer's arm moves up when yours goes down, flip this.</p>
    </div>
  );
}
