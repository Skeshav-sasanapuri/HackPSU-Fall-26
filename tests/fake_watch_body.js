// Pretends to be the Collector watch app: same packets, own clock, answers pings, plus {"truth"} for the simulated camera.
const URL=process.argv[2]||'ws://localhost:8770/ws?role=watch',HEAD=1.9,OFFW=77123456.5;
const sim=new Sim('3',HEAD,1.2*RAD,0,.06),wnow=()=>performance.now()+OFFW;
const ws=new WebSocket(URL);let started=false,tStart=0,nextWall=0,nextP=0,nextTr=0,nextHr=0,hr=68;
const rot=v=>yawRot(v,HEAD),f=v=>v.map(x=>+x.toFixed(5));
ws.onmessage=ev=>{const m=JSON.parse(ev.data);
 if(m.ping!==undefined)ws.send(JSON.stringify({pong:m.ping,tl:m.tl,tw:+wnow().toFixed(3)}));
 if(m.cmd==='sim_start'){started=true;tStart=performance.now();console.log('sim started')}};
ws.onopen=()=>{console.log('fake watch connected');nextWall=performance.now();ws.send(JSON.stringify({bat:88}));
 setInterval(()=>{
  const now=performance.now();
  while(nextWall<=now){
   const st=started?+(process.env.FAKE_T0||0)+Math.max(0,(nextWall-tStart)/1000):0,p=sim.packet(st);
   ws.send(JSON.stringify({t:+(nextWall+OFFW).toFixed(3),dg:0,da:0,q:p.q,g:p.g,a:p.a}));
   if(nextWall>=nextP){nextP=nextWall+40;const A=sim.arm(sim.pose(st));const y=sim.L1*A.u[1]+sim.Lw*A.d[1];
    ws.send(JSON.stringify({p:+(1000-y/8.4+Math.random()*.02).toFixed(4),tp:+(nextWall+OFFW).toFixed(3)}))}
   if(nextWall>=nextTr){nextTr=nextWall+33;const A=sim.arm(sim.pose(st));ws.send(JSON.stringify({truth:{u:f(rot(A.u)),d:f(rot(A.d)),n:f(rot(A.n))}}))}
   if(nextWall>=nextHr){nextHr=nextWall+1000;hr+=(Math.random()-.5)*2;ws.send(JSON.stringify({hr:Math.round(hr),acc:3}))}
   nextWall+=10;
  }
 },8);
};
ws.onclose=()=>process.exit(0);
setTimeout(()=>process.exit(0),+(process.env.LIFE||300000));
