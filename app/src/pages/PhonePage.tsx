import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SESSION_RE } from '../link/config';
import { PhoneSensor, PhoneState } from '../link/phoneSensor';

/* Opened by scanning the QR code on the laptop. One big button, then a plain "connected" screen. */
export function PhonePage() {
  const { session = '' } = useParams();
  const code = session.toUpperCase();
  if (!SESSION_RE.test(code)) {
    return (
      <div className="phone">
        <Header code="" />
        <div className="big">Bad <em>code</em></div>
        <p>This link doesn't look right. Scan the QR code on the laptop again.</p>
      </div>
    );
  }
  return <Phone code={code} />;
}

function Header({ code }: { code: string }) {
  return (
    <header className="top">
      <span className="mark">JAB<i /></span>
      {code && <span className="ticket">SESSION<b>{code}</b></span>}
    </header>
  );
}

function Phone({ code }: { code: string }) {
  const [st, setSt] = useState<PhoneState | null>(null);
  const ref = useRef<PhoneSensor | null>(null);
  const sensor = useMemo(() => new PhoneSensor(code, setSt), [code]);
  ref.current = sensor;
  useEffect(() => {
    sensor.connect();
    return () => sensor.disconnect();
  }, [sensor]);

  const s = st ?? sensor.state;
  const running = s.sensor === 'running';
  const blocked = s.sensor === 'insecure' || s.sensor === 'unsupported' || s.sensor === 'blocked' || s.sensor === 'error';

  let head: JSX.Element;
  let sub: string;
  if (blocked) {
    head = <>Can't <em>sense</em></>;
    sub = s.message;
  } else if (!running) {
    head = <>Ready</>;
    sub = 'Tap the button, then strap the phone on your upper arm, screen facing out, top edge toward your shoulder.';
  } else if (s.socket !== 'up') {
    head = <>Re<em>connecting</em></>;
    sub = 'Lost the connection. Retrying. Keep this screen open.';
  } else if (!s.viewer) {
    head = <>Waiting for the <em>laptop</em></>;
    sub = 'Sensing. The laptop page will pick this phone up by itself.';
  } else {
    head = <>Connected.<br /><em>Strap me on.</em></>;
    sub = 'Put the phone in the armband on your bicep. Keep this screen open and on.';
  }

  return (
    <div className="phone">
      <Header code={code} />
      <div className="big">{head}</div>
      <p style={{ fontSize: 19 }}>{sub}</p>

      {!running && !blocked && (
        <button className="btn block" style={{ fontSize: 30, padding: '18px 0' }} onClick={() => void sensor.start()}>Start sensing</button>
      )}
      {running && <button className="btn ghost block small" onClick={() => sensor.stop()}>Stop</button>}

      {s.hidden && <div className="msg">The page went to the background, so sensing paused. Bring it back to the front.</div>}
      {running && s.wake === 'no' && <div className="msg">Couldn't keep the screen awake. Turn off auto-lock while you train.</div>}

      <div style={{ marginTop: 'auto' }}>
        <div className="kv"><span>Laptop</span><b className={s.viewer ? '' : 'bad'}>{s.viewer ? 'connected' : s.socket === 'up' ? 'not open yet' : 'no link'}</b></div>
        <div className="kv"><span>Sensor</span><b>{running ? `streaming ${s.hz} Hz` : 'off'}</b></div>
        {running && <div className="kv"><span>Screen awake</span><b>{s.wake === 'yes' ? 'yes' : 'unknown'}</b></div>}
        {running && s.conv === 'assumed' && <div className="kv"><span>Orientation check</span><b>assumed</b></div>}
        <p className="hint" style={{ marginTop: 14 }}>A snug sports armband matters: if the phone slides during a punch the readings go wrong.</p>
      </div>
    </div>
  );
}
