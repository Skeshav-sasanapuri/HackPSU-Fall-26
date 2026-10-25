import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useCalibration } from '../armSession';
import { HudChips, useTicker } from '../components/Hud';
import { StageView } from '../components/StageView';
import { SessionTally, useHistory } from '../history';
import { useRecalibrateKey } from '../hooks';
import { useArm } from '../hubContext';
import { Shot, getStage } from '../scene/stage';
import { sfx } from '../sfx';
import { useProfile } from '../store';

export function Mirror() {
  const nav = useNavigate();
  const arm = useArm();
  const cal = useCalibration((s) => s.cal);
  const mirror = useProfile((p) => p.mirror);
  const setProfile = useProfile((p) => p.set);
  const [shot, setShot] = useState<Shot>('threeQuarter');
  useRecalibrateKey();
  useTicker(100);

  const addSession = useHistory((h) => h.add);
  const tally = useRef(new SessionTally());
  useEffect(() => { arm.resetStats(); }, [arm]);
  // keep the shadowboxing session in the history when leaving, if anything happened
  useEffect(() => () => {
    const t = tally.current;
    if (t.strikes.length > 0) addSession(t.finish('mirror', 'Free mirror', { total: t.strikes.length }));
  }, [addSession]);

  // free mirror shows speed and power only; move names live in Train and Gym
  useEffect(() => arm.onPunch((p) => {
    tally.current.strikes.push(p.peakSpeed);
    tally.current.maxForceN = Math.max(tally.current.maxForceN, p.forceN);
    const k = p.power / 100;
    getStage().kick(0.15 + 0.5 * k);
    sfx.punch(k);
  }), [arm]);

  if (!cal) return <Navigate to="/calibrate?next=/mirror" replace />;

  const pose = arm.pose;
  const last = arm.lastPunch;

  return (
    <StageView shot={shot}>
      <div className="stats paper taped">
        <div className="label">Hand speed</div>
        <div className="numeral">{(pose?.speedSmooth ?? 0).toFixed(1)}<small>m/s</small></div>
        <div className="row2">
          <div>
            <div className="label">Last punch</div>
            <div className="numeral red" style={{ fontSize: 40 }}>{last ? last.peakSpeed.toFixed(1) : '–'}<small>m/s</small></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="label">Punches</div>
            <div className="numeral" style={{ fontSize: 40 }}>{arm.punches}</div>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="label">Power (est.) {last ? `· ${Math.round(last.forceN).toLocaleString()} N` : ''}</div>
          <div className="powerbar"><i style={{ width: `${last?.power ?? 0}%` }} /></div>
        </div>
        <div className="row2"><span className="label">Best</span><b>{arm.bestSpeed ? `${arm.bestSpeed.toFixed(1)} m/s` : '–'}</b></div>
      </div>
      <HudChips />

      <div className="dock">
        <button className="btn small" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={() => nav('/home')}>← Modes</button>
        <button className="btn small" onClick={() => nav('/calibrate?next=/mirror')}><span className="key">R</span>Recalibrate</button>
      </div>
      <div className="camseg">
        <div className="seg" role="group" aria-label="Camera">
          {(['front', 'threeQuarter', 'side'] as Shot[]).map((s) => (
            <button key={s} aria-pressed={shot === s} onClick={() => setShot(s)}>{s === 'threeQuarter' ? '3/4' : s}</button>
          ))}
          <button aria-pressed={mirror} onClick={() => setProfile({ mirror: !mirror })} title="Mirror view">Mirror</button>
        </div>
      </div>
    </StageView>
  );
}
