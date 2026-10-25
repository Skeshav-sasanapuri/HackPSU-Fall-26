import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Navigate, useNavigate } from 'react-router-dom';
import { useCalibration } from '../armSession';
import { Burst, HudChips, useTicker } from '../components/Hud';
import { useStageConfig } from '../components/StageView';
import { Detection } from '../core/detector';
import { COMBOS, MOVE_INFO, MoveId } from '../core/moves';
import { effectiveMass, powerScore, estimateForce } from '../core/punch';
import { SessionTally, useHistory } from '../history';
import { useRecalibrateKey } from '../hooks';
import { useArm, useHub } from '../hubContext';
import { simDo, useSimPuppet } from '../lessons';
import { BagHit, HeavyBag, ImpactFx } from '../scene/bag';
import { getStage } from '../scene/stage';
import { sfx } from '../sfx';
import { useProfile } from '../store';
import { voice } from '../voice';

/* Bag mode: rounds on the heavy bag. The coach calls combos, hits land with effects, a summary poster at the end. */
type State = 'ready' | 'count' | 'round' | 'rest' | 'done';
interface Call { moves: MoveId[]; idx: number; t0: number; deadline: number; result: 'live' | 'done' | 'broke' | 'late' }
interface Pop { id: number; x: number; y: number; big: string; small: string; color: string }
interface RoundStats { hits: number; best: number; combos: number; called: number }

const SINGLES: MoveId[] = ['jab', 'body jab', 'hook', 'body hook', 'uppercut'];
const PRAISE = ['Nice!', 'Beautiful!', 'That’s it!', 'Sharp!', 'Again!'];
let bag: HeavyBag | null = null;
let fx: ImpactFx | null = null;
let popId = 0;

export function Bag() {
  const cal = useCalibration((s) => s.cal);
  if (!cal) return <Navigate to="/calibrate?next=/bag" replace />;
  return <BagGame />;
}

function BagGame() {
  const nav = useNavigate();
  const arm = useArm();
  const hub = useHub();
  useSimPuppet(hub);
  const weight = useProfile((p) => p.weightKg);
  const addSession = useHistory((h) => h.add);
  const stage = getStage();
  const side = stage.boxer.lead;
  useStageConfig({ shot: side === 'L' ? 'bagL' : 'bagR' });
  useRecalibrateKey();
  useTicker(100);

  const [state, setState] = useState<State>('ready');
  const [rounds, setRounds] = useState(3);
  const [roundLen, setRoundLen] = useState(60);
  const [round, setRound] = useState(1);
  const [count, setCount] = useState(3);
  const [pops, setPops] = useState<Pop[]>([]);
  const g = useRef({
    endsAt: 0, roundN: 1, rounds: 3, roundLen: 60, call: null as Call | null, nextCallAt: 0, streak: 0, bestStreak: 0, score: 0, hits: 0,
    round: { hits: 0, best: 0, combos: 0, called: 0 } as RoundStats, tally: new SessionTally(), timers: [] as ReturnType<typeof setTimeout>[],
  });
  const st = useRef<State>('ready');
  st.current = state;

  const objects = useMemo(() => {
    bag ??= new HeavyBag();
    fx ??= new ImpactFx();
    return { bag, fx };
  }, []);

  // hang the bag at arm's reach in front of the lead shoulder, run physics + hit tests every frame
  useEffect(() => {
    const { bag, fx } = objects;
    stage.scene.add(bag.pivot, fx.group);
    stage.boxer.root.updateMatrixWorld(true);
    const sh = stage.boxer.shoulderWorld(side, new THREE.Vector3());
    // glove centre at full reach is about 0.66 m ahead of the shoulder; let it sink ~15 cm into the bag
    bag.place(new THREE.Vector3(sh.x, sh.y - 0.12, sh.z + 0.3 + 0.27 + 0.085 + bag.R - 0.15));
    const prev = new THREE.Vector3(), glove = new THREE.Vector3(), vel = new THREE.Vector3();
    let have = false;
    const off = stage.onFrame((dt) => {
      bag.update(dt);
      fx.update(dt);
      stage.boxer.gloveWorld(stage.boxer.lead, glove);
      if (dt > 0 && have) vel.subVectors(glove, prev).divideScalar(dt);
      prev.copy(glove); have = dt > 0 || have;
      if (dt <= 0) return;
      const hit = bag.test(glove, vel);
      if (hit) onHit(hit);
    });
    return () => { off(); stage.scene.remove(bag.pivot, fx.group); };
  }, [stage, objects, side]); // eslint-disable-line react-hooks/exhaustive-deps

  const pop = (x: number, y: number, big: string, small: string, color = '#d4a017') => {
    const p = { id: ++popId, x, y, big, small, color };
    setPops((ps) => [...ps.slice(-3), p]);
    setTimeout(() => setPops((ps) => ps.filter((q) => q.id !== p.id)), 1300);
  };

  const onHit = (hit: BagHit) => {
    const speed = Math.max(arm.pose?.speed ?? 0, 1.5);
    const k = powerScore(speed, weight) / 100;
    objects.bag.punch(hit, speed, effectiveMass(weight));
    objects.fx.burst(hit.point, hit.normal, k);
    stage.kick(0.2 + 0.6 * k);
    stage.freeze(35 + 70 * k);
    sfx.hit(k);
    const s = stage.toScreen(hit.point);
    pop(s.x, s.y - 40, `${speed.toFixed(1)} m/s`, `${Math.round(estimateForce(speed, weight)).toLocaleString()} N est.`, k > 0.7 ? '#c3261c' : '#d4a017');
    if (st.current === 'round') {
      const G = g.current;
      G.hits++; G.round.hits++; G.round.best = Math.max(G.round.best, speed);
      G.score += 10 + Math.round(k * 40);
    }
  };

  // called combos
  useEffect(() => arm.onMove((d: Detection) => {
    const G = g.current;
    if (st.current !== 'round') return;
    G.tally.add(d);
    const c = G.call;
    if (!c || c.result !== 'live') return;
    const want = c.moves[c.idx];
    if (d.move === want || (want === 'jab' && d.move === 'double jab')) {
      G.tally.calledRight++;
      c.idx += d.move === 'double jab' && c.moves[c.idx + 1] === 'jab' ? 2 : 1;
      if (c.idx >= c.moves.length) {
        c.result = 'done';
        G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
        G.round.combos++; G.tally.combos++;
        G.score += 100 * G.streak;
        sfx.ok();
        if (G.streak % 3 === 0) voice.say(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
        G.nextCallAt = performance.now() + 1200 + Math.random() * 1500;
      }
    } else if (MOVE_INFO[d.move].kind !== 'hold' || MOVE_INFO[want].kind === 'hold') {
      c.result = 'broke'; G.streak = 0; sfx.bad();
      G.nextCallAt = performance.now() + 1500;
    }
  }), [arm]);

  // game clock
  useEffect(() => {
    const id = setInterval(() => {
      const G = g.current, now = performance.now();
      if (st.current !== 'round') return;
      if (G.call?.result === 'live' && now > G.call.deadline) { G.call.result = 'late'; G.streak = 0; G.nextCallAt = now + 1200; }
      if (!G.call || G.call.result !== 'live') {
        if (now >= G.nextCallAt && G.endsAt - now > 3500) {
          const combo = Math.random() < 0.55;
          const moves = combo ? COMBOS[Math.floor(Math.random() * COMBOS.length)].moves : [SINGLES[Math.floor(Math.random() * SINGLES.length)]];
          G.call = { moves, idx: 0, t0: now, deadline: now + 1500 * moves.length + 900, result: 'live' };
          G.tally.called += moves.length; G.round.called++;
          voice.say(moves.map((m) => MOVE_INFO[m].cue.replace('!', '')).join(', ') + '!');
          simDo(hub, moves, 450);
        }
      }
      if (now >= G.endsAt) endRound();
    }, 50);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { g.current.timers.forEach(clearTimeout); voice.stop(); }, []);

  const later = (ms: number, fn: () => void) => g.current.timers.push(setTimeout(fn, ms));

  const countdown = (then: () => void) => {
    st.current = 'count';
    setState('count'); setCount(3); sfx.tick();
    later(1000, () => { setCount(2); sfx.tick(); });
    later(2000, () => { setCount(1); sfx.tick(); });
    later(3000, then);
  };

  const startRound = (n: number) => {
    const G = g.current;
    G.roundN = n;
    setRound(n);
    G.round = { hits: 0, best: 0, combos: 0, called: 0 };
    G.call = null; G.streak = 0;
    G.endsAt = performance.now() + G.roundLen * 1000;
    G.nextCallAt = performance.now() + 1500;
    st.current = 'round';
    setState('round');
    sfx.bell();
    voice.say(`Round ${n}. Fight!`);
  };

  const endRound = () => {
    const G = g.current, n = G.roundN;
    G.call = null;
    sfx.bell();
    if (n >= G.rounds) {
      st.current = 'done';
      setState('done');
      voice.say('Time! Great work.');
      const rec = G.tally.finish('bag', 'Heavy bag', { rounds: G.rounds, score: G.score });
      addSession(rec);
      later(1500, () => nav(`/summary/${rec.id}`));
    } else {
      st.current = 'rest';
      setState('rest');
      voice.say('Time. Breathe.');
      G.endsAt = performance.now() + 15000;
      later(15000 - 3000, () => countdown(() => startRound(n + 1)));
    }
  };

  const begin = () => {
    g.current.rounds = rounds;
    g.current.roundLen = roundLen;
    g.current.tally = new SessionTally();
    g.current.score = 0; g.current.hits = 0; g.current.bestStreak = 0;
    countdown(() => startRound(1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && st.current === 'ready') { e.preventDefault(); begin(); }
      if (e.key === 'Escape') nav('/home');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const G = g.current;
  const left = Math.max(0, Math.ceil((G.endsAt - performance.now()) / 1000));
  const clock = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const call = G.call;

  return (
    <div className="hud">
      {(state === 'round' || state === 'rest') && (
        <div className="paper roundcard">
          <div className="label">{state === 'rest' ? 'Rest' : `Round ${round}/${rounds}`}</div>
          <div className="numeral">{clock}</div>
        </div>
      )}

      {state === 'round' && call && (
        <div className="paper taped combocard">
          <div className="label">{call.moves.length > 1 ? 'Combo' : 'Call'}</div>
          <div className="numeral red" style={{ fontSize: 48 }}>{Math.min(call.idx, call.moves.length)} / {call.moves.length}</div>
          <ul>
            {call.moves.map((m, i) => (
              <li key={i} className={i < call.idx ? 'ok' : call.result !== 'live' && i === call.idx ? 'bad' : i === call.idx ? 'now' : ''}>
                <i />{MOVE_INFO[m].name}
              </li>
            ))}
          </ul>
          {call.result === 'broke' && <div className="label" style={{ color: 'var(--red)' }}>Wrong punch</div>}
          {call.result === 'late' && <div className="label" style={{ color: 'var(--red)' }}>Too slow</div>}
        </div>
      )}

      <div className="scorecard paper">
        <div className="inked" style={{ fontSize: 34 }}>Streak: <span className="red">{G.streak}</span></div>
        <div className="inked" style={{ fontSize: 30 }}>Score: {G.score.toLocaleString()}</div>
      </div>
      <div style={{ position: 'absolute', bottom: 28, right: 28 }}><HudChips className="static" /></div>

      {pops.map((p) => <Burst key={p.id} x={p.x} y={p.y} big={p.big} small={p.small} color={p.color} />)}
      {state === 'count' && <div key={count} className="count inked mustard">{count}</div>}

      {state === 'ready' && (
        <div className="paper taped readycard">
          <div className="label">Heavy bag</div>
          <div className="inked" style={{ fontSize: 44 }}>Glove up.</div>
          <p style={{ fontWeight: 600 }}>Throw what the coach calls, land it on the bag, keep the streak going.</p>
          <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
            <span className="lbl" style={{ flex: 'none' }}>Rounds</span>
            <div className="seg">{[1, 3, 5].map((n) => <button key={n} aria-pressed={rounds === n} onClick={() => setRounds(n)}>{n}</button>)}</div>
          </div>
          <div className="row" style={{ alignItems: 'center', marginBottom: 14 }}>
            <span className="lbl" style={{ flex: 'none' }}>Length</span>
            <div className="seg">{[30, 60, 90].map((n) => <button key={n} aria-pressed={roundLen === n} onClick={() => setRoundLen(n)}>{n}s</button>)}</div>
          </div>
          <button className="btn" onClick={begin}><span className="key">Space</span>Ring the bell</button>
        </div>
      )}

      {state === 'rest' && (
        <div className="paper taped readycard">
          <div className="label">Round {round} done</div>
          <div className="resrow">
            <div><span className="label">Hits</span><b className="numeral" style={{ fontSize: 44 }}>{G.round.hits}</b></div>
            <div><span className="label">Best</span><b className="numeral" style={{ fontSize: 44 }}>{G.round.best.toFixed(1)}<small>m/s</small></b></div>
            <div><span className="label">Combos</span><b className="numeral" style={{ fontSize: 44 }}>{G.round.combos}/{G.round.called}</b></div>
          </div>
          <p style={{ fontWeight: 600 }}>Shake the arms out. Next round in {left} s.</p>
        </div>
      )}

      <div className="dock">
        <button className="btn small" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={() => nav('/home')}>Exit</button>
        <button className="btn small" onClick={() => nav('/calibrate?next=/bag')}><span className="key">R</span>Recalibrate</button>
      </div>
    </div>
  );
}
