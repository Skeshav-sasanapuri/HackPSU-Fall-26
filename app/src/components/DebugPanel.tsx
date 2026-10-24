import { DEBUG } from '../flags';
import { useHubStatus } from '../hubContext';
import { getStage } from '../scene/stage';

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
phone    ${s.phone.up ? 'up' : 'down'}  ${s.phone.hz} Hz  delay ${f(s.phone.latencyMs)} ms  rtt ${f(s.phone.rttMs)} ms
watch    ${s.watch.up ? 'up' : 'down'}  ${s.watch.hz} Hz  delay ${f(s.watch.latencyMs)} ms  rtt ${f(s.watch.rttMs)} ms
render   ${getStage().fps.toFixed(0)} fps
battery  ${f(s.watch.battery)} %
activity phone ${s.activity.phone.toFixed(2)}  watch ${s.activity.watch.toFixed(2)}`}
    </div>
  );
}
