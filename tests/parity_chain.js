// AnatFilter (JS) vs apply_chain (Python) on a random sequence, for every on/off combination.
//   python parity_chain.py > cases.json ; node parity_chain.js < cases.json
const S = require('../laptop/shared.js');
const C = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let worst = 0;
for (const cs of C.cases) {
  const f = new S.AnatFilter(C.P);
  Object.assign(f.flags, cs.flags);
  for (let i = 0; i < C.U.length; i++) {
    const o = f.step(C.U[i], C.D[i], C.N[i]);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(o[k] - cs.out[i][k]));
  }
}
console.log('AnatFilter vs apply_chain: max |JS-Python| over', C.cases.length, 'flag combinations =', worst.toExponential(2), worst < 1e-9 ? 'OK' : 'FAIL');
