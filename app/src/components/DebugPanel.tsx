import { DEBUG } from '../flags';
import { useHubStatus } from '../hubContext';

/** Developer numbers, hidden unless ?debug=1. */
export function DebugPanel() {
  if (!DEBUG) return null;
  return <Inner />;
}

function Inner() {
  const s = useHubStatus(500);
  const f = (n: number | null, d = 0) => (n == null ? '-' : n.toFixed(d));
  return (
    <div className="debug">
      {`relay    ${s.relay}${s.sim ? ' (sim)' : ''}
phone    ${s.phone.up ? 'up' : 'down'}  ${s.phone.hz} Hz  age ${f(s.phone.ageMs)} ms
watch    ${s.watch.up ? 'up' : 'down'}  ${s.watch.hz} Hz  age ${f(s.watch.ageMs)} ms
watch rtt ${f(s.watch.rttMs, 1)} ms  clock offset ${f(s.watch.offsetMs, 1)} ms
battery  ${f(s.watch.battery)} %
activity phone ${s.activity.phone.toFixed(2)}  watch ${s.activity.watch.toFixed(2)}`}
    </div>
  );
}
