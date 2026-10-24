import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCalibration } from '../armSession';
import { HudChips } from '../components/Hud';
import { StageView } from '../components/StageView';
import { HOLD_MS } from '../core/hold';
import { useArm, useHub, useHubStatus } from '../hubContext';
import { SimHub } from '../link/hub';
import { sfx } from '../sfx';
import { useProfile } from '../store';

type Phase = 'ready' | 'count' | 'hold' | 'done' | 'fail';

export function Calibrate() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/home';
  const hub = useHub();
  const arm = useArm();
  const status = useHubStatus(400);
  const phoneAxis = useProfile((p) => p.phoneAxis);
  const lead = useProfile((p) => p.lead);
  const setCal = useCalibration((s) => s.set);
  const [phase, setPhase] = useState<Phase>('ready');
  const [count, setCount] = useState(3);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => { clear(); arm.cancelHold(); }, [arm]);

  const canStart = status.watch.up;

  const start = useCallback(() => {
    if (!canStart) return;
    clear();
    arm.cancelHold();
    setMsg([]);
    setPhase('count');
    setCount(3);
    if (hub instanceof SimHub) hub.holdFor(3000 + HOLD_MS + 500);
    sfx.tick();
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    at(1000, () => { setCount(2); sfx.tick(); });
    at(2000, () => { setCount(1); sfx.tick(); });
    at(3000, () => {
      sfx.go();
      setPhase('hold');
      arm.beginHold();
      const t0 = performance.now();
      const step = () => {
        const k = (performance.now() - t0) / HOLD_MS;
        setProgress(Math.min(1, k));
        if (k < 1) timers.current.push(setTimeout(step, 50));
        else finish();
      };
      step();
    });
    const finish = () => {
      const r = arm.endHold(phoneAxis, status.phone.up);
      if ('error' in r) { setPhase('fail'); setMsg([r.error]); sfx.bad(); return; }
      setCal(r);
      setMsg(r.warnings);
      setPhase('done');
      sfx.ok();
    };
  }, [arm, canStart, hub, phoneAxis, setCal, status.phone.up]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'done') nav(next); else if (phase === 'ready' || phase === 'fail') start();
      }
      if (e.key === 'r' || e.key === 'R') start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start, nav, next]);

  const leadWord = lead === 'left' ? 'left' : 'right';

  return (
    <StageView shot="threeQuarter" ghost={phase === 'ready' || phase === 'count' || phase === 'hold'} live={phase === 'done'}>
      <div className="banner small paper taped">
        <h2>{phase === 'hold' ? 'Hold still!' : phase === 'done' ? 'Calibrated' : phase === 'fail' ? 'Try that again' : 'Calibration'}</h2>
        <p>{phase === 'done' ? 'Move your arm. The boxer follows.' : `Match the yellow ghost with your ${leadWord} arm.`}</p>
      </div>
      <HudChips />

      {phase === 'count' && <div key={count} className="count inked mustard">{count}</div>}
      {phase === 'done' && <div className="count inked red" style={{ fontSize: 'clamp(70px, 10vw, 130px)', top: '30%' }}>Locked in!</div>}

      <div className="dock calib">
        <div className="paper">
          {phase === 'ready' || phase === 'count' ? (
            <>
              <div className="label">The pose</div>
              <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 600 }}>
                Arm straight out in front at shoulder height, palm flat facing the floor. Stand still and look ahead.
              </p>
            </>
          ) : phase === 'hold' ? (
            <>
              <div className="label">Hold it…</div>
              <div className="holdbar"><i style={{ width: `${progress * 100}%` }} /></div>
            </>
          ) : (
            <>
              <div className="label">{phase === 'done' ? 'All set' : 'Not quite'}</div>
              {msg.length ? msg.map((m) => <p key={m} style={{ margin: '4px 0 0', fontWeight: 600 }}>{m}</p>)
                : <p style={{ margin: '4px 0 0', fontWeight: 600 }}>Recalibrate any time with the R key if the boxer starts to drift.</p>}
            </>
          )}
          {!canStart && (
            <p style={{ margin: '8px 0 0', color: 'var(--red)', fontWeight: 700 }}>
              The watch isn't streaming. <Link to="/connect">Connect devices</Link>
            </p>
          )}
          {canStart && !status.phone.up && phase === 'ready' && (
            <p className="hint" style={{ margin: '8px 0 0' }}>No phone: the upper arm will simply follow the forearm.</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {phase === 'done' ? (
            <>
              <button className="btn" onClick={() => nav(next)}><span className="key">⏎</span>Continue</button>
              <button className="btn ghost" style={{ background: 'var(--paper)' }} onClick={start}><span className="key">R</span>Again</button>
            </>
          ) : phase === 'ready' || phase === 'fail' ? (
            <button className="btn" onClick={start} disabled={!canStart}><span className="key">Space</span>I'm in position</button>
          ) : null}
        </div>
      </div>
    </StageView>
  );
}
