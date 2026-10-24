import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ArmSession, useCalibration } from './armSession';
import { SIM } from './flags';
import { DeviceHub, HubStatus, RelayHub, SimHub } from './link/hub';
import { armLengths, ensureSession, useProfile, useSession } from './store';

const Ctx = createContext<DeviceHub | null>(null);

/** Owns the connection to the two sensors for the laptop screens. One hub per session code. */
export function HubProvider({ children }: { children: ReactNode }) {
  ensureSession();
  const code = useSession((s) => s.code);
  const hub = useMemo(() => (SIM ? new SimHub() : new RelayHub(code)), [code]);
  const watchAxis = useProfile((p) => p.watchAxis);
  useEffect(() => { hub.watchAxis = watchAxis; }, [hub, watchAxis]);
  useEffect(() => {
    hub.start();
    return () => hub.stop();
  }, [hub]);
  return (
    <Ctx.Provider value={hub}>
      <ArmProvider hub={hub} code={SIM ? 'SIM' : code}>{children}</ArmProvider>
    </Ctx.Provider>
  );
}

const ArmCtx = createContext<ArmSession | null>(null);

function ArmProvider({ hub, code, children }: { hub: DeviceHub; code: string; children: ReactNode }) {
  const p = useProfile();
  const session = useMemo(() => new ArmSession(hub, armLengths(p), p.weightKg), [hub]); // eslint-disable-line react-hooks/exhaustive-deps
  const cal = useCalibration((s) => s.cal);
  const setCal = useCalibration((s) => s.set);
  useEffect(() => session.attach(), [session]);
  useEffect(() => { session.setBody(armLengths(p), p.weightKg); }, [session, p.heightCm, p.upperArmM, p.forearmM, p.weightKg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { session.setCalibration(cal); }, [session, cal]);
  // a new session (new devices, new headings) needs a new calibration
  const forSession = useCalibration((s) => s.forSession);
  useEffect(() => { forSession(code); }, [code, forSession]);
  // changing the phone orientation after calibrating: re-apply the recorded hold
  useEffect(() => {
    if (cal?.phone && cal.phone.axis !== p.phoneAxis) setCal(ArmSession.reapply(cal, p.phoneAxis));
  }, [cal, p.phoneAxis, setCal]);
  return <ArmCtx.Provider value={session}>{children}</ArmCtx.Provider>;
}

export function useArm(): ArmSession {
  const a = useContext(ArmCtx);
  if (!a) throw new Error('useArm outside HubProvider');
  return a;
}

export function useHub(): DeviceHub {
  const h = useContext(Ctx);
  if (!h) throw new Error('useHub outside HubProvider');
  return h;
}

/** Hub status, refreshed a few times a second. */
export function useHubStatus(everyMs = 250): HubStatus {
  const hub = useHub();
  const [s, setS] = useState<HubStatus>(() => hub.status());
  useEffect(() => {
    setS(hub.status());
    const id = setInterval(() => setS(hub.status()), everyMs);
    return () => clearInterval(id);
  }, [hub, everyMs]);
  return s;
}
