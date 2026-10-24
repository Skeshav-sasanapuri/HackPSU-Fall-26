/* Arm fusion v2: shoulder vs elbow from ONE forearm-worn IMU, without double integration.
   Frame: world, +Y up. Units: m, s, rad.

   Physics: for a rigid forearm rotating about the elbow,
        a_watch = a_elbow + alpha x r + w x (w x r)            (r = elbow -> watch)
   so   a_elbow = a_watch - alpha x r - w x (w x r)            <- measured, drift-free, only noisy
   If the shoulder were stationary, a_elbow = 0 no matter how the forearm moves.
   If the whole arm swung rigidly from the shoulder, a_elbow = q, where
        q = L1 * ( alpha_perp x u + w_perp x (w_perp x u) )    <- predicted from the gyro alone
   Over a short window we regress a_elbow on q (with a free constant offset to absorb gravity-leak):
        a_elbow ~= s * q + b
   s is the "shoulder share" (0 = pure elbow, 1 = whole arm swings from the shoulder).
   Its reliability follows from how much q varies compared with the noise floor, so slow motion
   comes out as "low confidence" instead of a confident wrong answer. */
const V3={
 add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
 mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
 cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
 len:a=>Math.hypot(a[0],a[1],a[2]),
 nrm:(a,f=[0,0,1])=>{const l=Math.hypot(a[0],a[1],a[2]);return l<1e-9?f:[a[0]/l,a[1]/l,a[2]/l]}
};
class Fusion{
 constructor(o={}){
  this.L1=o.L1||.30;        // shoulder -> elbow (m)
  this.Lw=o.Lw||.24;        // elbow -> watch (m)
  this.off=o.off||.025;     // watch sits this far off the forearm axis, along its face normal (m)
  this.noise=o.noise||.35;  // acceleration noise floor (m/s^2); calibrate() replaces it with a measured value
  this.tau=o.tau||.6;       // regression window (s)
  this.phiMax=o.phiMax||2.6;// elbow cannot bend past ~150 deg
  this.delay=o.delay||.6;   // look-back before a rotation is committed (s)
  this.reset([0,0,1]);
 }
 reset(d){
  const u=V3.nrm(d);
  this.u=u;this.uc=u;this.pend=[];this.pt=0;this.t=null;this.buf=[];this.hold=.5;
  this.M={q:[0,0,0],a:[0,0,0],qq:0,aq:0,aa:0,w:0,wp:0,wpar:0,warm:0};
  this.out={mode:'still',conf:1,s:.5,snr:0,u,phi:0,wPerp:0,wPar:0,ae:0,hand:0};
 }
 // measure the acceleration noise floor while the user holds still (call from the calibration hold)
 calibrate(vecs){ // vecs: acceleration residuals (aeVec) recorded while the user held still
  if(vecs.length<30)return;
  const m=[0,1,2].map(k=>vecs.reduce((s,v)=>s+v[k],0)/vecs.length);
  const varSum=vecs.reduce((s,v)=>s+(v[0]-m[0])**2+(v[1]-m[1])**2+(v[2]-m[2])**2,0)/vecs.length;
  this.noise=Math.max(.2,Math.min(.6,3*Math.sqrt(varSum/3)+.2));
 }
 step(t,d,n,w,a){
  const {add,sub,mul,dot,cross,len,nrm}=V3,M=this.M;
  if(this.t==null){this.t=t;this.buf=[[t,w]];return this.out}
  const dt=t-this.t;
  if(dt<=0||dt>.2){this.t=t;this.buf=[[t,w]];this.pend=[];this.pt=0;return this.out}
  this.t=t;
  // angular acceleration: least-squares slope of w over the last ~70 ms
  const B=this.buf;B.push([t,w]);if(B.length>7)B.shift();
  let al=[0,0,0];
  if(B.length>=4){
   const m=B.length;let tm=0,wm=[0,0,0];
   for(const b of B){tm+=b[0];wm=add(wm,b[1])}tm/=m;wm=mul(wm,1/m);
   let sxx=0;const sxy=[0,0,0];
   for(const b of B){const x=b[0]-tm;sxx+=x*x;for(let k=0;k<3;k++)sxy[k]+=x*(b[1][k]-wm[k])}
   al=sxy.map(v=>v/sxx);
  }
  const r=add(mul(d,this.Lw),mul(n,this.off));
  const ae=sub(a,add(cross(al,r),cross(w,cross(w,r))));         // measured elbow acceleration
  // swing (perpendicular to the forearm) vs twist (along it)
  const wpar=dot(w,d),wperp=sub(w,mul(d,wpar));
  const alperp=sub(al,mul(d,dot(al,d)));
  const q=mul(add(cross(alperp,this.u),cross(wperp,cross(wperp,this.u))),this.L1); // predicted if the shoulder swings
  // windowed regression ae ~ s*q + b  (exponentially weighted)
  const k=1-Math.exp(-dt/this.tau);
  for(let i=0;i<3;i++){M.q[i]+=(q[i]-M.q[i])*k;M.a[i]+=(ae[i]-M.a[i])*k}
  const dq=sub(q,M.q),da=sub(ae,M.a);
  M.qq+=(dot(dq,dq)-M.qq)*k;M.aq+=(dot(da,dq)-M.aq)*k;M.aa+=(dot(da,da)-M.aa)*k;
  const kf=1-Math.exp(-dt/.15);
  M.w+=(len(w)-M.w)*kf;M.wp+=(len(wperp)-M.wp)*kf;M.wpar+=(Math.abs(wpar)-M.wpar)*kf;
  // shoulder share and how much to trust it
  const snr=Math.sqrt(Math.max(0,M.qq))/this.noise;               // how far the shoulder prediction rises above the noise
  const s=M.qq>1e-6?M.aq/M.qq:this.hold;
  const conf=Math.max(0,Math.min(1,(snr-.8)/1.6));
  // The upper arm follows the forearm's swing by the shoulder share. Evidence needs ~0.5 s to build up, so recent
  // rotations stay "pending" and are committed later with the better estimate; the display uses the current guess.
  const sc=Math.max(0,Math.min(1,s));
  if(conf>.5)this.hold+=(sc-this.hold)*Math.min(1,dt/.25);
  else this.hold+=(.5-this.hold)*Math.min(1,dt/4);               // drift back to "don't know" slowly
  const sEff=conf>.5?sc:this.hold;
  const turn=(v,wv,sc2)=>{const th=mul(wv,sc2),an=len(th);if(an<1e-9)return v;const ax=mul(th,1/an);
   return nrm(add(add(mul(v,Math.cos(an)),mul(cross(ax,v),Math.sin(an))),mul(ax,dot(ax,v)*(1-Math.cos(an)))),v)};
  this.pend.push([dt,wperp]);this.pt+=dt;
  while(this.pt>this.delay&&this.pend.length){const p=this.pend.shift();this.pt-=p[0];this.uc=turn(this.uc,p[1],sEff*p[0])}
  let u=this.uc;for(const p of this.pend)u=turn(u,p[1],sEff*p[0]);
  // keep the elbow bend anatomically possible
  const c=Math.max(-1,Math.min(1,dot(u,d)));
  if(Math.acos(c)>this.phiMax){const p=nrm(sub(u,mul(d,c)),[0,1,0]);u=add(mul(d,Math.cos(this.phiMax)),mul(p,Math.sin(this.phiMax)))}
  this.u=u;
  // verdict
  let mode;
  if(M.w<.2)mode='still';
  else if(M.wpar>1.5*M.wp&&M.wpar>.3)mode='twist';
  else if(conf<.5)mode='uncertain';
  else mode=s>.7?'shoulder':s<.3?'elbow':'both';
  const hand=len(add(mul(wperp,this.Lw+.05),[0,0,0]))*1; // forearm swing speed proxy (rad/s * m)
  return this.out={mode,conf,s:sc,snr,u,phi:Math.acos(c),wPerp:M.wp,wPar:M.wpar,ae:len(ae),aeVec:ae,hand,sRaw:s};
 }
}
if(typeof module!=='undefined'){module.exports=Fusion;Fusion.V3=V3}
/* Core: packet decoding + a demo sensor that emits exactly what the watch app sends.
   Needs fusion.js (V3, Fusion) loaded first. Plain arrays only, no DOM, so it can be tested in Node.
   World frame = three.js frame (+Y up). The watch app sends Android/ENU values:
     q = game rotation vector [x,y,z,w] (sensor -> ENU world), g = gyro (rad/s), a = accelerometer incl. gravity (m/s^2), both in sensor axes.
   Android (x,y,z) -> three (x,z,-y). */
const G0=9.81,RAD=Math.PI/180;
const toThree=v=>[v[0],v[2],-v[1]], fromThree=v=>[v[0],-v[2],v[1]];
const qrot=(q,v)=>{const x=q[0],y=q[1],z=q[2],w=q[3];
 const t=[2*(y*v[2]-z*v[1]),2*(z*v[0]-x*v[2]),2*(x*v[1]-y*v[0])];
 return [v[0]+w*t[0]+(y*t[2]-z*t[1]),v[1]+w*t[1]+(z*t[0]-x*t[2]),v[2]+w*t[2]+(x*t[1]-y*t[0])]};
const qinv=q=>[-q[0],-q[1],-q[2],q[3]];
const qnorm=q=>{const l=Math.hypot(q[0],q[1],q[2],q[3])||1;return [q[0]/l,q[1]/l,q[2]/l,q[3]/l]};
// forearm axis in the watch's own sensor frame: 3 o'clock side toward the fingers by default (strap runs 12-6, around the wrist)
const AXES={'12':[0,1,0],'3':[1,0,0],'6':[0,-1,0],'9':[-1,0,0]};
function decode(m,ax){
 const q=qnorm([m.q[0],m.q[2],-m.q[1],m.q[3]]);                    // ENU quaternion -> three frame
 const d=V3.nrm(qrot(q,toThree(AXES[ax])));
 let n=qrot(q,[0,1,0]);                                              // watch screen normal (sensor +Z)
 n=V3.nrm(V3.sub(n,V3.mul(d,V3.dot(n,d))),[0,1,0]);
 if(!m.g||!m.a)return {q,d,n,w:null,a:null};
 return {q,d,n,w:qrot(q,toThree(m.g)),a:V3.sub(qrot(q,toThree(m.a)),[0,G0,0])};
}
// 3x3 rotation matrix (row-major) -> quaternion [x,y,z,w]
function qFromMat(m){
 const t=m[0][0]+m[1][1]+m[2][2];let x,y,z,w;
 if(t>0){const s=Math.sqrt(t+1)*2;w=s/4;x=(m[2][1]-m[1][2])/s;y=(m[0][2]-m[2][0])/s;z=(m[1][0]-m[0][1])/s}
 else if(m[0][0]>m[1][1]&&m[0][0]>m[2][2]){const s=Math.sqrt(1+m[0][0]-m[1][1]-m[2][2])*2;w=(m[2][1]-m[1][2])/s;x=s/4;y=(m[0][1]+m[1][0])/s;z=(m[0][2]+m[2][0])/s}
 else if(m[1][1]>m[2][2]){const s=Math.sqrt(1+m[1][1]-m[0][0]-m[2][2])*2;w=(m[0][2]-m[2][0])/s;x=(m[0][1]+m[1][0])/s;y=s/4;z=(m[1][2]+m[2][1])/s}
 else{const s=Math.sqrt(1+m[2][2]-m[0][0]-m[1][1])*2;w=(m[1][0]-m[0][1])/s;x=(m[0][2]+m[2][0])/s;y=(m[1][2]+m[2][1])/s;z=s/4}
 return qnorm([x,y,z,w]);
}
const yawRot=(v,a)=>[v[0]*Math.cos(a)+v[2]*Math.sin(a),v[1],-v[0]*Math.sin(a)+v[2]*Math.cos(a)];

/* ---------- demo: a simulated arm with realistic sensor errors ---------- */
const rotAxis=(v,k,th)=>V3.add(V3.add(V3.mul(v,Math.cos(th)),V3.mul(V3.cross(k,v),Math.sin(th))),V3.mul(k,V3.dot(k,v)*(1-Math.cos(th))));
const raised=(t,T,A)=>A*(1-Math.cos(2*Math.PI*t/T));            // 0 -> 2A -> 0, starts and ends at rest
const DEMO_SEGMENTS=[
 {name:'Shoulder swings',hint:'arm stays straight',dur:3*2.2,pose:t=>{const a=raised(t,2.2,30*RAD);return {u:[0,Math.sin(a),Math.cos(a)],phi:0,tau:0}}},
 {name:'Elbow curls',hint:'shoulder stays put',dur:3*2.2,pose:t=>({u:[0,0,1],phi:raised(t,2.2,45*RAD),tau:0})},
 {name:'Forearm twist',hint:'turning the palm',dur:2*2,pose:t=>({u:[0,0,1],phi:0,tau:raised(t,2,35*RAD)})},
 {name:'Both together',hint:'shoulder + elbow',dur:3*2,pose:t=>{const a=raised(t,2,30*RAD);return {u:[Math.sin(a),0,Math.cos(a)],phi:raised(t,2,26*RAD),tau:0}}},
 {name:'Very slow shoulder swing',hint:'too slow to tell, on purpose',dur:6,pose:t=>{const a=raised(t,6,30*RAD);return {u:[0,Math.sin(a),Math.cos(a)],phi:0,tau:0}}},
];
const PAUSE=1.4;
class Demo{
 constructor(ax,heading=70*RAD,errTilt=1.2*RAD,motionLeak=0,accNoise=.06){
  this.ax=ax;this.heading=heading;this.tilt=errTilt;this.mleak=motionLeak;this.accNoise=accNoise;this.t0=null;this.ph=Math.random()*6.28;
  this.L1=.30;this.Lw=.24;this.off=.025;
  let tot=0;this.starts=DEMO_SEGMENTS.map(s=>{const b=tot;tot+=PAUSE+s.dur;return b});this.total=tot+PAUSE;
 }
 start(t){this.t0=t}
 stop(){this.t0=null}
 where(t){ // -> {seg index or -1, local time}
  if(this.t0==null)return {i:-1,lt:0};
  const c=((t-this.t0-1.5)%this.total+this.total)%this.total; // 1.5 s hold before the first move
  if(t-this.t0<1.5)return {i:-1,lt:0};
  for(let i=DEMO_SEGMENTS.length-1;i>=0;i--){const lt=c-this.starts[i]-PAUSE;if(c>=this.starts[i]+PAUSE&&lt<DEMO_SEGMENTS[i].dur)return {i,lt};}
  return {i:-1,lt:0};
 }
 label(t){const w=this.where(t);return w.i<0?(this.t0==null?'Holding the calibration pose':'Resting'):DEMO_SEGMENTS[w.i].name+' ('+DEMO_SEGMENTS[w.i].hint+')'}
 truth(t){const w=this.where(t);return w.i<0?null:DEMO_SEGMENTS[w.i].name}
 pose(t){const w=this.where(t);return w.i<0?{u:[0,0,1],phi:0,tau:0}:DEMO_SEGMENTS[w.i].pose(w.lt)}
 arm(P){ // world-frame geometry of the arm (before the arbitrary heading)
  const {nrm,cross,add,mul}=V3,u=nrm(P.u),h=nrm(cross(u,[1e-3,1,0]));
  const d=nrm(rotAxis(u,h,-P.phi));let n=nrm(cross(h,d));n=rotAxis(n,d,P.tau);
  return {u,d,n,p:add(add(mul(u,this.L1),mul(d,this.Lw)),mul(n,this.off))};
 }
 omega(t,h=1e-3){
  const f=x=>{const A=this.arm(this.pose(x));return [A.d,V3.cross(A.n,A.d),A.n]}; // columns: forearm axis, sensor-Y, normal
  const A=f(t+h),B=f(t-h),M=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)M[i][j]+=A[k][i]*B[k][j]; // (R1 R2^T)[i][j] = sum_k R1[i][k] R2[j][k], columns stored as vectors
  return [(M[2][1]-M[1][2])/2,(M[0][2]-M[2][0])/2,(M[1][0]-M[0][1])/2].map(v=>v/(2*h));
 }
 linacc(t,h=2e-3){const p=x=>this.arm(this.pose(x)).p,a=p(t+h),b=p(t),c=p(t-h);return [0,1,2].map(i=>(a[i]-2*b[i]+c[i])/(h*h))}
 gauss(){return Math.sqrt(-2*Math.log(Math.random()+1e-12))*Math.cos(2*Math.PI*Math.random())}
 packet(t){
  const P=this.pose(t),A=this.arm(P),rot=v=>yawRot(v,this.heading);
  const d=rot(A.d),n=rot(A.n),w=rot(this.omega(t)),a=rot(this.linacc(t));
  // sensor frame (three-mapped): axis a_s -> d, Z -> n, p_s = Z x a_s -> n x d
  const as=AXES[this.ax],ps=V3.cross([0,0,1],as),nd=V3.cross(n,d);
  const img=e=>V3.add(V3.mul(d,V3.dot(e,as)),V3.add(V3.mul(nd,V3.dot(e,ps)),V3.mul(n,e[2])));
  const cx=img([1,0,0]),cy=img([0,1,0]),cz=n;                      // images of Android sensor axes in the three frame...
  // ...but the page treats sensor vectors through toThree(), so build raw = Img * M^T:
  const Mx=toThree([1,0,0]),My=toThree([0,1,0]),Mz=toThree([0,0,1]);
  const Img=[[cx[0],cy[0],cz[0]],[cx[1],cy[1],cz[1]],[cx[2],cy[2],cz[2]]];
  const Mt=[[Mx[0],My[0],Mz[0]],[Mx[1],My[1],Mz[1]],[Mx[2],My[2],Mz[2]]];          // columns Xm,Ym,Zm  (= M)
  const raw=[0,1,2].map(i=>[0,1,2].map(j=>Img[i][0]*Mt[j][0]+Img[i][1]*Mt[j][1]+Img[i][2]*Mt[j][2])); // Img * M^T
  const qT=qFromMat(raw);                                            // rotation in the three frame
  const qE=[qT[0],-qT[2],qT[1],qT[3]];                               // -> ENU quaternion as the watch would report it
  // sensor readings with realistic errors
  const tl=this.tilt*(1+.5*Math.sin(.9*t)),gl=[Math.cos(this.ph+.4*t),0,Math.sin(this.ph+.4*t)].map(v=>v*G0*tl);
  const aWorld=V3.add(V3.add(V3.add(V3.add(a,[0,G0,0]),gl),[a[0]*this.mleak,0,a[2]*this.mleak]),[0,1,2].map(()=>this.gauss()*this.accNoise));
  const wWorld=V3.add(w,[0,1,2].map(()=>this.gauss()*.01+.004));
  const qi=qinv(qT);
  const g=fromThree(qrot(qi,wWorld)),acc=fromThree(qrot(qi,aWorld));
  // orientation noise (about 0.4 degrees)
  const qn=qnorm([qE[0]+this.gauss()*.003,qE[1]+this.gauss()*.003,qE[2]+this.gauss()*.003,qE[3]]);
  return {t,q:qn,g,a:acc};
 }
}
if(typeof module!=='undefined')module.exports={decode,Demo,DEMO_SEGMENTS,AXES,qrot,qinv,qFromMat,toThree,fromThree,yawRot,G0,RAD};
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
