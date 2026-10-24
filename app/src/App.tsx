import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { DebugPanel } from './components/DebugPanel';
import { SIM } from './flags';
import { HubProvider } from './hubContext';
import { Connect } from './pages/Connect';
import { Landing } from './pages/Landing';
import { PhonePage } from './pages/PhonePage';
import { Setup } from './pages/Setup';
import { useSession } from './store';

function Shell() {
  const code = useSession((s) => s.code);
  const { pathname } = useLocation();
  const step = pathname.startsWith('/connect') ? 'connect' : pathname.startsWith('/setup') ? 'setup' : '';
  return (
    <HubProvider>
      <div className="shell">
        <header className="top">
          <Link to="/" className="mark">JAB<i /></Link>
          <nav className="crumbs" aria-label="Steps">
            <NavLink to="/setup" className={step === 'setup' ? 'on' : ''} style={{ textDecoration: 'none' }}><span className={step === 'setup' ? 'on' : ''}>1 You</span></NavLink>
            <NavLink to="/connect" style={{ textDecoration: 'none' }}><span className={step === 'connect' ? 'on' : ''}>2 Connect</span></NavLink>
            <span>3 Calibrate</span>
          </nav>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {SIM && <span className="simflag">Simulated</span>}
            {code && <span className="ticket">SESSION<b>{code}</b></span>}
          </div>
        </header>
        <Outlet />
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
        <Route path="/connect" element={<Connect />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
