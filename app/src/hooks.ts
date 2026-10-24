import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** R anywhere on a stage screen: recalibrate, then come back here. */
export function useRecalibrateKey() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') nav(`/calibrate?next=${encodeURIComponent(pathname)}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, pathname]);
}
