import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useCalibration } from '../armSession';
import { Burst, HudChips } from '../components/Hud';
import { Stars } from '../components/Stars';
import { useStageConfig } from '../components/StageView';
import { Detection } from '../core/detector';
import { MOVE_INFO } from '../core/moves';
import { Attempt, scoreAttempt, stars } from '../core/score';
import { SessionTally, useHistory } from '../history';
import { useArm, useHub } from '../hubContext';
import { Cancelled, LESSONS, Lesson as LessonT, calibrateHold, collectMoves, lessonById, simDo, timeToGuard, useSensei, useSimPuppet, wait, waitForMove } from '../lessons';
import { getStage } from '../scene/stage';
import { useLink } from '../components/SensorGuard';
import { sfx } from '../sfx';
import { useProfile } from '../store';
import { voice } from '../voice';

/* One lesson: calibrate, the coach steps forward and shows the move (slow, then full speed), then the student
 * tries it three times and each try is scored. "Again" repeats the three tries; "Watch again" replays the demo. */
type Phase = 'intro' | 'calibrate' | 'watch' | 'try' | 'done';
const TRIES = 3;

interface Pop { id: number; x: number; y: number; big: string; small: string; color: string }
let popId = 0;

export function Lesson() {
  const { id = '' } = useParams();
  const lesson = lessonById(id);
  if (!lesson) return <Navigate to="/train" replace />;
  return <Runner key={lesson.id} lesson={lesson} />;
}

function Runner({ lesson }: { lesson: LessonT }) {
  const nav = useNavigate();
  const arm = useArm();
  const sensei = useSensei();
  const hub = useHub();
  useSimPuppet(hub);
  const setStars = useHistory((h) => h.setStars);
  const addSession = useHistory((h) => h.add);
  const setCal = useCalibration((s) => s.set);
  const phoneAxis = useProfile((p) => p.phoneAxis);

  const [phase, setPhase] = useState<Phase>('intro');
  const [caption, setCaption] = useState('');
  const [sub, setSub] = useState('');
  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [tryN, setTryN] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [last, setLast] = useState<Attempt | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const calibrated = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useStageConfig({ shot: phase === 'watch' ? 'demo' : 'lesson', ghost: phase === 'calibrate' });
  const isCombo = !!lesson.combo;
  const m = lesson.moves[0];
  const info = MOVE_INFO[m];

  useEffect(() => () => { abort.current?.abort(); voice.stop(); arm.cancelHold(); getStage().spotlight(false, 0.3); }, [arm]);
  // the coach greets the student while the intro card is up (the rigged model may still be loading)
  useEffect(() => { const t = setTimeout(() => { if (!abort.current) void sensei.gesture('coach_talking'); }, 900); return () => clearTimeout(t); }, [sensei]);

  // a sensor dropped mid-lesson: stop cleanly, start again once it is back
  const linkOk = useLink((s) => s.ok);
  useEffect(() => {
    if (linkOk || phase === 'intro' || phase === 'done') return;
    abort.current?.abort();
    sensei.stop();
    voice.stop();
    getStage().spotlight(false);
    setPhase('intro');
  }, [linkOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const pop = (a: Attempt) => {
    const stage = getStage();
    const s = stage.toScreen(stage.boxer.gloveWorld(stage.boxer.lead));
    const p: Pop = {
      id: ++popId, x: s.x + 80, y: s.y - 70, big: a.correct ? a.praise : a.got ? 'Not quite' : 'Missed',
      small: a.correct && a.peakSpeed ? `${a.peakSpeed.toFixed(1)} m/s` : a.got ? MOVE_INFO[a.got].name : '', color: a.correct ? '#d4a017' : '#c3261c',
    };
    setPops((ps) => [...ps.slice(-2), p]);
    setTimeout(() => setPops((ps) => ps.filter((q) => q.id !== p.id)), 1300);
    if (a.correct) sfx.ok(); else sfx.bad();
  };

  const run = async (o: { watch: boolean }) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const sig = ctl.signal;
    const stage = getStage();
    const list: Attempt[] = [];
    const tally = new SessionTally();
    const offTally = arm.onMove((d) => tally.add(d));
    setAttempts([]); setLast(null); setError('');
    sensei.stop();
    try {
      // 1. calibrate (once per visit)
      if (!calibrated.current) {
        if (!hub.status().watch.up) { setError('The watch is not connected. Open the Watch how u Box app on the watch and tap Start.'); setPhase('intro'); return; }
        setPhase('calibrate'); setProgress(0);
        voice.say('Arms straight out in front. Hold still.');
        const r = await calibrateHold(arm, hub, phoneAxis, hub.status().phone.up, sig, setCount, setProgress);
        if ('error' in r) { setError(r.error); setPhase('intro'); sfx.bad(); return; }
        setCal(r);
        calibrated.current = true;
        sfx.ok();
        await wait(500, sig);
      }
      // 2. the coach steps forward and shows it: slow, then full speed
      if (o.watch) {
        setPhase('watch');
        stage.spotlight(true);
        setCaption('Watch me'); setSub('');
        await wait(600, sig);
        for (const [i, speed] of [0.8, 1.1].entries()) {
          setCaption(i === 0 ? 'Slow first' : 'Full speed');
          setSub(isCombo ? lesson.moves.map((x) => MOVE_INFO[x].name).join(' → ') : info.keys.join('  ·  '));
          voice.say(i === 0 ? (isCombo ? lesson.title : info.keys[0]) : 'Now at full speed.');
          await sensei.demo(lesson.moves, speed, stage.boxer.lead);
          await wait(450, sig);
        }
        stage.spotlight(false);
        await wait(900, sig);
      }
      // 3. three scored tries
      setPhase('try');
      for (let r = 0; r < TRIES; r++) {
        setTryN(r + 1);
        setCaption('Your turn'); setSub(`Try ${r + 1} of ${TRIES}: ${lesson.title.toLowerCase()}`);
        voice.say(r === 0 ? `Your turn. ${isCombo ? lesson.title : info.cue}` : isCombo ? 'Again.' : info.cue);
        let a: Attempt;
        if (!isCombo) {
          simDo(hub, [m], 600);
          const hold = info.kind === 'hold';
          const d = await waitForMove(arm, m, hold ? 6000 : 5000, sig);
          const ret = d && !hold ? await timeToGuard(arm, 1500) : null;
          a = scoreAttempt(m, d, { returnMs: ret });
        } else {
          simDo(hub, lesson.moves, 600);
          const ds = await collectMoves(arm, 5000 + 1200 * lesson.moves.length, sig, (got) => got.length >= lesson.moves.length);
          const parts = lesson.moves.map((x, i) => scoreAttempt(x, (ds[i] as Detection | undefined) ?? null));
          const all = parts.every((p) => p.correct);
          const bad = parts.find((p) => !p.correct);
          a = {
            ...parts[parts.length - 1], correct: all, score: Math.round(parts.reduce((s, p) => s + p.score, 0) / parts.length),
            peakSpeed: Math.max(...parts.map((p) => p.peakSpeed)), praise: all ? 'Combo!' : 'Broke it', tips: bad ? bad.tips : [],
          };
          if (all) tally.combos++;
        }
        tally.called++; if (a.correct) tally.calledRight++;
        list.push(a); setAttempts([...list]); setLast(a); pop(a);
        await wait(1600, sig);
      }
      // 4. results
      const n = stars(list);
      setStars(lesson.id, n);
      addSession(tally.finish('train', `Lesson: ${lesson.title}`, { stars: n, score: Math.round(list.reduce((s, a) => s + a.score, 0) / Math.max(1, list.length)), tries: list.map((a) => ({ score: a.score, correct: a.correct, tips: a.tips })) }));
      setPhase('done');
      setCaption(n === 3 ? 'Champion work!' : n === 2 ? 'Solid. Again?' : n === 1 ? 'Keep at it' : 'Back to basics');
      voice.say(n >= 2 ? 'Good work, kid.' : 'Again. You can do better.');
      void sensei.gesture(n >= 2 ? 'coach_clapping' : 'coach_talking');
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    } finally {
      offTally();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (phase === 'intro' || phase === 'done')) { e.preventDefault(); void run({ watch: phase === 'intro' }); }
      if ((e.key === 'w' || e.key === 'W') && phase === 'done') void run({ watch: true });
      if ((e.key === 'r' || e.key === 'R') && (phase === 'intro' || phase === 'done')) { calibrated.current = false; void run({ watch: false }); }
      if (e.key === 'Escape') nav('/train');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = LESSONS.findIndex((l) => l.id === lesson.id);
  const next = LESSONS[idx + 1];
  const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / attempts.length) : 0;
  const n = stars(attempts);
  const steps: [Phase, string][] = [['calibrate', 'Calibrate'], ['watch', 'Watch'], ['try', 'Your turn']];

  return (
    <div className="hud">
      <div className="paper taped lessontitle">
        <div className="label">{isCombo ? 'Combo' : `Lesson ${idx + 1}`}</div>
        <div className="inked" style={{ fontSize: 28 }}>{lesson.title}</div>
        <div className="phases">{steps.map(([p, t]) => <span key={p} className={phase === p ? 'on' : ''}>{t}</span>)}</div>
      </div>
      <HudChips />

      {phase === 'calibrate' && (
        <div className="paper lessoncard">
          <div className="label">Calibrate</div>
          <p className="lead">Hold both arms straight out in front, palms down. Stay still.</p>
          <div className="holdbar"><i style={{ width: `${progress * 100}%` }} /></div>
        </div>
      )}
      {phase === 'calibrate' && count > 0 && <div key={count} className="count inked mustard">{count}</div>}

      {(phase === 'watch' || phase === 'try') && (
        <div className="callout">
          <div key={caption} className={`inked ${phase === 'try' ? 'red big' : ''}`}>{caption}</div>
          {sub && <div className="paper plain sub">{sub}</div>}
          {phase === 'try' && <div className="repdots">{Array.from({ length: TRIES }, (_, i) => <i key={i} className={i < tryN ? 'f' : ''} />)}</div>}
        </div>
      )}

      {pops.map((p) => <Burst key={p.id} x={p.x} y={p.y} big={p.big} small={p.small} color={p.color} />)}

      {phase === 'intro' && (
        <div className="paper lessoncard">
          <div className="label">{isCombo ? 'The combo' : 'The move'}</div>
          <p className="lead">{lesson.blurb}</p>
          {!isCombo ? <ol>{info.keys.map((k) => <li key={k}>{k}</li>)}</ol> : <ol>{lesson.moves.map((x, i) => <li key={i}>{MOVE_INFO[x].name}</li>)}</ol>}
          <p className="howto">Calibrate, watch the coach, then try it {TRIES} times.</p>
          {error && <p className="err">{error}</p>}
          <div className="row">
            <button className="btn small" onClick={() => void run({ watch: true })}><span className="key">Space</span>{error ? 'Try again' : 'Start'}</button>
            <button className="btn small ghost" onClick={() => nav('/train')}>Lessons</button>
          </div>
        </div>
      )}

      {last && phase === 'try' && (
        <div className="paper tipcard">
          <div className="label">{last.correct ? `${last.praise} · ${last.score} pts` : last.praise}</div>
          {(last.tips.length ? last.tips : ['Clean. Keep that rhythm.']).slice(0, 2).map((t) => <p key={t}>{t}</p>)}
        </div>
      )}

      {phase === 'done' && (
        <div className="paper taped resultcard">
          <div className="label">Results</div>
          <div className="reshead">
            <div className="inked red">{caption}</div>
            <Stars n={n} size={30} />
            <div className="avg"><span className="label">Score</span><b className="numeral">{avg}</b></div>
          </div>
          <div className="tries">
            {attempts.map((a, i) => (
              <div key={i} className={`try ${a.correct ? '' : 'bad'}`}>
                <div className="label">Try {i + 1}</div>
                <b className="numeral">{a.score}</b>
                <div className="what">{a.correct ? a.praise : a.got ? `Looked like a ${MOVE_INFO[a.got].name.toLowerCase()}` : 'Nothing detected'}</div>
                {a.peakSpeed > 0 && <div className="spd">{a.peakSpeed.toFixed(1)} m/s</div>}
                {a.tips[0] && <div className="tip">{a.tips[0]}</div>}
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn small" onClick={() => void run({ watch: false })}><span className="key">Space</span>Again</button>
            <button className="btn small ghost" onClick={() => void run({ watch: true })}><span className="key">W</span>Watch again</button>
            {next && <button className="btn small ghost" onClick={() => nav(`/train/${next.id}`)}>Next: {next.title}</button>}
            <button className="btn small ghost" onClick={() => nav('/train')}>Lessons</button>
          </div>
        </div>
      )}
    </div>
  );
}
