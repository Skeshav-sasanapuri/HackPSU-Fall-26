import { useEffect, useState } from 'react';
import { mdToHtml, mySessions, progressReport } from '../ai/gemini';
import { useKeys } from '../ai/keys';
import { useHistory } from '../history';
import { useProfile } from '../store';

/* Gemini progress report over every saved session of this boxer: shown in a panel, downloadable as a page. */
interface Saved { md: string; at: number; model: string; count: number }
const LS = 'jab.report';
const load = (): Saved | null => { try { return JSON.parse(localStorage.getItem(LS) ?? 'null'); } catch { return null; } };

function download(r: Saved, name: string) {
  const title = `Progress report${name ? ` · ${name}` : ''}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font:16px/1.55 Georgia,serif;color:#1b140d;background:#f4ecdc;max-width:760px;margin:40px auto;padding:0 20px}
h1{font:900 40px/1 Impact,'Arial Narrow',sans-serif;letter-spacing:.03em;border-bottom:5px solid #1b140d;padding-bottom:8px}
h2,h3{font:800 22px/1.2 'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#9e2a1e;margin-top:28px}
small{color:#6b5c49}</style></head><body><h1>WATCH HOW U BOX · ${title}</h1>
<small>${new Date(r.at).toLocaleString()} · ${r.count} sessions · written by ${r.model}</small>${mdToHtml(r.md)}</body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `progress-report-${new Date(r.at).toISOString().slice(0, 10)}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ReportButton() {
  const key = useKeys((k) => k.gemini);
  const sessions = useHistory((h) => h.sessions);
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const [rep, setRep] = useState<Saved | null>(load);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mine = mySessions(sessions, profile.name);

  const make = async () => {
    setBusy(true); setErr('');
    try {
      const { md, model } = await progressReport(key, profile, mine);
      const r = { md, model, at: Date.now(), count: mine.length };
      setRep(r);
      try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* full */ }
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => { if (open && !rep && !busy && key && mine.length) void make(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!key) return <span className="hint">Add a Gemini key on Connect for an AI progress report.</span>;
  return (
    <>
      <button className="btn small" disabled={!mine.length} onClick={() => setOpen(true)}>Progress report · Gemini</button>
      {open && (
        <div className="reportwrap" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="report card">
            <header>Progress report<button className="link light" onClick={() => setOpen(false)}>Close ✕</button></header>
            <div className="report-body">
              {busy && <p className="hint">Gemini is reading {mine.length} sessions…</p>}
              {err && <div className="msg">{err}</div>}
              {rep && !busy && (
                <>
                  <small className="hint">{new Date(rep.at).toLocaleString()} · {rep.count} sessions · {rep.model}</small>
                  <div className="report-md" dangerouslySetInnerHTML={{ __html: mdToHtml(rep.md) }} />
                </>
              )}
            </div>
            <div className="report-foot">
              <button className="btn small" disabled={busy} onClick={make}>{rep ? 'Write a new one' : 'Write report'}</button>
              {rep && <button className="btn small" style={{ background: 'var(--paper)', color: 'var(--ink)' }} disabled={busy} onClick={() => download(rep, profile.name)}>Download</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
