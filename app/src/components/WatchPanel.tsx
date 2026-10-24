import { useEffect, useRef, useState } from 'react';
import { HubStatus } from '../link/hub';
import { cleanCode } from '../link/config';
import { inviteWatch, resolvePairCode, watchOnStandby } from '../link/pairing';
import { useProfile } from '../store';
import { ActivityBar, ChipState, DeviceChip } from './DeviceChip';

/* Watch side of the Connect screen. First time: type the 4-character code the watch shows. After that the laptop
 * remembers the watch and just invites it to each new session. */
export function WatchPanel({ session, status }: { session: string; status: HubStatus }) {
  const deviceId = useProfile((p) => p.watchDeviceId);
  const setProfile = useProfile((p) => p.set);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [standby, setStandby] = useState(false);
  const invited = useRef('');
  const up = status.watch.up;

  // Is the remembered watch's app open and waiting?
  useEffect(() => {
    if (!deviceId || status.sim) { setStandby(false); return; }
    let live = true;
    const poll = async () => { const on = await watchOnStandby(deviceId); if (live) setStandby(on); };
    void poll();
    const id = setInterval(poll, 3000);
    return () => { live = false; clearInterval(id); };
  }, [deviceId, status.sim]);

  // Tell it which session to join, once per (session, standby) edge.
  useEffect(() => {
    if (!deviceId || !standby || up) { if (!standby) invited.current = ''; return; }
    if (invited.current === session) return;
    invited.current = session;
    void inviteWatch(deviceId, session);
  }, [deviceId, standby, up, session]);

  const pair = async () => {
    const code = cleanCode(text);
    if (code.length !== 4) { setErr('The code has 4 characters.'); return; }
    setBusy(true); setErr('');
    const r = await resolvePairCode(code);
    setBusy(false);
    if (!r.ok) {
      setErr(r.reason === 'unknown' ? "That code isn't known. Check the watch screen; codes expire after 10 minutes."
        : r.reason === 'slow' ? 'Too many tries. Wait a minute.' : "Can't reach the relay. Check the internet connection.");
      return;
    }
    setProfile({ watchDeviceId: r.deviceId });
    setText('');
    invited.current = '';
  };

  let chip: { state: ChipState; text: string };
  if (up) chip = { state: 'on', text: 'Connected' };
  else if (status.sim) chip = { state: 'wait', text: 'Starting' };
  else if (!deviceId) chip = { state: 'off', text: 'Not paired' };
  else if (standby) chip = { state: 'wait', text: 'Tap Start on the watch' };
  else chip = { state: 'off', text: 'Open the Jab app on the watch' };

  return (
    <section className="card">
      <header>Watch · forearm</header>
      <div className="body stack">
        <DeviceChip label="Watch" state={chip.state} text={chip.text} meta={up ? `${status.watch.hz} Hz${status.watch.battery != null ? ` · ${status.watch.battery}%` : ''}` : undefined} />
        <ActivityBar level={up ? status.activity.watch : 0} />

        {status.sim ? (
          <p className="hint">Simulated watch: a scripted arm is playing back. No pairing needed.</p>
        ) : !deviceId ? (
          <>
            <p style={{ margin: 0 }}>Open <b>Jab</b> on the watch. It shows a 4-character code. Type it here, once.</p>
            <div className="pairbox">
              <input className="field" value={text} maxLength={4} placeholder="····" aria-label="Watch code" autoCapitalize="characters" autoComplete="off" spellCheck={false}
                onChange={(e) => setText(cleanCode(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && pair()} />
              <button className="btn" onClick={pair} disabled={busy || text.length !== 4}>{busy ? '…' : 'Pair'}</button>
            </div>
            {err && <div className="msg">{err}</div>}
          </>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              {up ? 'The watch is streaming.' : standby ? 'The watch got the invitation. Tap Start on it.' : 'This watch is remembered. Open Jab on it and it will join this session.'}
            </p>
            <p className="hint" style={{ margin: 0 }}>
              <button className="link" onClick={() => { invited.current = ''; if (deviceId) void inviteWatch(deviceId, session); }}>Send the invitation again</button>
              {' · '}
              <button className="link" onClick={() => { setProfile({ watchDeviceId: null }); setErr(''); }}>Forget this watch</button>
            </p>
          </>
        )}

        <details>
          <summary>Watch orientation</summary>
          <WatchAxisPicker />
        </details>
      </div>
    </section>
  );
}

function WatchAxisPicker() {
  const axis = useProfile((p) => p.watchAxis);
  const set = useProfile((p) => p.set);
  return (
    <div style={{ marginTop: 10 }}>
      <p className="hint" style={{ marginTop: 0 }}>Which side of the watch face points toward your fingers? Standard wear: the 3 o'clock side.</p>
      <div className="seg" role="group" aria-label="Watch axis">
        {(['12', '3', '6', '9'] as const).map((c) => (
          <button key={c} aria-pressed={axis === c} onClick={() => set({ watchAxis: c })}>{c}</button>
        ))}
      </div>
    </div>
  );
}
