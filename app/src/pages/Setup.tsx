import { useNavigate } from 'react-router-dom';
import { NumField } from '../components/NumField';
import { useStageConfig } from '../components/StageView';
import { armFromHeight, cmToFtIn, ftInToCm, kgToLb, lbToKg } from '../core/body';
import { armLengths, useProfile } from '../store';

const cm = (m: number) => Math.round(m * 1000) / 10;

export function Setup() {
  const nav = useNavigate();
  const p = useProfile();
  const imperial = p.units === 'imperial';
  const { ft, inch } = cmToFtIn(p.heightCm);
  const est = armFromHeight(p.heightCm / 100);
  const lengths = armLengths(p);
  const inUnits = (m: number) => (imperial ? m * 39.3701 : m * 100);
  const fromUnits = (v: number) => (imperial ? v / 39.3701 : v / 100);
  const u = imperial ? 'in' : 'cm';
  useStageConfig({ shot: 'hero', live: false });

  return (
    <main className="trio-page">
      <h2 className="pagetitle inked">Weigh in</h2>

      <div className="trio">
        <section className="card">
          <header>The boxer</header>
          <div className="body">
            <label className="f">
              <span>Name</span>
              <input className="field" value={p.name} maxLength={24} placeholder="Your name" onChange={(e) => p.set({ name: e.target.value })} />
            </label>

            <div className="f">
              <span className="lbl">Units</span>
              <div className="seg" role="group" aria-label="Units">
                <button aria-pressed={imperial} onClick={() => p.set({ units: 'imperial' })}>ft / lb</button>
                <button aria-pressed={!imperial} onClick={() => p.set({ units: 'metric' })}>cm / kg</button>
              </div>
            </div>

            <div className="row">
              <div className="f">
                <span className="lbl">Height</span>
                {imperial ? (
                  <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                    <NumField label="Feet" value={ft} min={3} max={7} onChange={(v) => p.set({ heightCm: ftInToCm(v, inch) })} />
                    <span className="unit">ft</span>
                    <NumField label="Inches" value={inch} min={0} max={11} onChange={(v) => p.set({ heightCm: ftInToCm(ft, v) })} />
                    <span className="unit">in</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline' }}>
                    <NumField label="Height in centimetres" value={Math.round(p.heightCm)} min={120} max={230} onChange={(v) => p.set({ heightCm: v })} />
                    <span className="unit">cm</span>
                  </div>
                )}
              </div>
              <div className="f">
                <span className="lbl">Weight</span>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  {imperial ? (
                    <NumField label="Weight in pounds" value={Math.round(kgToLb(p.weightKg))} min={70} max={450} onChange={(v) => p.set({ weightKg: lbToKg(v) })} />
                  ) : (
                    <NumField label="Weight in kilograms" value={Math.round(p.weightKg)} min={35} max={200} onChange={(v) => p.set({ weightKg: v })} />
                  )}
                  <span className="unit">{imperial ? 'lb' : 'kg'}</span>
                </div>
              </div>
            </div>

            <div className="f" style={{ marginTop: 6 }}>
              <span className="lbl">Lead arm</span>
              <div className="seg" role="group" aria-label="Lead arm">
                <button aria-pressed={p.lead === 'left'} onClick={() => p.set({ lead: 'left' })}>Left (orthodox)</button>
                <button aria-pressed={p.lead === 'right'} onClick={() => p.set({ lead: 'right' })}>Right (southpaw)</button>
              </div>
              <p className="hint">Wear the watch on this wrist and the phone on this bicep.</p>
            </div>
          </div>
        </section>

        <div className="trio-gap" aria-hidden />
        <section className="card">
          <header>Your reach</header>
          <div className="body">
            <p style={{ marginBottom: 18 }}>Estimated from your height. Measure yourself and correct them if you like; the punch speed gets more accurate.</p>
            <div className="row">
              <div className="f">
                <span className="lbl">Upper arm</span>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <NumField label={`Upper arm in ${u}`} value={inUnits(lengths.upperArm)} digits={1} min={inUnits(0.2)} max={inUnits(0.5)} onChange={(v) => p.set({ upperArmM: fromUnits(v) })} />
                  <span className="unit">{u}</span>
                </div>
                <p className="hint">Shoulder to elbow. {p.upperArmM == null ? `Estimated (${cm(est.upperArm)} cm).` : <button className="link" onClick={() => p.set({ upperArmM: null })}>Use estimate</button>}</p>
              </div>
              <div className="f">
                <span className="lbl">Forearm</span>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <NumField label={`Forearm in ${u}`} value={inUnits(lengths.forearm)} digits={1} min={inUnits(0.15)} max={inUnits(0.4)} onChange={(v) => p.set({ forearmM: fromUnits(v) })} />
                  <span className="unit">{u}</span>
                </div>
                <p className="hint">Elbow to wrist. {p.forearmM == null ? `Estimated (${cm(est.forearm)} cm).` : <button className="link" onClick={() => p.set({ forearmM: null })}>Use estimate</button>}</p>
              </div>
            </div>
            <hr className="rule thin" />
            <p className="hint" style={{ margin: 0 }}>Weight feeds the power estimate, which is always shown as an estimate (est.), never a measurement.</p>
          </div>
        </section>
      </div>

      <div className="trio-foot">
        <button className="btn taped" onClick={() => { p.set({ done: true }); nav('/connect'); }}>Connect sensors</button>
      </div>
    </main>
  );
}
