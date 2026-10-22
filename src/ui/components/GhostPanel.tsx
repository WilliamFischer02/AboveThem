/**
 * Ghost mode — shown when *I* am dead. Dead players can't talk or vote, so the
 * UI collapses to the two things that still matter:
 *   1. Who killed me (one click; it's hard evidence for the suspect ranking).
 *   2. If this lobby's role lets ghosts send images to the living: which of the
 *      randomised icons best signals the killer. The helper reads the live frame,
 *      splits a region into a grid, finds each cell's dominant colour and ranks
 *      cells by closeness to the killer's colour.
 *
 * UNVERIFIED: the image-send panel has not been captured yet, so the region and
 * grid are user-adjustable presets rather than fixed ROIs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatch } from '../../state/store';
import { isTauri } from '../../state/persist';
import { Crewmate, PlayerIcon } from './Crewmate';
import { PALETTE, swatch } from '../palette';
import type { Player, PlayerColor } from '../../types/game';
import { myRoomNow, roomName, slotOrder } from '../../input/useHotkeys';

const PRESETS: Record<string, { x: number; y: number; w: number; h: number }> = {
  centre: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  bottom: { x: 0.1, y: 0.55, w: 0.8, h: 0.4 },
  full: { x: 0, y: 0, w: 1, h: 1 },
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function dirDist(a: [number, number, number], b: [number, number, number]): number {
  const na = Math.max(...a, 1), nb = Math.max(...b, 1);
  const da = a.map(v => v / na), db = b.map(v => v / nb);
  const sa = (na - Math.min(...a)) / na, sb = (nb - Math.min(...b)) / nb;
  return Math.hypot(da[0] - db[0], da[1] - db[1], da[2] - db[2]) * 100 + Math.abs(sa - sb) * 30;
}

export function GhostPanel() {
  const match = useMatch(s => s.match)!;
  const observe = useMatch(s => s.observe);
  const dispatch = useMatch(s => s.dispatch);
  const showToast = useMatch(s => s.showToast);
  const me = match.players[match.me];
  const notDead = () => {
    dispatch({ kind: 'player', payload: { id: match.me, status: 'alive', aliveLockMeeting: match.phase.meeting ?? 0 } });
    showToast('Back to alive — death reads ignored until the next meeting', true);
  };
  const killObs = [...match.observations].reverse().find(o => o.type === 'sawKill' && o.victim === match.me);
  const killer: Player | undefined = killObs && killObs.type === 'sawKill' ? match.players[killObs.killer] : undefined;
  const alive = slotOrder(match).map(id => match.players[id]).filter(p => p.status === 'alive' && !p.isMe);
  const here = myRoomNow(match) ?? 'unknown'; // never invent a room (was rooms[0]); 'unknown' fails soft in the engine

  return (
    <section className="panel ghost">
      <div className="ghost-head">
        <Crewmate color={me?.color ?? 'unknown'} size={30} state="dead" />
        <div className="grow">
          <div className="ghost-title">👻 You're a ghost</div>
          <div className="muted small">Finish your tasks — that still wins it for the crew.</div>
        </div>
        <button className="btn xs ghost" onClick={notDead} title="The screen read was wrong: mark me alive">I'm alive</button>
      </div>
      {!killer ? (
        <>
          <div className="menu-sec">Who killed you? (one tap — hard evidence)</div>
          <div className="gone-strip pick">
            {alive.map(p => (
              <button key={p.id} className="gone-chip big" onClick={() => observe({ type: 'sawKill', killer: p.id, victim: match.me, room: here }, `${p.name} killed you in ${roomName(match, here)}`)}>
                <PlayerIcon id={p.id} color={p.color} size={30} />
                <span className="n">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="ghost-killer">
            <span className="badge imp">KILLER</span>
            <PlayerIcon id={killer.id} color={killer.color} size={36} />
            <span className="nm">{killer.name}</span>
            <span className="muted small">{PALETTE[killer.color as keyof typeof PALETTE]?.label ?? killer.color}</span>
          </div>
          <SignalHelper killerColor={killer.color} />
        </>
      )}
    </section>
  );
}

interface CellScore { col: number; row: number; rgb: [number, number, number]; dist: number }

function SignalHelper({ killerColor }: { killerColor: PlayerColor }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<keyof typeof PRESETS>('centre');
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(2);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [cells, setCells] = useState<CellScore[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useMemo(() => hexToRgb(swatch(killerColor).body), [killerColor]);

  // Pull the live frame every 2 s while open.
  useEffect(() => {
    if (!open || !isTauri()) return;
    let stop = false;
    const tick = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const b64 = await invoke<string>('capture_frame_png', { maxWidth: 960 });
        const im = new Image();
        im.onload = () => { if (!stop) setImg(im); };
        im.src = `data:image/png;base64,${b64}`;
      } catch { /* no frame */ }
      if (!stop) setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [open]);

  // Analyse the grid: dominant saturated colour per cell.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!img || !cv) return;
    const r = PRESETS[preset];
    const sx = Math.floor(img.width * r.x), sy = Math.floor(img.height * r.y), sw = Math.floor(img.width * r.w), sh = Math.floor(img.height * r.h);
    cv.width = sw; cv.height = sh;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const out: CellScore[] = [];
    const cw = sw / cols, ch = sh / rows;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      let best: { rgb: [number, number, number]; n: number } | null = null;
      const buckets = new Map<string, { rgb: [number, number, number]; n: number }>();
      for (let y = Math.floor(row * ch); y < Math.floor((row + 1) * ch); y += 2) for (let x = Math.floor(col * cw); x < Math.floor((col + 1) * cw); x += 2) {
        const i = (y * sw + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        if (mx < 50 || mx - mn < 40) continue; // skip dark / grey
        const k = `${R >> 5},${G >> 5},${B >> 5}`;
        const b = buckets.get(k) ?? { rgb: [R, G, B], n: 0 };
        b.n++; buckets.set(k, b);
        if (!best || b.n > best.n) best = b;
      }
      if (best) out.push({ col, row, rgb: best.rgb, dist: dirDist(best.rgb, target) });
    }
    out.sort((a, b) => a.dist - b.dist);
    setCells(out);
    // Draw grid + ranking
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    for (let i = 1; i < cols; i++) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, sh); ctx.stroke(); }
    for (let i = 1; i < rows; i++) { ctx.beginPath(); ctx.moveTo(0, i * ch); ctx.lineTo(sw, i * ch); ctx.stroke(); }
    out.slice(0, 3).forEach((c, i) => {
      ctx.strokeStyle = i === 0 ? '#3fe0c0' : '#f5b54b'; ctx.lineWidth = i === 0 ? 6 : 3;
      ctx.strokeRect(c.col * cw + 3, c.row * ch + 3, cw - 6, ch - 6);
      ctx.fillStyle = '#000'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(String(i + 1), c.col * cw + 10, c.row * ch + 28);
    });
  }, [img, preset, cols, rows, target]);

  return (
    <div className="col">
      <div className="row">
        <button className={`btn sm ${open ? 'primary' : ''}`} onClick={() => setOpen(o => !o)}>{open ? 'Signal helper on' : 'Signal helper (image role)'}</button>

      </div>
      {open && (
        <>
          <div className="row">
            <label className="field">region<select className="input" value={preset} onChange={e => setPreset(e.target.value as keyof typeof PRESETS)}>{Object.keys(PRESETS).map(k => <option key={k} value={k}>{k}</option>)}</select></label>
            <label className="field">cols<input className="input" type="number" min={1} max={8} style={{ width: 56 }} value={cols} onChange={e => setCols(+e.target.value || 1)} /></label>
            <label className="field">rows<input className="input" type="number" min={1} max={6} style={{ width: 56 }} value={rows} onChange={e => setRows(+e.target.value || 1)} /></label>
          </div>
          <canvas ref={canvasRef} style={{ width: '100%', border: '3px solid #1a1d23', borderRadius: 10, background: '#000' }} />
          {cells.length > 0 && (
            <div className="row small">
              {cells.slice(0, 3).map((c, i) => (
                <span key={i} className="badge" style={{ background: `rgb(${c.rgb.join(',')})`, color: '#000' }}>#{i + 1}: col {c.col + 1}, row {c.row + 1}</span>
              ))}
              <span className="muted">1 = closest to the killer's colour. UNVERIFIED until the image panel is calibrated.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
