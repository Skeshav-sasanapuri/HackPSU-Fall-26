import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useCalibration } from '../armSession';
import { Burst, HudChips } from '../components/Hud';
import { Stars } from '../components/Stars';
import { useStageConfig } from '../components/StageView';
import { Detection } from '../core/detector';
import { MOVE_INFO, MoveId } from '../core/moves';
import { Attempt, scoreAttempt, stars } from '../core/score';
import { SessionTally, useHistory } from '../history';
import { useRecalibrateKey } from '../hooks';
import { useArm, useHub } from '../hubContext';
import { Cancelled, LESSONS, Lesson as LessonT, collectMoves, lessonById, simDo, timeToGuard, useSensei, useSimPuppet, wait, waitForMove } from '../lessons';
import { getStage } from '../scene/stage';
import { useLink } from '../components/SensorGuard';
import { sfx } from '../sfx';
import { voice } from '../voice';

type Phase = 'intro' | 'watch' | 'copy' | 'cue' | 'done';
const COPY_REPS = 4, CUE_REPS = 5, COMBO_REPS = 4;

interface Pop { id: number; x: number; y: number; big: string; small: string; color: string }
let popId = 0;

export function Lesson() {
  const { id = '' } = useParams();
  const lesson = lessonById(id);
  const cal = useCalibration((s) => s.cal);
  if (!lesson) return <Navigate to="/train" replace />;
  if (!cal) return <Navigate to={`/calibrate?next=/train/${id}`} replace />;
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
  useStageConfig({ shot: 'lesson' });
  useRecalibrateKey();

  const [phase, setPhase] = useState<Phase>('intro');
  const [caption, setCaption] = useState('');
  const [sub, setSub] = useState('');
  const [rep, setRep] = useState({ i: 0, n: 0 });
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [last, setLast] = useState<Attempt | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const abort = useRef<AbortController | null>(null);
  const isCombo = !!lesson.combo;
  const m = lesson.moves[0];
  const info = MOVE_INFO[m];

  useEffect(() => () => { abort.current?.abort(); voice.stop(); }, []);

  // a sensor dropped mid-lesson: stop cleanly, start again once it is back
  const linkOk = useLink((s) => s.ok);
  useEffect(() => {
    if (linkOk || phase === 'intro' || phase === 'done') return;
    abort.current?.abort();
    sensei.stop();
    voice.stop();
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

  const record = (a: Attempt, list: Attempt[]) => { list.push(a); setAttempts([...list]); setLast(a); pop(a); };

  const start = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const sig = ctl.signal;
    const list: Attempt[] = [];
    const tally = new SessionTally();
    const offTally = arm.onMove((d) => tally.add(d));
    setAttempts([]); setLast(null);
    const holdKind = (x: MoveId) => MOVE_INFO[x].kind === 'hold';
    try {
      // 1. watch
      setPhase('watch');
      if (!isCombo) {
        for (let i = 0; i < 3; i++) {
          setCaption('Watch me'); setSub(info.keys[i]);
          voice.say(info.keys[i]);
          await sensei.playMove(m, 0.45);
          await wait(600, sig);
        }
      } else {
        for (let i = 0; i < 2; i++) {
          setCaption('Watch me'); setSub(lesson.moves.map((x) => MOVE_INFO[x].name).join(' → '));
          voice.say(lesson.title);
          await sensei.playCombo(lesson.moves, 0.6);
          await wait(700, sig);
        }
      }
      // 2. copy alongside the coach (single moves)
      if (!isCombo) {
        setPhase('copy');
        for (let r = 0; r < COPY_REPS; r++) {
          setRep({ i: r + 1, n: COPY_REPS });
          setCaption('Together!'); setSub(`Copy me: ${info.name.toLowerCase()}`);
          await wait(700, sig);
          voice.say(info.cue);
          void sensei.playMove(m, 1);
          simDo(hub, [m], 250);
          const d = await waitForMove(arm, m, holdKind(m) ? 3800 : 2600, sig);
          const ret = d && !holdKind(m) ? await timeToGuard(arm, 1500) : null;
          record(scoreAttempt(m, d, { returnMs: ret }), list);
          await wait(1100, sig);
        }
      }
      // 3. on the coach's call
      setPhase('cue');
      const reps = isCombo ? COMBO_REPS : CUE_REPS;
      for (let r = 0; r < reps; r++) {
        setRep({ i: r + 1, n: reps });
        setCaption('On my call…'); setSub(isCombo ? lesson.title : 'Guard up. Wait for it.');
        await wait(1200 + Math.random() * 1800, sig);
        const tCue = performance.now();
        if (!isCombo) {
          setCaption(info.cue); setSub('');
          voice.say(info.cue);
          simDo(hub, [m]);
          const d = await waitForMove(arm, m, holdKind(m) ? 3800 : 2600, sig);
          const ret = d && !holdKind(m) ? await timeToGuard(arm, 1500) : null;
          tally.called++; if (d?.move === m) tally.calledRight++;
          record(scoreAttempt(m, d, { reactionMs: d ? Math.max(0, d.t - tCue) : null, returnMs: ret }), list);
        } else {
          const words = lesson.moves.map((x) => MOVE_INFO[x].cue.replace('!', ''));
          setCaption(words.join(', ') + '!'); setSub('');
          voice.say(words.join(', ') + '!');
          simDo(hub, lesson.moves, 500);
          const ds = await collectMoves(arm, 1500 * lesson.moves.length + 800, sig, (got) => got.length >= lesson.moves.length);
          let all = true;
          lesson.moves.forEach((x, i) => {
            const d: Detection | null = ds[i] ?? null;
            const a = scoreAttempt(x, d, { reactionMs: i === 0 && d ? Math.max(0, d.t - tCue) : null });
            tally.called++; if (a.correct) tally.calledRight++; else all = false;
            list.push(a);
          });
          if (all) tally.combos++;
          setAttempts([...list]);
          const lastA = list[list.length - 1];
          setLast(lastA);
          pop({ ...lastA, correct: all, praise: all ? 'Combo!' : 'Broke it' });
        }
        await wait(1000, sig);
      }
      // 4. results
      const n = stars(list);
      setStars(lesson.id, n);
      addSession(tally.finish('train', `Lesson: ${lesson.title}`, { stars: n, score: Math.round(list.reduce((s, a) => s + a.score, 0) / Math.max(1, list.length)) }));
      setPhase('done');
      setCaption(n === 3 ? 'Champion work!' : n === 2 ? 'Solid. Again?' : n === 1 ? 'Keep at it' : 'Back to basics');
      voice.say(n >= 2 ? 'Good work, kid.' : 'Again. You can do better.');
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    } finally {
      offTally();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (phase === 'intro' || phase === 'done')) { e.preventDefault(); void start(); }
      if (e.key === 'Escape') nav('/train');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = LESSONS.findIndex((l) => l.id === lesson.id);
  const next = LESSONS[idx + 1];
  const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / attempts.length) : 0;
  const n = stars(attempts);

  return (
    <div className="hud">
      <div className="paper taped lessontitle">
        <div className="label">{isCombo ? 'Combo' : `Lesson ${idx + 1}`}</div>
        <div className="inked" style={{ fontSize: 34 }}>{lesson.title}</div>
        <div className="phases">
          {(['watch', 'copy', 'cue'] as Phase[]).filter((p) => !(isCombo && p === 'copy')).map((p) => (
            <span key={p} className={phase === p ? 'on' : ''}>{p === 'cue' ? 'On call' : p}</span>
          ))}
        </div>
      </div>
      <HudChips />

      {phase !== 'intro' && phase !== 'done' && (
        <div className="callout">
          <div key={caption} className={`inked ${phase === 'cue' && caption !== 'On my call…' ? 'red big' : ''}`}>{caption}</div>
          {sub && <div className="paper plain sub">{sub}</div>}
          {rep.n > 0 && phase !== 'watch' && <div className="repdots">{Array.from({ length: rep.n }, (_, i) => <i key={i} className={i < rep.i ? 'f' : ''} />)}</div>}
        </div>
      )}

      {pops.map((p) => <Burst key={p.id} x={p.x} y={p.y} big={p.big} small={p.small} color={p.color} />)}

      {phase === 'intro' && (
        <div className="paper lessoncard">
          <div className="label">{isCombo ? 'The combo' : 'The move'}</div>
          <p style={{ fontSize: 19, fontWeight: 600, margin: '4px 0 10px' }}>{lesson.blurb}</p>
          {!isCombo ? <ol>{info.keys.map((k) => <li key={k}>{k}</li>)}</ol> : <ol>{lesson.moves.map((x, i) => <li key={i}>{MOVE_INFO[x].name}</li>)}</ol>}
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button className="btn" onClick={() => void start()}><span className="key">Space</span>Start lesson</button>
            <button className="btn ghost" style={{ background: 'var(--paper)' }} onClick={() => nav('/train')}>Lessons</button>
          </div>
        </div>
      )}

      {last && phase !== 'done' && phase !== 'intro' && (
        <div className="paper tipcard">
          <div className="label">{last.correct ? `${last.praise} · ${last.score} pts` : last.praise}</div>
          {(last.tips.length ? last.tips : ['Clean. Keep that rhythm.']).map((t) => <p key={t}>{t}</p>)}
        </div>
      )}

      {phase === 'done' && (
        <div className="paper taped resultcard">
          <div className="label">Results</div>
          <div className="inked red" style={{ fontSize: 46 }}>{caption}</div>
          <Stars n={n} size={46} />
          <div className="resrow">
            <div><span className="label">Score</span><b className="numeral" style={{ fontSize: 44 }}>{avg}</b></div>
            <div><span className="label">Right move</span><b className="numeral" style={{ fontSize: 44 }}>{attempts.filter((a) => a.correct).length}/{attempts.length}</b></div>
            <div><span className="label">Best speed</span><b className="numeral" style={{ fontSize: 44 }}>{Math.max(0, ...attempts.map((a) => a.peakSpeed)).toFixed(1)}<small>m/s</small></b></div>
          </div>
          <table className="atts">
            <thead><tr><th>#</th><th>Called</th><th>You threw</th><th>Speed</th><th>React</th><th>Pts</th></tr></thead>
            <tbody>
              {attempts.map((a, i) => (
                <tr key={i} className={a.correct ? '' : 'bad'}>
                  <td>{i + 1}</td><td>{MOVE_INFO[a.expected].name}</td><td>{a.got ? MOVE_INFO[a.got].name : '—'}</td>
                  <td>{a.peakSpeed ? a.peakSpeed.toFixed(1) : '—'}</td><td>{a.reactionMs != null ? `${Math.round(a.reactionMs)} ms` : '—'}</td><td>{a.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => void start()}><span className="key">Space</span>Again</button>
            {next && <button className="btn small" onClick={() => nav(`/train/${next.id}`)}>Next: {next.title}</button>}
            <button className="btn small" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={() => nav('/train')}>Lessons</button>
          </div>
        </div>
      )}
    </div>
  );
}
