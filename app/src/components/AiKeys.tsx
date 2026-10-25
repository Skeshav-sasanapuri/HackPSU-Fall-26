import { useState } from 'react';
import { pickModel } from '../ai/gemini';
import { useKeys } from '../ai/keys';

/* Optional Gemini key on the Connect screen. Remembered by this browser until "Forget". */
function KeyField({ label, saved, onSave, onForget, check, placeholder }: {
  label: string; saved: string; placeholder: string;
  onSave: (k: string) => void; onForget: () => void; check: () => Promise<string>;
}) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setNote('Checking…'); const err = await check(); setNote(err || 'Works.'); setBusy(false); };
  return (
    <div className="aikey">
      <b>{label}</b>
      {saved ? (
        <>
          <span className="aikey-saved">Saved in this browser ···{saved.slice(-4)}</span>
          <button className="link" disabled={busy} onClick={run}>Test</button>
          <button className="link" onClick={() => { onForget(); setNote(''); }}>Forget</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); const k = draft.trim(); if (k) { onSave(k); setDraft(''); setNote(''); } }}>
          <input type="password" autoComplete="off" spellCheck={false} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn small" type="submit" disabled={!draft.trim()}>Save</button>
        </form>
      )}
      {note && <span className={`aikey-note ${note === 'Works.' || note === 'Checking…' ? '' : 'bad'}`}>{note}</span>}
    </div>
  );
}

export function AiKeys() {
  const { gemini, set } = useKeys();
  return (
    <section className="aikeys paper">
      <div className="aikeys-head">
        <span className="label">Optional · Gemini reports</span>
        <span className="hint">Not required. Add a Gemini API key for detailed progress reports. It stays in this browser and goes only to Google.</span>
      </div>
      <KeyField label="Gemini" saved={gemini} placeholder="Gemini API key (aistudio.google.com)"
        onSave={(k) => set({ gemini: k })} onForget={() => set({ gemini: '' })}
        check={async () => { try { await pickModel(gemini); return ''; } catch (e) { return (e as Error).message; } }} />
    </section>
  );
}
