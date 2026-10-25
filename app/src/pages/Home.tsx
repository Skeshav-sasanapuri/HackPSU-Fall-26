import { useNavigate } from 'react-router-dom';
import { useCalibration } from '../armSession';
import { HudChips } from '../components/Hud';
import { StageView } from '../components/StageView';
import { useRecalibrateKey } from '../hooks';
import { useProfile } from '../store';

const MODES = [
  { id: 'mirror', title: 'Free mirror', sub: 'Shadowbox. See your speed and power.', to: '/mirror', ready: true },
  { id: 'train', title: 'Train', sub: 'Lessons with the coach, move by move.', to: '/train', ready: true },
  { id: 'bag', title: 'Gym', sub: 'Rounds, combos and a bag that hits back.', to: '/bag', ready: true },
  { id: 'history', title: 'History', sub: 'Every session, every punch.', to: '/history', ready: true },
];

export function Home() {
  const nav = useNavigate();
  const name = useProfile((p) => p.name);
  const cal = useCalibration((s) => s.cal);
  useRecalibrateKey();

  return (
    <StageView shot="hero">
      <div className="paper taped" style={{ position: 'absolute', top: 24, left: 28, transform: 'rotate(-2deg)', maxWidth: 360 }}>
        <div className="label">Coach says</div>
        <div className="inked" style={{ fontSize: 40, color: 'var(--paper)' }}>Choose your round{name ? `, ${name}` : ''}!</div>
      </div>
      <HudChips />

      {!cal && (
        <div className="paper" style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%) rotate(1deg)', textAlign: 'center', maxWidth: 380 }}>
          <div className="label">Not calibrated</div>
          <p style={{ margin: '4px 0 10px', fontWeight: 600 }}>Hold the pose once so the boxer knows where your arm is.</p>
          <button className="btn small" onClick={() => nav('/calibrate?next=/home')}>Calibrate</button>
        </div>
      )}

      <div className="tiles">
        {MODES.map((m) => (
          <button key={m.id} className="tile paper" disabled={!m.ready} onClick={() => nav(cal || m.id === 'history' ? m.to : `/calibrate?next=${m.to}`)}>
            {!m.ready && <span className="soon">Soon</span>}
            <span className="inked">{m.title}</span>
            <p>{m.sub}</p>
          </button>
        ))}
      </div>
    </StageView>
  );
}
