import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Stars } from '../components/Stars';
import { useStageConfig } from '../components/StageView';
import { MOVE_IDS, MOVE_INFO } from '../core/moves';
import { SessionRecord, useHistory } from '../history';

/* The fight-poster summary for one session. */
export function Summary() {
  const { id = '' } = useParams();
  const rec = useHistory((h) => h.sessions.find((s) => s.id === id));
  useStageConfig({ shot: 'hero', live: false });
  if (!rec) return <Navigate to="/history" replace />;
  return <Poster rec={rec} />;
}

export const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function verdict(r: SessionRecord) {
  if ((r.accuracy ?? 0) >= 0.8 || (r.stars ?? 0) >= 3) return 'Great work!';
  if (r.total >= 40 || (r.stars ?? 0) >= 2) return 'Solid round!';
  return 'Keep grinding!';
}

function Poster({ rec }: { rec: SessionRecord }) {
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);
  const counts = MOVE_IDS.filter((m) => rec.counts[m]).map((m) => [m, rec.counts[m]!] as const);
  const maxC = Math.max(1, ...counts.map(([, n]) => n));
  const share = async () => {
    const txt = `Watch how u Box: ${rec.title} (${fmtDate(rec.startedAt)}): ${rec.total} moves, peak ${rec.bestSpeed.toFixed(1)} m/s, ` +
      `${Math.round(rec.maxForceN).toLocaleString()} N est.${rec.accuracy != null ? `, ${Math.round(rec.accuracy * 100)}% on call` : ''}` +
      `${rec.combos ? `, ${rec.combos} combos` : ''}. ${window.location.origin}`;
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  return (
    <main className="posterpage">
      <article className="poster-sheet taped">
        <div className="poster-head">
          <div className="inked red stars-row">★ ★</div>
          <div className="inked jabword">Watch how u Box</div>
          <div className="inked red stars-row">★ ★</div>
        </div>
        <h2 className="poster-title">{rec.mode === 'bag' ? 'Session summary' : rec.title}</h2>
        <hr className="rule" style={{ margin: '10px 0 14px' }} />
        <div className="poster-grid">
          <div className="cell">
            <div className="label">Total moves</div>
            <div className="numeral red" style={{ fontSize: 120 }}>{rec.total}</div>
          </div>
          <div className="cell tan">
            <div className="label">Peak speed</div>
            <div className="numeral" style={{ fontSize: 76 }}>{rec.bestSpeed.toFixed(1)}<small>m/s est.</small></div>
          </div>
          <div className="cell">
            <div className="label">{rec.accuracy != null ? 'On the call' : 'Avg speed'}</div>
            <div className="numeral" style={{ fontSize: 76 }}>{rec.accuracy != null ? `${Math.round(rec.accuracy * 100)}%` : rec.avgSpeed.toFixed(1)}{rec.accuracy == null && <small>m/s</small>}</div>
          </div>
          <div className="cell">
            <div className="label">Est. power</div>
            <div className="numeral" style={{ fontSize: 76 }}>{Math.round(rec.maxForceN).toLocaleString()}<small>N</small></div>
          </div>
        </div>
        <div className="poster-foot">
          <div>
            {rec.stars != null ? <Stars n={rec.stars} size={36} /> : <div className="label">Combos completed <b className="numeral" style={{ fontSize: 44 }}>{rec.combos}</b></div>}
            {rec.score != null && <div className="label">Score {rec.score.toLocaleString()}</div>}
          </div>
          <span className="stamp">{verdict(rec)}</span>
        </div>
        {counts.length > 0 && (
          <div className="countbars">
            {counts.map(([m, n]) => (
              <div key={m}><span>{MOVE_INFO[m].name}</span><i style={{ width: `${(n / maxC) * 100}%` }} /><b>{n}</b></div>
            ))}
          </div>
        )}
        <div className="poster-date"><span className="inked" style={{ fontSize: 30 }}>Watch how u Box</span><span>{fmtDate(rec.startedAt)}</span></div>
      </article>
      <div className="tickets">
        <button className="ticketbtn" onClick={() => nav('/home')}>Return to home</button>
        <button className="ticketbtn gold" onClick={share}>{copied ? 'Copied!' : 'Share stats'}</button>
        <button className="ticketbtn" onClick={() => nav('/history')}>History</button>
      </div>
    </main>
  );
}
