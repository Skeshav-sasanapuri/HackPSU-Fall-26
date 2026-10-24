'use strict';
/* Shared by collect.html and live.html (and the Node tests).
   - decodePacket / FeatureStream : turns the watch stream into the exact 19 features the model was trained on (mirror of train/mm.py)
   - GRU                          : the trained model, run in plain JS, one 50 Hz step at a time
   - WatchLink                    : WebSocket to the relay + clock pings
   - Pose helpers                 : MediaPipe loading and the compact per-frame row that is recorded */
const G0=9.81, GRID_MS=20;
const AXES={'12':[0,1,0],'3':[1,0,0],'6':[0,-1,0],'9':[-1,0,0]};
const LM=[0,11,12,13,14,15,16,17,18,19,20,21,22,23,24];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const nrm=v=>{const l=Math.max(Math.hypot(v[0],v[1],v[2]),1e-9);return [v[0]/l,v[1]/l,v[2]/l]};
const qrot=(q,v)=>{const x=q[0],y=q[1],z=q[2],w=q[3];
 const t=[2*(y*v[2]-z*v[1]),2*(z*v[0]-x*v[2]),2*(x*v[1]-y*v[0])];
 return [v[0]+w*t[0]+(y*t[2]-z*t[1]),v[1]+w*t[1]+(z*t[0]-x*t[2]),v[2]+w*t[2]+(x*t[1]-y*t[0])]};
const toThree=v=>[v[0],v[2],-v[1]];
const yawRot=(v,a)=>{const c=Math.cos(a),s=Math.sin(a);return [v[0]*c+v[2]*s,v[1],-v[0]*s+v[2]*c]};
const angDeg=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(nrm(a),nrm(b)))))*180/Math.PI;

function decodePacket(m,axis){
 let q=[m.q[0],m.q[2],-m.q[1],m.q[3]];const l=Math.hypot(q[0],q[1],q[2],q[3]);q=q.map(v=>v/l);
 const D=nrm(qrot(q,toThree(AXES[axis])));
 let n=qrot(q,[0,1,0]);n=nrm(sub(n,mul(D,dot(n,D))));
 return {D,N:n,W:qrot(q,toThree(m.g)),A:sub(qrot(q,toThree(m.a)),[0,G0,0])};
}

// linear interpolation in a time-sorted buffer [{t,v}], clamped at the ends (np.interp semantics)
function interpBuf(buf,t,key){
 const n=buf.length;
 if(t<=buf[0].t)return buf[0][key];
 if(t>=buf[n-1].t)return buf[n-1][key];
 let lo=0,hi=n-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(buf[mid].t<=t)lo=mid;else hi=mid}
 const a=buf[lo],b=buf[hi],f=(t-a.t)/(b.t-a.t);
 const va=a[key],vb=b[key];
 return Array.isArray(va)?va.map((x,i)=>x+(vb[i]-x)*f):va+(vb-va)*f;
}

class FeatureStream{
 constructor(axis,{baro=true,baroFast=.2,baroSlow=15,hpaToM=8.4}={}){
  this.axis=axis;this.yaw=0;this.baro=baro;this.bf=baroFast;this.bs=baroSlow;this.k=hpaToM;
  this.q=[];this.g=[];this.a=[];this.p=[];this.next=null;this.fast=null;this.slow=null;this.nb=0;
 }
 push(m){
  const d=decodePacket(m,this.axis),t=m.t;
  this.q.push({t,D:d.D,N:d.N});this.g.push({t:t+(m.dg||0),v:d.W});this.a.push({t:t+(m.da||0),v:d.A});
  if(this.next==null)this.next=t+(this.start==null?200:this.start);
 }
 pushBaro(tp,p){this.p.push({t:tp,v:p});this.nb++}
 trim(tg){
  for(const b of [this.q,this.g,this.a,this.p]){let i=0;while(i<b.length-2&&b[i+1].t<tg-1500)i++;if(i>0)b.splice(0,i)}
 }
 // emit every grid step that can be computed now; cb(tGrid, Float32Array(19), bad)
 drain(cb){
  while(this.next!=null&&this.q.length>1){
   const tg=this.next,last=(b)=>b[b.length-1].t;
   if(Math.min(last(this.q),last(this.g),last(this.a))<tg)return;
   const useBaro=this.baro&&this.nb>=5;
   if(useBaro&&last(this.p)<tg&&last(this.q)-last(this.p)<150)return;   // wait for the pressure sample unless it went silent
   cb(tg,this.at(tg,useBaro));
   this.next+=GRID_MS;this.trim(tg);
  }
 }
 at(tg,useBaro){
  const y=this.yaw;
  const D=nrm(yawRot(interpBuf(this.q,tg,'D'),y)),N=nrm(yawRot(interpBuf(this.q,tg,'N'),y));
  const W=yawRot(interpBuf(this.g,tg,'v'),y),A=yawRot(interpBuf(this.a,tg,'v'),y);
  let h=0;
  if(useBaro){
   const p=interpBuf(this.p,tg,'v'),dt=GRID_MS/1000,kf=1-Math.exp(-dt/this.bf),ks=1-Math.exp(-dt/this.bs);
   if(this.fast==null){this.fast=this.slow=p}else{this.fast+=(p-this.fast)*kf;this.slow+=(p-this.slow)*ks}
   h=-(this.fast-this.slow)*this.k;
  }
  const C=cross(D,N);
  return Float32Array.from([...D,...N,...W,...A,h,dot(W,D),dot(W,N),dot(W,C),dot(A,D),dot(A,N),dot(A,C)]);
 }
}

class GRU{
 constructor(j){
  const f=a=>Float32Array.from(a.flat());
  this.nf=j.nf;this.H=j.hid;this.scale=Float32Array.from(j.scale);this.hasBaro=j.baro!==false;
  this.inW=f(j.inp_w);this.inB=f(j.inp_b);this.wih=f(j.w_ih);this.whh=f(j.w_hh);this.bih=f(j.b_ih);this.bhh=f(j.b_hh);
  this.h1W=f(j.h1_w);this.h1B=f(j.h1_b);this.oW=f(j.out_w);this.oB=f(j.out_b);
  this.n1=j.inp_b.length;this.n2=j.h1_b.length;this.reset();
 }
 reset(){this.h=new Float32Array(this.H)}
 step(x){
  const {H,n1,n2,nf}=this,z=new Float32Array(n1);
  for(let i=0;i<n1;i++){let s=this.inB[i];const o=i*nf;for(let k=0;k<nf;k++)s+=this.inW[o+k]*(x[k]/this.scale[k]*(k===12&&!this.hasBaro?0:1));z[i]=s>0?s:0}
  const gi=new Float32Array(3*H),gh=new Float32Array(3*H);
  for(let i=0;i<3*H;i++){let s=this.bih[i];const o=i*n1;for(let k=0;k<n1;k++)s+=this.wih[o+k]*z[k];gi[i]=s;
   let t=this.bhh[i];const o2=i*H;for(let k=0;k<H;k++)t+=this.whh[o2+k]*this.h[k];gh[i]=t}
  const sg=v=>1/(1+Math.exp(-v)),nh=new Float32Array(H);
  for(let i=0;i<H;i++){const r=sg(gi[i]+gh[i]),zz=sg(gi[H+i]+gh[H+i]),n=Math.tanh(gi[2*H+i]+r*gh[2*H+i]);nh[i]=(1-zz)*n+zz*this.h[i]}
  this.h=nh;
  const a=new Float32Array(n2);
  for(let i=0;i<n2;i++){let s=this.h1B[i];const o=i*H;for(let k=0;k<H;k++)s+=this.h1W[o+k]*nh[k];a[i]=s>0?s:0}
  const out=[0,0,0];for(let i=0;i<3;i++){let s=this.oB[i];for(let k=0;k<n2;k++)s+=this.oW[i*n2+k]*a[k];out[i]=s}
  return nrm(out);
 }
}

/* WebSocket to the relay.  Collects clock pings: each ping carries the laptop clock; the watch answers with its own clock. */
class WatchLink{
 constructor(url,{onPacket,onPong,onStatus,onOther}={}){
  this.url=url;this.onPacket=onPacket;this.onPong=onPong;this.onStatus=onStatus;this.onOther=onOther;
  this.up=false;this.pid=0;this.pending=new Map();this.count=0;this.hz=0;this._c=0;this._t0=performance.now();
  this.connect();
  setInterval(()=>{const n=performance.now();this.hz=this._c*1000/(n-this._t0);this._c=0;this._t0=n},1000);
  setInterval(()=>this.ping(),1000);
 }
 connect(){
  const ws=this.ws=new WebSocket(this.url);
  ws.onopen=()=>this.onStatus&&this.onStatus({relay:true});
  ws.onclose=()=>{this.onStatus&&this.onStatus({relay:false,watch:false});setTimeout(()=>this.connect(),1000)};
  ws.onmessage=ev=>{
   const now=performance.now();let m;try{m=JSON.parse(ev.data)}catch(e){return}
   if(m.q){this._c++;this.count++;this.onPacket&&this.onPacket(m,now)}
   else if(m.pong!==undefined){const t0=this.pending.get(m.pong);this.pending.delete(m.pong);if(t0!==undefined&&this.onPong)this.onPong({id:m.pong,t0,t1:now,tw:m.tw})}
   else if(m.event==='watch'){this.up=m.up;this.onStatus&&this.onStatus({watch:m.up})}
   else this.onOther&&this.onOther(m,now);
  };
 }
 ping(){
  if(!this.ws||this.ws.readyState!==1||!this.up)return;
  const id=++this.pid,t0=performance.now();this.pending.set(id,t0);
  if(this.pending.size>20)this.pending.delete(this.pending.keys().next().value);
  this.ws.send(JSON.stringify({ping:id,tl:+t0.toFixed(3)}));
 }
 send(o){if(this.ws&&this.ws.readyState===1)this.ws.send(JSON.stringify(o))}
}

/* ---- camera pose (MediaPipe tasks-vision, served from /assets so it works offline) ---- */
async function loadPoseLandmarker(modelFile){
 const mod=await import('/assets/vision_bundle.mjs');
 const fileset=await mod.FilesetResolver.forVisionTasks('/assets/wasm');
 const opts=d=>({baseOptions:{modelAssetPath:'/assets/'+modelFile,delegate:d},runningMode:'VIDEO',numPoses:1,
                 minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});
 let lmk,delegate='GPU';
 try{lmk=await mod.PoseLandmarker.createFromOptions(fileset,opts('GPU'))}catch(e){delegate='CPU';lmk=await mod.PoseLandmarker.createFromOptions(fileset,opts('CPU'))}
 return {lmk,delegate,mod};
}
const r4=v=>Math.round(v*10000)/10000, r3=v=>Math.round(v*1000)/1000;
function poseRow(res,r,ct,mt){
 const w=res.worldLandmarks&&res.worldLandmarks[0],im=res.landmarks&&res.landmarks[0];
 if(!w||!im)return null;
 const row=[+r.toFixed(2),ct==null?-1:+ct.toFixed(2),mt==null?-1:+mt.toFixed(4)];
 for(const k of LM){const a=w[k],b=im[k];row.push(r4(a.x),r4(a.y),r4(a.z),r3(a.visibility==null?1:a.visibility),r4(b.x),r4(b.y))}
 return row;
}
/* Anatomical constraint (mirror of anat.project in train/anat.py): the upper arm u must lie on one side of the plane (d, n)
   (the forearm can only pivot about half a turn relative to the upper arm) and within phiMax of the forearm direction d. */
function projectAnat(u,d,n,s,phiMax=145,slack=12){
 const c=mul(cross(d,n),s),lim=Math.sin(slack*Math.PI/180),e=dot(u,c);
 let v=u;if(e<-lim)v=nrm(sub(u,mul(c,e+lim)));
 const lo=(phiMax+slack)*Math.PI/180,cd=dot(v,d);
 if(Math.acos(Math.max(-1,Math.min(1,cd)))>lo){const perp=nrm(sub(v,mul(d,cd)));v=add(mul(d,Math.cos(lo)),mul(perp,Math.sin(lo)))}
 return v;
}
const feasibleAnat=(u,d,n,s,phiMax=145,slack=12)=>dot(u,mul(cross(d,n),s))>=-Math.sin(slack*Math.PI/180)&&angDeg(u,d)<=phiMax+slack;
/* Learned anatomy constraints (mirror of apply_chain in train/anat.py). Limits come from model.json (measured on the camera data).
   flags: preset (hand-set hinge), bend, side, vbend, vside - each independent. Works in the forearm frame (phi, p):
   phi = bend between upper arm and forearm, p = which way around the forearm the upper arm sits. */
const wrapA=a=>a-2*Math.PI*Math.floor((a+Math.PI)/(2*Math.PI));
class AnatFilter{
 constructor(P){this.P=P||{s:-1,phi_max:145,slack:12,lim:null};this.flags={preset:false,bend:false,side:false,vbend:false,vside:false};
  this.act={preset:0,bend:0,side:0,vbend:0,vside:0};this.prev=null}
 reset(){this.prev=null}
 step(u,d,n,dt=GRID_MS/1000){
  const P=this.P,F=this.flags,L=P.lim,s=P.s,R=Math.PI/180,mark=(k,a,b)=>{this.act[k]+=((angDeg(a,b)>.5?1:0)-this.act[k])*.01};
  const c0=mul(cross(d,n),s);
  if(F.preset){const v=projectAnat(u,d,n,s,P.phi_max,P.slack);mark('preset',u,v);u=v}
  const split=v=>[Math.acos(Math.max(-1,Math.min(1,dot(v,d)))),Math.atan2(dot(v,c0),dot(v,n))];
  const build=(f,p)=>add(mul(d,Math.cos(f)),add(mul(n,Math.sin(f)*Math.cos(p)),mul(c0,Math.sin(f)*Math.sin(p))));
  let [phi,p]=split(u);
  if(L){
   if(F.bend){const f2=Math.min(Math.max(phi,L.phi_lo*R),L.phi_hi*R);if(f2!==phi){const v=build(f2,p);mark('bend',u,v);u=v;phi=f2}else mark('bend',u,u)}
   if(F.side&&!L.p_full){const pc=L.p_c*R,p2=pc+Math.min(Math.max(wrapA(p-pc),-L.p_lo*R),L.p_hi*R);
    const lo=5*R,hi=25*R,t=Math.min(Math.max((phi-lo)/(hi-lo),0),1),w=t*t*(3-2*t),us=build(phi,p2);
    const v=nrm(add(mul(u,1-w),mul(us,w)));mark('side',u,v);u=v;[phi,p]=split(u)}
   if(F.vbend||F.vside){
    [phi,p]=split(u);const A=L.dphi_max*R*dt,B=L.vside_max*R*dt;let f=phi,g=p;
    if(this.prev){const [pf,pg]=this.prev;
     if(F.vbend){const df=f-pf;if(df>A)f=pf+A;else if(df<-A)f=pf-A}
     if(F.vside){const dg=wrapA(g-pg),lp=Math.min(Math.PI,B/Math.max(Math.sin(f),Math.sin(10*R)));if(dg>lp)g=wrapA(pg+lp);else if(dg<-lp)g=wrapA(pg-lp)}}
    this.prev=[f,g];
    const ca=F.vbend?(f!==phi?1:0):0,cb=F.vside?(g!==p?1:0):0;
    this.act.vbend+=(ca-this.act.vbend)*.01;this.act.vside+=(cb-this.act.vside)*.01;
    if(f!==phi||g!==p)u=build(f,g);
   }else this.prev=null
  }
  return u;
 }
}
const SIDE_IDS={left:[11,13,15,17,19,21],right:[12,14,16,18,20,22]};
if(typeof module!=='undefined')module.exports={AnatFilter,projectAnat,feasibleAnat,decodePacket,FeatureStream,GRU,AXES,nrm,yawRot,angDeg,cross,dot,add,sub,mul,LM,GRID_MS};
