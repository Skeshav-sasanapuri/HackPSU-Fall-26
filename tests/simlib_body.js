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
