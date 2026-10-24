// JS vs Python parity: features from the raw recording, and the GRU outputs.   node parity.js session.json cache.json model.json
const fs=require('fs');const S=require('../laptop/shared.js');
const [,, sess, cacheJ, modelJ]=process.argv;
const j=JSON.parse(fs.readFileSync(sess)),c=JSON.parse(fs.readFileSync(cacheJ)),model=JSON.parse(fs.readFileSync(modelJ));
const fsx=new S.FeatureStream(j.meta.axis||'3');fsx.yaw=c.yaw;
const ev=[];for(const r of j.watch)ev.push({t:r[0],k:'w',r});for(const r of j.baro)ev.push({t:r[0],k:'b',r});ev.sort((a,b)=>a.t-b.t);
let started=false;const out=[],N=c.F.length;
for(const e of ev){
 if(e.k==='w'){const r=e.r;fsx.push({t:r[0],dg:r[1],da:r[2],q:[r[3],r[4],r[5],r[6]],g:[r[7],r[8],r[9]],a:[r[10],r[11],r[12]]});
  if(!started){fsx.next=c.T[0];started=true}}
 else fsx.pushBaro(e.r[0],e.r[1]);
 fsx.drain((tg,x)=>{if(out.length<N)out.push({tg,x})});
 if(out.length>=N)break;
}
let worst=new Array(19).fill(0),tdiff=0;
for(let i=0;i<out.length;i++){tdiff=Math.max(tdiff,Math.abs(out[i].tg-c.T[i]));for(let k=0;k<19;k++)worst[k]=Math.max(worst[k],Math.abs(out[i].x[k]-c.F[i][k]))}
console.log('steps compared',out.length,'max grid-time diff',tdiff.toFixed(6),'ms');
console.log('max |JS-Python| per feature:',worst.map(v=>v.toExponential(1)).join(' '));
const g=new S.GRU(model);let w2=0;
for(let i=0;i<model.parity.X.length;i++){const y=g.step(model.parity.X[i]);for(let k=0;k<3;k++)w2=Math.max(w2,Math.abs(y[k]-model.parity.Y[i][k]))}
console.log('GRU max |JS-PyTorch| on',model.parity.X.length,'steps:',w2.toExponential(2));
console.log((Math.max(...worst)<2e-3&&w2<2e-3)?'PARITY OK':'PARITY FAIL');
