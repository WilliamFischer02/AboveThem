/**
 * Tap-only inputs the feature cards need when screen reading is off:
 *  - MyTasksPicker: my task list (normally OCR'd from the top-left) → the existing `myTasks` event.
 *  - RoomChips: "I am in …" → a myRoom observation (same as the my-room hotkey / card menu).
 */
import { useState } from 'react';
import type { MyTask } from '../../../types/game';
import { useMatch } from '../../../state/store';
import { roomName } from '../../../engine/features/util';

export function MyTasksPicker({ onDone }: { onDone?: () => void }) {
  const m = useMatch(s => s.match);
  const dispatch = useMatch(s => s.dispatch);
  const showToast = useMatch(s => s.showToast);
  const [sel, setSel] = useState<Set<string>>(() => new Set((m?.myTasks ?? []).filter(t => t.matched).map(t => t.id)));
  if (!m) return null;
  if (m.map.tasks.length === 0) return <div className="feat-sub">No task data for {m.map.name}.</div>;
  const order = { common: 0, long: 1, short: 2 } as const;
  const tasks = [...m.map.tasks].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  const save = () => {
    const list: MyTask[] = tasks.filter(t => sel.has(t.id)).map(t => ({ id: t.id, name: t.name, matched: true, room: t.rooms.length === 1 ? t.rooms[0] : undefined }));
    dispatch({ kind: 'myTasks', payload: list });
    showToast(`My tasks: ${list.length} set by hand`, true);
    onDone?.();
  };
  return (
    <div>
      <div className="feat-sub" style={{ marginBottom: 3 }}>Tap the tasks on your list (commons first), then save. Screen reading overwrites this when it works.</div>
      <div className="feat-grid">
        {tasks.map(t => (
          <div key={t.id} className={`feat-tap ${sel.has(t.id) ? 'on' : ''}`} title={`${t.kind}${t.visual ? ', visual' : ''} · ${t.rooms.map(r => roomName(m, r)).join(' / ')}`}
            onClick={() => setSel(s => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
            {t.kind === 'common' ? '◆ ' : ''}{t.name}
          </div>
        ))}
      </div>
      <div className="feat-row" style={{ marginTop: 5 }}>
        <button className="btn sm primary" onClick={save} disabled={sel.size === 0}>Save my tasks ({sel.size})</button>
      </div>
    </div>
  );
}

export function RoomChips({ label = 'I am in:' }: { label?: string }) {
  const m = useMatch(s => s.match);
  const observe = useMatch(s => s.observe);
  if (!m || m.map.rooms.length === 0) return null;
  return (
    <div>
      <div className="feat-sub" style={{ margin: '3px 0' }}>{label}</div>
      <div className="feat-grid">
        {m.map.rooms.map(r => <div key={r.id} className="feat-tap" onClick={() => observe({ type: 'myRoom', room: r.id }, `Me → ${r.name}`)}>{r.name}</div>)}
      </div>
    </div>
  );
}
