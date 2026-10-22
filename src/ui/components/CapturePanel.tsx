/**
 * Capture + OCR panel (Phase 2 dev surface): start/stop Windows Graphics Capture
 * of the game window, preview the latest frame, run OCR on a named region, read
 * the vote grid into roster entries. Everything here is pull-based so it can't
 * stall the game: the capture thread keeps only the latest frame.
 */
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../../state/persist';
import { Crewmate } from './Crewmate';
import { OCR_INSTALL_STEPS } from '../../input/eventHelpers';
import type { PlayerColor } from '../../types/game';

interface CaptureStatus { running: boolean; title: string | null; width: number; height: number; seq: number; age_ms: number }
interface OcrLine { text: string; x: number; y: number; w: number; h: number }
interface OcrRes { rect: { x: number; y: number; w: number; h: number }; frame_seq: number; frame_age_ms: number; ocr_ms: number; lang: string | null; lines: OcrLine[] }
export interface RosterEntry { index: number; name: string; name_confidence: number; color: string; color_delta_e: number; dead: boolean; reporter: boolean }
interface RosterRead { entries: RosterEntry[]; ocr_ms: number }

const REGIONS = ['task_list', 'task_bar', 'role_card', 'chat_panel', 'chat_input', 'lobby_settings', 'lobby_code', 'map_name', 'vote_grid', 'meeting_header', 'eject_text', 'voting_timer', 'sabotage_banner'];

async function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export function CapturePanel({ onRoster, knownNames }: { onRoster?: (entries: RosterEntry[]) => void; knownNames?: string[] }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [region, setRegion] = useState('vote_grid');
  const [ocr, setOcr] = useState<OcrRes | null>(null);
  const [roster, setRoster] = useState<RosterRead | null>(null);
  const [langs, setLangs] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try { setStatus(await inv<CaptureStatus>('capture_status')); } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    refresh();
    inv<string[]>('ocr_languages').then(setLangs).catch(() => {});
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!showPreview || !isTauri()) return;
    let stop = false;
    const tick = async () => {
      try { const b64 = await inv<string>('capture_frame_png', { maxWidth: 640 }); if (!stop) setPreview(`data:image/png;base64,${b64}`); } catch { /* no frame yet */ }
      if (!stop) setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [showPreview]);

  const start = async () => { setError(null); try { setStatus(await inv<CaptureStatus>('capture_start', { title: 'Among Us', minIntervalMs: 250 })); } catch (e) { setError(String(e)); } };
  const stop = async () => { try { setStatus(await inv<CaptureStatus>('capture_stop')); } catch (e) { setError(String(e)); } };
  const runOcr = async () => { setError(null); try { setOcr(await inv<OcrRes>('ocr_region', { req: { region, scale: 2 } })); } catch (e) { setError(String(e)); } };
  const readRoster = async () => { setError(null); try { setRoster(await inv<RosterRead>('read_roster', { knownNames: knownNames ?? [] })); } catch (e) { setError(String(e)); } };

  if (!isTauri()) return <section className="panel"><h3>Capture</h3><div className="muted small">Needs the Tauri window.</div></section>;

  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3>Capture (screen → OCR)</h3>
        <span className="muted small right">OCR langs: {langs.join(', ') || '…'}</span>
      </div>
      <div className="row">
        {!status?.running
          ? <button className="btn sm primary" onClick={start}>Start capture</button>
          : <button className="btn sm danger" onClick={stop}>Stop capture</button>}
        <span className={status?.running ? 'status-ok' : 'muted small'}>
          {status?.running ? `${status.title} · ${status.width}×${status.height} · frame #${status.seq} · ${status.age_ms} ms old` : 'not capturing'}
        </span>
        <button className="btn xs ghost right" onClick={() => setShowPreview(p => !p)}>{showPreview ? 'hide preview' : 'preview'}</button>
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        Chat OCR reads: <b>{langs.length ? langs.join(', ') : '…'}</b>
        {langs.length > 0 && !langs.some(l => /^ru/i.test(l)) && <> — Russian / Cyrillic chat shows as "can't read".</>}
        <div>To read another language: {OCR_INSTALL_STEPS}</div>
      </div>
      {error && <div className="status-err" style={{ marginTop: 4 }}>{error}</div>}
      {showPreview && preview && <img src={preview} alt="latest frame" style={{ width: '100%', marginTop: 6, border: '2px solid var(--ink)', borderRadius: 8 }} />}

      <div className="row" style={{ marginTop: 8 }}>
        <select className="input" value={region} onChange={e => setRegion(e.target.value)}>
          {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn sm" onClick={runOcr} disabled={!status?.running}>OCR region</button>
        <button className="btn sm" onClick={readRoster} disabled={!status?.running}>Read vote grid</button>
      </div>
      {ocr && (
        <div className="col small" style={{ marginTop: 6, gap: 2 }}>
          <span className="muted">{ocr.lines.length} lines · {ocr.ocr_ms} ms · frame #{ocr.frame_seq} ({ocr.frame_age_ms} ms old) · {ocr.lang}</span>
          {ocr.lines.map((l, i) => <div key={i} className="tl"><span className="t">{l.x},{l.y}</span><span>{l.text}</span><span /></div>)}
          {ocr.lines.length === 0 && <span className="muted">nothing recognised in {region}</span>}
        </div>
      )}
      {roster && (
        <div className="col" style={{ marginTop: 6, gap: 3 }}>
          <span className="muted small">{roster.entries.length} players · {roster.ocr_ms} ms</span>
          <div className="roster">
            {roster.entries.map(e => (
              <div key={e.index} className={`chip ${e.dead ? 'dead' : ''}`} style={{ cursor: 'default' }}>
                <Crewmate color={(e.color === 'unknown' ? 'unknown' : e.color) as PlayerColor} size={40} state={e.dead ? 'dead' : 'alive'} />
                <div style={{ minWidth: 0 }}>
                  <div className="name">{e.name}{e.reporter ? ' 📣' : ''}</div>
                  <div className="meta"><span>{e.color} ΔE {e.color_delta_e.toFixed(0)}</span><span>{Math.round(e.name_confidence * 100)}%</span></div>
                </div>
              </div>
            ))}
          </div>
          {onRoster && roster.entries.length > 0 && <button className="btn sm primary" onClick={() => onRoster(roster.entries)}>Use as lobby roster</button>}
        </div>
      )}
    </section>
  );
}
