import * as THREE from 'three';

/* Hand-painted-looking textures drawn on canvases at startup: no image files to ship. A seeded RNG keeps them stable. */
let seed = 1234;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function tex(c: HTMLCanvasElement, repeat?: [number, number]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

/** sprinkle of grime and paper fibre */
function grime(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha = 0.06) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(30,18,8,${alpha * rnd()})`;
    const r = 2 + rnd() * 18;
    g.beginPath(); g.ellipse(rnd() * w, rnd() * h, r, r * (0.4 + rnd()), rnd() * 3, 0, 7); g.fill();
  }
}

export function woodFloor(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  const tones = ['#7a4f2c', '#6e4526', '#835a33', '#6a4224', '#77502e'];
  const pw = 64;
  for (let x = 0; x < 512; x += pw) {
    let y = -Math.floor(rnd() * 200);
    while (y < 512) {
      const len = 160 + rnd() * 220;
      g.fillStyle = pick(tones);
      g.fillRect(x, y, pw, len);
      g.strokeStyle = 'rgba(40,22,10,.35)'; g.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        g.beginPath(); const gx = x + 6 + rnd() * (pw - 12);
        g.moveTo(gx, y); g.bezierCurveTo(gx + 4, y + len / 3, gx - 4, y + (2 * len) / 3, gx + rnd() * 4, y + len); g.stroke();
      }
      g.fillStyle = '#2a170a'; g.fillRect(x, y + len - 2, pw, 3);
      y += len;
    }
    g.fillStyle = '#2a170a'; g.fillRect(x, 0, 3, 512);
  }
  grime(g, 512, 512, 140, 0.08);
  return tex(c, [6, 6]);
}

export function brickWall(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#4a3528'; g.fillRect(0, 0, 512, 512);
  const bw = 64, bh = 28;
  for (let row = 0; row * bh < 512; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 512 + bw; x += bw) {
      const r = 110 + rnd() * 40, gg = 52 + rnd() * 22, b = 36 + rnd() * 16;
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x + off + 3, row * bh + 3, bw - 6, bh - 6);
      g.fillStyle = 'rgba(255,220,180,.06)'; g.fillRect(x + off + 3, row * bh + 3, bw - 6, 4);
    }
  }
  grime(g, 512, 512, 220, 0.1);
  return tex(c, [4, 2]);
}

export function woodPanel(): THREE.Texture {
  const [c, g] = canvas(512, 256);
  for (let x = 0; x < 512; x += 42) {
    g.fillStyle = pick(['#5b3a20', '#63401f', '#553519']);
    g.fillRect(x, 0, 42, 256);
    g.fillStyle = '#23130a'; g.fillRect(x, 0, 3, 256);
  }
  g.fillStyle = '#3a2412'; g.fillRect(0, 0, 512, 14);
  grime(g, 512, 256, 80, 0.08);
  return tex(c, [4, 1]);
}

export function canvasMat(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#d9c7a3'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(90,60,30,${rnd() * 0.05})`; g.fillRect(rnd() * 512, rnd() * 512, 2, 2); }
  grime(g, 512, 512, 60, 0.07);
  return tex(c, [2, 2]);
}

/** An old fight poster. */
export function poster(title: string, sub: string, accent: string): THREE.Texture {
  const [c, g] = canvas(256, 384);
  g.fillStyle = '#e8d9b5'; g.fillRect(0, 0, 256, 384);
  grime(g, 256, 384, 40, 0.1);
  g.fillStyle = accent; g.fillRect(14, 14, 228, 70);
  g.fillStyle = '#efe6d2';
  g.font = '900 54px "Big Shoulders Display", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(title, 128, 52);
  // two silhouettes squaring up
  g.fillStyle = '#2a1d12';
  for (const [x, flip] of [[80, 1], [176, -1]] as const) {
    g.beginPath(); g.arc(x, 150, 18, 0, 7); g.fill();
    g.beginPath(); g.moveTo(x - 26, 175); g.lineTo(x + 26, 175); g.lineTo(x + 18, 270); g.lineTo(x - 18, 270); g.fill();
    g.beginPath(); g.arc(x + 30 * flip, 180, 13, 0, 7); g.fill();
    g.fillRect(x - 18, 270, 14, 60); g.fillRect(x + 4, 270, 14, 60);
  }
  g.fillStyle = '#2a1d12';
  g.font = '800 30px "Big Shoulders Display", Impact, sans-serif';
  g.fillText(sub, 128, 352);
  // torn, browned edges
  const edge = g.createRadialGradient(128, 192, 120, 128, 192, 240);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(80,45,15,.45)');
  g.fillStyle = edge; g.fillRect(0, 0, 256, 384);
  return tex(c);
}

/** Soft vertical fade for light shafts. */
export function shaftGradient(): THREE.Texture {
  const [c, g] = canvas(4, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,230,180,0.9)'); gr.addColorStop(1, 'rgba(255,230,180,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  return tex(c);
}

/** Round, soft dust mote. */
export function dot(): THREE.Texture {
  const [c, g] = canvas(32, 32);
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return tex(c);
}
