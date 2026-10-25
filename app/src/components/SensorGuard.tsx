import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { useCalibration } from '../armSession';
import { useArm, useHubStatus } from '../hubContext';

/* Watches the two sensors while a live screen is open. If one drops for more than a moment, an overlay says which
 * and how to fix it, and `useLink().ok` turns false so lessons stop and bag rounds pause. When the arm looks like it
 * has drifted (or it has been a while), a small prompt suggests recalibrating. */
export const useLink = create<{ ok: boolean; lost: ('watch' | 'phone')[]; set: (ok: boolean, lost: ('watch' | 'phone')[]) => void }>((set) => ({
  ok: true, lost: [], set: (ok, lost) => set({ ok, lost }),
}));

const LIVE = ['/mirror', '/train/', '/bag', '/home'];
const GRACE_MS = 1500;
const STALE_CAL_MS = 10 * 60 * 1000;

export function SensorGuard() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const status = useHubStatus(300);
  const cal = useCalibration((s) => s.cal);
  const calAt = useCalibration((s) => s.at);
  const arm = useArm();
  const setLink = useLink((s) => s.set);
  const since = useRef<number | null>(null);
  const [lost, setLost] = useState<('watch' | 'phone')[]>([]);
  const [back, setBack] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(0);

  const live = LIVE.some((r) => pathname.startsWith(r));
  const missing: ('watch' | 'phone')[] = [];
  if (!status.sim && cal) {
    if (!status.watch.up) missing.push('watch');
    if (cal.phone && !status.phone.up) missing.push('phone');
  }
  const key = missing.join(',');

  useEffect(() => {
    if (!key) {
      if (lost.length) { setBack(true); setTimeout(() => setBack(false), 6000); }
      since.current = null;
      setLost([]);
      setLink(true, []);
      return;
    }
    since.current ??= performance.now();
    const id = setTimeout(() => { setLost(missing); setLink(false, missing); }, Math.max(0, GRACE_MS - (performance.now() - since.current)));
    return () => clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return null;

  const stale = cal && Date.now() - calAt > STALE_CAL_MS;
  const drift = cal && (arm.driftSuspect || stale) && dismissedAt < calAt;

  return (
    <>
      {lost.length > 0 && (
        <div className="lostveil">
          <div className="paper taped lostcard">
            <div className="label">Connection lost</div>
            <div className="inked red" style={{ fontSize: 46 }}>{lost.length === 2 ? 'Both sensors dropped' : lost[0] === 'watch' ? 'Lost the watch' : 'Lost the phone'}</div>
            {lost.includes('phone') && <p><b>Phone:</b> the screen probably turned off or Chrome went to the background. Wake it and bring the Jab page to the front. It reconnects by itself.</p>}
            {lost.includes('watch') && <p><b>Watch:</b> open Jab on the watch and tap Start. If it says "default net", it is going through the phone's Bluetooth; Wi-Fi is better.</p>}
            <p className="hint">Everything is paused. Lessons stop; bag rounds wait for you.</p>
            <button className="btn small" style={{ pointerEvents: 'auto' }} onClick={() => nav('/connect')}>Open connect screen</button>
          </div>
        </div>
      )}
      {back && !lost.length && (
        <div className="toast paper">Back online. If the boxer's arm looks off, press <span className="key">R</span> to recalibrate.</div>
      )}
      {drift && !lost.length && !back && (
        <div className="toast paper">
          {arm.driftSuspect ? 'Your jabs are reading bent. The sensors may have drifted.' : 'It has been a while since calibrating.'} Press <span className="key">R</span> to recalibrate.
          <button className="link" style={{ marginLeft: 10 }} onClick={() => setDismissedAt(Date.now())}>Dismiss</button>
        </div>
      )}
    </>
  );
}
