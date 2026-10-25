import { Navigate, useNavigate } from 'react-router-dom';
import { useCalibration } from '../armSession';
import { HudChips } from '../components/Hud';
import { useStageConfig } from '../components/StageView';
import { Stars } from '../components/Stars';
import { useRecalibrateKey } from '../hooks';
import { useHistory } from '../history';
import { LESSONS, useSensei } from '../lessons';

/* Lesson picker: ten moves, then combos. The coach waits in the corner. */
export function Train() {
  const nav = useNavigate();
  const cal = useCalibration((s) => s.cal);
  const progress = useHistory((h) => h.lessonStars);
  useStageConfig({ shot: 'lesson' });
  useSensei();
  useRecalibrateKey();
  if (!cal) return <Navigate to="/calibrate?next=/train" replace />;

  const moves = LESSONS.filter((l) => !l.combo);
  const combos = LESSONS.filter((l) => l.combo);
  const earned = Object.values(progress).reduce((a, b) => a + b, 0);

  return (
    <main className="trainpage">
      <div className="trainhead">
        <div className="paper taped" style={{ transform: 'rotate(-1.5deg)' }}>
          <div className="label">Coach says</div>
          <div className="inked" style={{ fontSize: 'clamp(30px, 3.4vw, 46px)' }}>Pick a lesson, kid.</div>
          <p style={{ margin: '4px 0 0', fontWeight: 600 }}>Each one: watch me, copy me, then I call it and you throw it. {earned} / {LESSONS.length * 3} stars.</p>
        </div>
        <HudChips />
      </div>

      <h3 className="inked sect">The moves</h3>
      <div className="lessongrid">
        {moves.map((l, i) => (
          <button key={l.id} className="lesson paper" onClick={() => nav(`/train/${l.id}`)}>
            <span className="num inked red">{i + 1}</span>
            <span className="inked lt">{l.title}</span>
            <Stars n={progress[l.id] ?? 0} />
            <p>{l.blurb}</p>
          </button>
        ))}
      </div>

      <h3 className="inked sect">Combos</h3>
      <div className="lessongrid">
        {combos.map((l) => (
          <button key={l.id} className="lesson paper" onClick={() => nav(`/train/${l.id}`)}>
            <span className="inked lt">{l.title}</span>
            <Stars n={progress[l.id] ?? 0} />
            <p>{l.moves.length} moves, called together.</p>
          </button>
        ))}
      </div>
      <div className="dock" style={{ position: 'sticky', bottom: 20, left: 0, transform: 'none', justifyContent: 'center', marginTop: 24 }}>
        <button className="btn small" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={() => nav('/home')}>← Modes</button>
      </div>
    </main>
  );
}
