import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { DebugPanel } from './components/DebugPanel';
import { SensorGuard } from './components/SensorGuard';
import { StageLayer } from './components/StageView';
import { SIM } from './flags';
import { HubProvider } from './hubContext';
import { Calibrate } from './pages/Calibrate';
import { Connect } from './pages/Connect';
import { Customize } from './pages/Customize';
import { Home } from './pages/Home';
import { Bag } from './pages/Bag';
import { History } from './pages/History';
import { Landing } from './pages/Landing';
import { Summary } from './pages/Summary';
import { Lesson } from './pages/Lesson';
import { Train } from './pages/Train';
import { Mirror } from './pages/Mirror';
import { PhonePage } from './pages/PhonePage';
import { Setup } from './pages/Setup';
import { useSession } from './store';

/** Overlay UI scale: everything over the stage shrinks on smaller windows so a screen fits without scrolling. */
function useUiScale() {
  useEffect(() => {
    const set = () => {
      const k = Math.max(0.6, Math.min(1, window.innerWidth / 1500, window.innerHeight / 900));
      document.documentElement.style.setProperty('--ui', k.toFixed(3));
    };
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  }, []);
}

/* The step bar hides above the stage. It slides down when the pointer reaches the top edge or the tab is clicked,
 * and tucks itself away again a few seconds after the pointer leaves. */
function useCurtain() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const closeSoon = (ms = 2200) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), ms); };
  const keep = () => { clearTimeout(timer.current); setOpen(true); };
  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (e.clientY < 14) keep(); };
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); clearTimeout(timer.current); };
  }, []);
  return { open, keep, closeSoon, toggle: () => (open ? setOpen(false) : (keep(), closeSoon(4000))) };
}

function Shell() {
  const code = useSession((s) => s.code);
  const { pathname } = useLocation();
  useUiScale();
  const curtain = useCurtain();
  useEffect(() => { curtain.closeSoon(600); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = pathname.startsWith('/connect') ? 'connect' : pathname.startsWith('/setup') || pathname.startsWith('/customize') ? 'setup' : pathname.startsWith('/calibrate') ? 'calibrate' : '';
  return (
    <HubProvider>
      <div className="shell">
        <button className={`menutab ${curtain.open ? 'hide' : ''}`} onClick={curtain.toggle} aria-label="Menu"><i /><i /><i /></button>
        <header className={`top curtain ${curtain.open ? 'open' : ''}`} onMouseEnter={curtain.keep} onMouseLeave={() => curtain.closeSoon()}>
          <Link to="/" className="mark">JAB<i /></Link>
          <nav className="crumbs" aria-label="Steps">
            <NavLink to="/setup" className={step === 'setup' ? 'on' : ''} style={{ textDecoration: 'none' }}><span className={step === 'setup' ? 'on' : ''}>1 You</span></NavLink>
            <NavLink to="/connect" style={{ textDecoration: 'none' }}><span className={step === 'connect' ? 'on' : ''}>2 Connect</span></NavLink>
            <NavLink to="/calibrate" style={{ textDecoration: 'none' }}><span className={step === 'calibrate' ? 'on' : ''}>3 Calibrate</span></NavLink>
            <NavLink to="/home" style={{ textDecoration: 'none' }}><span className={['/home', '/mirror', '/train', '/bag', '/history', '/summary'].some((r) => pathname.startsWith(r)) ? 'on' : ''}>4 Box</span></NavLink>
          </nav>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {SIM && <span className="simflag">Simulated</span>}
            {code && <span className="ticket">SESSION<b>{code}</b></span>}
          </div>
        </header>
        <div className="stagepage">
          <StageLayer />
          <div className="over"><Outlet /></div>
          <SensorGuard />
        </div>
        <DebugPanel />
      </div>
    </HubProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/p/:session" element={<PhonePage />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/customize" element={<Customize />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/calibrate" element={<Calibrate />} />
        <Route path="/home" element={<Home />} />
        <Route path="/mirror" element={<Mirror />} />
        <Route path="/train" element={<Train />} />
        <Route path="/train/:id" element={<Lesson />} />
        <Route path="/bag" element={<Bag />} />
        <Route path="/history" element={<History />} />
        <Route path="/summary/:id" element={<Summary />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
