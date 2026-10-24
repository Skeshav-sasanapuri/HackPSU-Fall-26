// Synthetic session generator: writes a file in exactly the collector's format, with a KNOWN camera lag, clock offset
// and clock drift so the pipeline can be tested against ground truth.   node synth.js out.json seed [lagMs] [useCt]
const fs=require('fs');
const [,, OUT, SEED='1', LAG='70', USECT='0']=process.argv;
let seed=+SEED*7919+13;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const gauss=()=>Math.sqrt(-2*Math.log(rnd()+1e-12))*Math.cos(2*Math.PI*rnd());
const {add,sub,mul,dot,cross,len,nrm}=V3;
const smooth=x=>x<=0?0:x>=1?1:x*x*(3-2*x);
const nl=(a,b,s)=>nrm(add(mul(a,1-s),mul(b,s)));
const DOWN=[0,-1,0],FWD=[0,0,1],SIDE=[1,0,0],BACK=nrm([0,-.3,-1]),ACROSS=nrm([-1,0,.5]);
const REF=nrm([.35,.45,.82]);
class Sim extends Demo{
 constructor(...a){super(...a);this.sched=[];this.build()}
 build(){
  let t=0;const S=this.sched;const add_=(name,dur,fn)=>{S.push({name,t0:t,t1:t+dur,fn});t+=dur};
  add_('rest0',3,()=>({u:DOWN,phi:0,tau:0}));
  add_('sync_start',6,(x)=>{const k=x%2,ph=k<.9?smooth(k/.35)*(1-smooth((k-.5)/.35)):0;return {u:DOWN,phi:1.8*ph,tau:0}});
  add_('calib',6,()=>({u:FWD,phi:0,tau:0}));
  const T=()=>2+rnd()*1.2;const BLK=+(process.env.BLK||26),FREEN=+(process.env.FREEN||3);
  const mk=(name,fn)=>add_(name,BLK,fn);
  const el=(u,name)=>{const Tp=T(),p0=rnd()*6;mk(name,(x)=>({u,phi:1.15*(1-Math.cos(2*Math.PI*x/Tp)),tau:.12*Math.sin(x*1.7+p0)}))};
  const sh=(a,b,name,slow)=>{const Tp=slow?5:T(),p0=rnd()*6;mk(name,(x)=>({u:nl(a,b,.5*(1-Math.cos(2*Math.PI*x/Tp))),phi:.12+.06*Math.sin(x),tau:.12*Math.sin(x*1.3+p0)}))};
  el(DOWN,'elbow_hang');el(FWD,'elbow_forward');el(SIDE,'elbow_side');
  sh(DOWN,FWD,'shoulder_forward');sh(DOWN,SIDE,'shoulder_side');sh(DOWN,BACK,'shoulder_back');sh(DOWN,ACROSS,'shoulder_across');sh(DOWN,FWD,'shoulder_forward_slow',true);
  {const Tp=T(),p0=rnd()*6;mk('both',(x)=>({u:nl(DOWN,FWD,.5*(1-Math.cos(2*Math.PI*x/Tp))),phi:1.0*(1-Math.cos(2*Math.PI*x/(Tp*.8)+p0)),tau:.1*Math.sin(x)}))}
  for(let k=0;k<FREEN;k++){const ph=[1,2,3,4,5,6].map(()=>rnd()*6),fr=[1,2,3,4,5,6].map(()=>.25+rnd()*.5);
   mk('free'+k,(x)=>{const az=1.1*Math.sin(fr[0]*x+ph[0])+.5*Math.sin(fr[1]*1.7*x+ph[1]),el=.9+.8*Math.sin(fr[2]*x+ph[2]);
    const u=nrm([Math.sin(az)*Math.sin(el),-Math.cos(el),Math.cos(az)*Math.sin(el)]);
    return {u,phi:1.1+.9*Math.sin(fr[3]*1.3*x+ph[3]),tau:.4*Math.sin(fr[4]*x+ph[4])}})}
  add_('sync_end',6,(x)=>{const k=x%2,ph=k<.9?smooth(k/.35)*(1-smooth((k-.5)/.35)):0;return {u:DOWN,phi:1.8*ph,tau:0}});
  add_('rest1',2,()=>({u:DOWN,phi:0,tau:0}));
  this.total_=t;
 }
 pose(t){
  let b=this.sched[this.sched.length-1];for(const s of this.sched)if(t>=s.t0&&t<s.t1){b=s;break}
  const x=t-b.t0,P=b.fn(x);
  const rest={u:DOWN,phi:0,tau:0};
  const mode=b.name.startsWith('rest')||b.name.startsWith('sync')?0:1;
  // ramp in/out of every block (calib: ramp in only, then a steady hold)
  const a=b.name==='calib'?smooth(x/1.2):mode?Math.min(smooth(x/1.5),smooth((b.t1-b.t0-x)/1.5)):1;
  return {u:nl(rest.u,P.u,a),phi:rest.phi*(1-a)+P.phi*a,tau:P.tau*a};
 }
 arm(P){ // proper hinge so the forearm always curls toward the front
  const u=nrm(P.u),h=nrm(cross(u,REF));
  const d=nrm(rotAxis(u,h,P.phi));let n=nrm(cross(h,d));n=rotAxis(n,d,P.tau);
  return {u,d,n,p:add(add(mul(u,this.L1),mul(d,this.Lw)),mul(n,this.off))};
 }
}
const LAGMS=+LAG,HEAD=(.3+rnd()*5)*1,sim=new Sim('3',HEAD,1.2*RAD,0,.06);
sim.t0=0;
const DUR=sim.total_,OFFW=1234567.0+Math.floor(rnd()*9e6),DRIFT=18e-6,T0=5000;  // laptop clock starts at 5 s
const watchOf=(Tl)=>Tl+OFFW+(Tl-T0)*DRIFT;
const R3=(a,b)=>a.map((r,i)=>b[0].map((_,j)=>r[0]*b[0][j]+r[1]*b[1][j]+r[2]*b[2][j]));
const Ry=a=>[[Math.cos(a),0,Math.sin(a)],[0,1,0],[-Math.sin(a),0,Math.cos(a)]],Rx=a=>[[1,0,0],[0,Math.cos(a),-Math.sin(a)],[0,Math.sin(a),Math.cos(a)]];
const Rc=R3(Rx(.18+.1*rnd()),Ry(.5+.5*rnd())),FLIP=[[1,0,0],[0,-1,0],[0,0,-1]];
const toCam=v=>{const f=[v[0],-v[1],-v[2]];return Rc.map(r=>r[0]*f[0]+r[1]*f[1]+r[2]*f[2])};
const out={meta:{app:'motion-collector',version:1,session:'sim',side:'left',axis:'3',camera:'sim',strap:'A',pose_model:'sim'},watch:[],baro:[],sync:[],pose:[],hr:[],marks:[]};
// marks
for(const b of sim.sched){const r=T0+b.t0*1000+ (b.name==='calib'?0:0);out.marks.push({r:T0+b.t0*1000,k:'start',name:b.name});out.marks.push({r:T0+b.t1*1000,k:'end',name:b.name})}
// watch stream, 100 Hz
let tl=0;const rr=3;
for(let t=0;t<DUR;t+=.01+ (rnd()-.5)*.0006){
 const p=sim.packet(t),Tl=T0+t*1000,tw=watchOf(Tl);
 if(rnd()<.002){t+=.04}     // occasional short stall
 out.watch.push([+tw.toFixed(3),0,0,...p.q.map(v=>+v.toFixed(6)),...p.g.map(v=>+v.toFixed(5)),...p.a.map(v=>+v.toFixed(4)),+(Tl+4+rnd()*8).toFixed(2)]);
}
// pings each second (some lost, jittery RTT)
for(let k=0;k*1000<DUR*1000-500;k++){
 const t0=T0+250+k*1000,rtt=5+Math.abs(gauss())*3+(rnd()<.15?25*rnd():0),asym=(rnd()-.5)*rtt*.6;
 out.sync.push([k,+t0.toFixed(3),+(t0+rtt).toFixed(3),+watchOf(t0+rtt/2+asym).toFixed(3)]);
}
// pressure 25 Hz
for(let t=0;t<DUR;t+=.04){const P=sim.arm(sim.pose(t)),y=sim.L1*P.u[1]+sim.Lw*P.d[1],Tl=T0+t*1000;
 out.baro.push([+watchOf(Tl).toFixed(3),+(1000-(y)/8.4*1+ .0003*t+gauss()*.012).toFixed(4),+(Tl+6).toFixed(2)])}
// camera 30 fps with jitter, lag, noise, dropouts
const rot=v=>yawRot(v,HEAD);
let nz=Array.from({length:15*3},()=>0);
const truth=[];
for(let t=.2;t<DUR-.2;t+=1/30+(rnd()-.5)*.004){
 const P=sim.arm(sim.pose(t));
 const sh=[0,0,0],el=mul(P.u,sim.L1),wr=add(el,mul(P.d,.26)),idx=add(wr,add(mul(P.d,.07),mul(P.n,.02))),pk=add(wr,add(mul(P.d,.06),mul(P.n,-.025))),th=add(wr,add(mul(P.d,.04),mul(P.n,.03)));
 const L=[[0,.1,0],[0,0,0],[.38,0,0],el,[.38+.1,-.3,0],wr,[.38,-.5,.1],pk,pk,idx,idx,th,th,[.1,-.5,0],[.28,-.5,0]]; // nose,Lsh,Rsh,Lel,Rel,Lwr,Rwr,Lpk,Rpk,Lix,Rix,Lth,Rth,Lhip,Rhip
 // the arm landmarks are in the unrotated frame; the watch world is rotated by HEAD, and so is the camera's view of it
 const row=[];const drop=rnd()<.04;
 const Tl=T0+t*1000;
 row.push(+(Tl+LAGMS+gauss()*2.5).toFixed(2),USECT==='1'?+(Tl+LAGMS+gauss()*1.5).toFixed(2):-1,+(t*1000).toFixed(1));
 for(let i=0;i<15;i++){
  const wv=rot(L[i]);let c=toCam(wv);
  for(let k=0;k<3;k++){nz[i*3+k]=.6*nz[i*3+k]+.8*gauss()*(k===2?.03:.012);c[k]+=nz[i*3+k]}
  const vis=drop&&i>=3&&i<=5?.15:.96;
  row.push(+c[0].toFixed(4),+c[1].toFixed(4),+c[2].toFixed(4),vis,+(.5+c[0]*.3).toFixed(4),+(.5+c[1]*.3).toFixed(4));
 }
 out.pose.push(row);
}
for(let t=0;t<DUR;t+=.02)truth.push([T0+t*1000,...sim.arm(sim.pose(t)).u]);
fs.writeFileSync(OUT,JSON.stringify(out));fs.writeFileSync(OUT.replace(/\.json$/,'.truth.json'),JSON.stringify({lag:LAGMS,offw:OFFW,heading:HEAD,truth}));
console.log('wrote',OUT,'watch',out.watch.length,'pose',out.pose.length,'dur',DUR,'lag',LAGMS,'heading',(HEAD*180/Math.PI).toFixed(1));
