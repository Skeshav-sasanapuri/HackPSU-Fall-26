import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { DebugPanel } from './components/DebugPanel';
import { StageLayer } from './components/StageView';
import { SIM } from './flags';
import { HubProvider } from './hubContext';
import { Calibrate } from './pages/Calibrate';
import { Connect } from './pages/Connect';
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

function Shell() {
  const code = useSession((s) => s.code);
  const { pathname } = useLocation();
  const step = pathname.startsWith('/connect') ? 'connect' : pathname.startsWith('/setup') ? 'setup' : pathname.startsWith('/calibrate') ? 'calibrate' : '';
  return (
    <HubProvider>
      <div className="shell">
        <header className="top">
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
