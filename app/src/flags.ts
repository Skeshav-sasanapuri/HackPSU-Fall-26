/* ?sim=1 feeds the app simulated devices; ?debug=1 shows the developer panel. Remembered for the tab so they survive navigation. */
function flag(name: string): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get(name);
    if (q === '1') sessionStorage.setItem('jab.' + name, '1');
    if (q === '0') sessionStorage.removeItem('jab.' + name);
    return sessionStorage.getItem('jab.' + name) === '1';
  } catch {
    return new URLSearchParams(window.location.search).get(name) === '1';
  }
}
export const SIM = flag('sim');
export const DEBUG = flag('debug');
/** use the three.js Mixamo test characters when no real model is installed */
export const TEST_MODEL = flag('model');
