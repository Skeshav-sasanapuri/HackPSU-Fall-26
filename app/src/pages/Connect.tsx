import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AiKeys } from '../components/AiKeys';
import { ActivityBar, ChipState, DeviceChip } from '../components/DeviceChip';
import { PhoneEdgePicker } from '../components/PhoneEdgePicker';
import { Qr } from '../components/Qr';
import { useStageConfig } from '../components/StageView';
import { WatchPanel } from '../components/WatchPanel';
import { publicOrigin } from '../link/config';
import { useHubStatus } from '../hubContext';
import { useProfile, useSession } from '../store';

export function Connect() {
  const code = useSession((s) => s.code);
  const phoneAxis = useProfile((p) => p.phoneAxis);
  const setProfile = useProfile((p) => p.set);
  const status = useHubStatus();
  const [copied, setCopied] = useState(false);
  const nav = useNavigate();
  useStageConfig({ shot: 'hero', live: false });

  const url = `${publicOrigin()}/p/${code}`;
  const pretty = url.replace(/^https?:\/\//, '');
  const phoneUp = status.phone.up, watchUp = status.watch.up;

  let phoneChip: { state: ChipState; text: string };
  if (phoneUp) phoneChip = { state: 'on', text: 'Connected' };
  else if (status.relay !== 'up') phoneChip = { state: 'off', text: 'Connecting to relay…' };
  else phoneChip = { state: 'wait', text: 'Scan the code' };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  return (
    <main className="trio-page">
      <h2 className="pagetitle inked">Strap in</h2>

      {status.relay === 'down' && !status.sim && (
        <div className="msg" style={{ marginBottom: 20 }}>Can't reach the relay. Retrying. If this stays, check the internet connection.</div>
      )}

      <div className="trio">
        <section className="card">
          <header>Phone · upper arm</header>
          <div className="body stack">
            <DeviceChip label="Phone" state={phoneChip.state} text={phoneChip.text} meta={phoneUp ? `${status.phone.hz} Hz` : undefined} />
            <ActivityBar level={phoneUp ? status.activity.phone : 0} />

            {status.sim ? (
              <p className="hint">Simulated phone: a scripted arm is playing back. No scanning needed.</p>
            ) : phoneUp ? (
              <p style={{ margin: 0 }}>The phone is streaming. Put it in the armband on your bicep.</p>
            ) : (
              <>
                <p style={{ margin: 0 }}>Scan with the phone camera. Chrome opens and joins by itself, then tap <b>Start sensing</b>.</p>
                <Qr value={url} />
                <div className="url">{pretty}</div>
                <p className="hint" style={{ textAlign: 'center', margin: 0 }}>
                  <button className="link" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
                </p>
              </>
            )}

            <hr className="rule thin" style={{ margin: '6px 0' }} />
            <PhoneEdgePicker value={phoneAxis} onChange={(c) => setProfile({ phoneAxis: c })} />
          </div>
        </section>

        <div className="trio-gap" aria-hidden />
        <div className="trio-col">
          <WatchPanel session={code} status={status} />
          <AiKeys />
        </div>
      </div>

      {phoneUp && watchUp && (
        <div className="ready trio-foot">
          <span className="stamp">Both live</span>
          <div>
            <b>Both sensors are streaming.</b>
            <div className="hint" style={{ marginTop: 2 }}>Move your arm and watch both bars jump. Then calibrate.</div>
          </div>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => nav('/calibrate')}>Calibrate</button>
        </div>
      )}
    </main>
  );
}
