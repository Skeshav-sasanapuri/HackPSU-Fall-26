import { useNavigate } from 'react-router-dom';
import { ReportButton } from '../components/Report';
import { Stars } from '../components/Stars';
import { useStageConfig } from '../components/StageView';
import { useHistory } from '../history';
import { fmtDate, fmtTime } from './Summary';

/* Every session, newest first. Stored in this browser (localStorage). */
export function History() {
  const nav = useNavigate();
  const { sessions, clear } = useHistory();
  useStageConfig({ shot: 'hero', live: false });
  const total = sessions.reduce((s, r) => s + r.total, 0);
  const best = Math.max(0, ...sessions.map((r) => r.bestSpeed));

  return (
    <main className="trio-page" style={{ maxWidth: 980, margin: '0 auto' }}>
      <h2 className="pagetitle inked">History</h2>
      <div className="paper taped" style={{ display: 'flex', gap: 30, justifyContent: 'center', marginBottom: 20 }}>
        <div><div className="label">Sessions</div><div className="numeral">{sessions.length}</div></div>
        <div><div className="label">Moves thrown</div><div className="numeral red">{total}</div></div>
        <div><div className="label">Fastest</div><div className="numeral">{best.toFixed(1)}<small>m/s</small></div></div>
      </div>
      {sessions.length === 0 && <div className="paper" style={{ textAlign: 'center' }}><p style={{ margin: 0, fontWeight: 600 }}>No sessions yet. Go throw something.</p></div>}
      <div className="histlist">
        {sessions.map((r) => (
          <button key={r.id} className="histrow paper plain" onClick={() => nav(`/summary/${r.id}`)}>
            <span className="hmode inked">{r.mode === 'bag' ? 'Gym' : r.mode === 'train' ? 'Train' : 'Mirror'}</span>
            <span className="htitle">
              <b>{r.title === 'Heavy bag' ? 'Gym' : r.title}</b>
              <small>{fmtDate(r.startedAt)}, {fmtTime(r.startedAt)} · {Math.max(1, Math.round((r.endedAt - r.startedAt) / 60000))} min {r.who && <>· {r.who}{r.body ? ` (${r.body})` : ''}</>}</small>
            </span>
            <span className="hstat"><small>Moves</small><b>{r.total}</b></span>
            <span className="hstat"><small>Best</small><b>{r.bestSpeed.toFixed(1)}</b></span>
            <span className="hstat"><small>{r.stars != null ? 'Stars' : 'On call'}</small><b>{r.stars != null ? <Stars n={r.stars} size={18} /> : r.accuracy != null ? `${Math.round(r.accuracy * 100)}%` : '–'}</b></span>
          </button>
        ))}
      </div>
      <div className="trio-foot" style={{ gap: 12 }}>
        <button className="btn small" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={() => nav('/home')}>← Modes</button>
        <ReportButton />
        {sessions.length > 0 && <button className="btn small" onClick={() => { if (confirm('Delete all session history on this browser?')) clear(); }}>Clear history</button>}
      </div>
    </main>
  );
}
