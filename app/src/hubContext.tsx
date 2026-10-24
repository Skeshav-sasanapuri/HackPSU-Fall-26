import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { SIM } from './flags';
import { DeviceHub, HubStatus, RelayHub, SimHub } from './link/hub';
import { ensureSession, useProfile, useSession } from './store';

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
  return <Ctx.Provider value={hub}>{children}</Ctx.Provider>;
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
