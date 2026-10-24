// project(): JS vs Python on random inputs.  node parity_anat.js < cases.json  (cases: [{u,d,n,s,out}])
const S=require('../laptop/shared.js');const cs=JSON.parse(require('fs').readFileSync(0,'utf8'));let w=0,bad=0;
for(const c of cs){const o=S.projectAnat(c.u,c.d,c.n,c.s);for(let k=0;k<3;k++)w=Math.max(w,Math.abs(o[k]-c.out[k]))}
console.log('projectAnat: max |JS-Python| over',cs.length,'cases =',w.toExponential(2),w<1e-9?'OK':'FAIL');
