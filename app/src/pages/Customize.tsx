import { useEffect } from 'react';
import * as THREE from 'three';
import { useNavigate } from 'react-router-dom';
import { useStageConfig } from '../components/StageView';
import { SKIN_GRADIENT, skinTone } from '../scene/fighter';
import { getStage } from '../scene/stage';
import { useProfile } from '../store';

/* Build your boxer: body, skin tone, glove and shorts colours. The boxer turns slowly so you can see it. */
const SWATCHES = ['#b3261c', '#1f4e8c', '#17130e', '#d4a017', '#ece4d2', '#2f6b3a', '#6b2f8c', '#d8582b'];
const hueHex = (h: number) => '#' + new THREE.Color().setHSL(h / 360, 0.68, 0.42).getHexString();
const hueOf = (hex: string) => { const o = { h: 0, s: 0, l: 0 }; new THREE.Color(hex).getHSL(o); return Math.round(o.h * 360); };

function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="f">
      <span className="lbl">{label}</span>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button key={c} aria-label={c} aria-pressed={c === value} style={{ background: c }} onClick={() => onChange(c)} />
        ))}
      </div>
      <input type="range" className="hue" min={0} max={359} value={hueOf(value)} aria-label={`${label} colour`}
        onChange={(e) => onChange(hueHex(+e.target.value))} />
    </div>
  );
}

export function Customize() {
  const nav = useNavigate();
  const p = useProfile();
  useStageConfig({ shot: 'hero', live: false });

  // slow turntable while on this screen
  useEffect(() => {
    const stage = getStage();
    const off = stage.onFrame((_dt, t) => { stage.boxer.root.rotation.y = Math.sin(t * 0.6) * 0.7; });
    return () => { off(); stage.boxer.root.rotation.y = 0; };
  }, []);

  return (
    <main className="trio-page">
      <h2 className="pagetitle inked">Your boxer</h2>
      <div className="trio">
        <section className="card">
          <header>Body</header>
          <div className="body">
            <div className="f">
              <span className="lbl">Build</span>
              <div className="pick">
                {(['male', 'female'] as const).map((b) => (
                  <button key={b} aria-pressed={p.body === b} onClick={() => p.set({ body: b })}>
                    <svg viewBox="0 0 60 70" aria-hidden fill="currentColor">
                      {b === 'male'
                        ? <path d="M30 4a8 8 0 110 16 8 8 0 010-16zM14 24h32l4 20h-8l-2 22h-8V48h-4v18h-8l-2-22h-8z" />
                        : <path d="M30 4a8 8 0 110 16 8 8 0 010-16zm9 6c5 2 7 7 6 12l-6-4zM18 24h24l3 18h-6l4 12H17l4-12h-6zm6 30h6v12h-6zm6 0h6v12h-6z" />}
                    </svg>
                    <b>{b === 'male' ? 'Male' : 'Female'}</b>
                  </button>
                ))}
              </div>
            </div>
            <div className="f">
              <span className="lbl">Skin tone</span>
              <input type="range" className="skin" min={0} max={1000} value={Math.round(p.skinTone * 1000)} aria-label="Skin tone"
                style={{ background: SKIN_GRADIENT, ['--thumb' as string]: skinTone(p.skinTone) }}
                onChange={(e) => p.set({ skinTone: +e.target.value / 1000 })} />
            </div>
          </div>
        </section>

        <div className="trio-gap" aria-hidden />

        <section className="card">
          <header>Kit</header>
          <div className="body">
            <ColorPick label="Gloves" value={p.gloves} onChange={(c) => p.set({ gloves: c })} />
            <ColorPick label="Shorts" value={p.shorts} onChange={(c) => p.set({ shorts: c })} />
          </div>
        </section>
      </div>
      <div className="trio-foot" style={{ gap: 12 }}>
        <button className="btn small" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={() => nav('/setup')}>← Weigh in</button>
        <button className="btn taped" onClick={() => nav('/connect')}>Connect sensors</button>
      </div>
    </main>
  );
}
