/** Main-window side: show/hide the overlay window and keep it fed with snapshots. */
import { useCallback, useEffect, useState } from 'react';
import { useMatch } from '../../state/store';
import { isTauri } from '../../state/persist';
import { buildSnapshot } from './snapshot';

const PREFIX = 'Ctrl+Alt';

export function useOverlay(pending: string | null) {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Push a snapshot on every relevant change.
  useEffect(() => {
    if (!isTauri()) return;
    let emitFn: ((event: string, payload: unknown) => Promise<void>) | null = null;
    let disposed = false;
    import('@tauri-apps/api/event').then(({ emit }) => { if (!disposed) { emitFn = emit; push(); } });
    const push = () => {
      const s = useMatch.getState();
      if (!s.match || !emitFn) return;
      emitFn('overlay://state', buildSnapshot(s.match, s.clock, s.log, pending, s.toast?.text ?? null, PREFIX)).catch(() => {});
    };
    const unsub = useMatch.subscribe(push);
    push();
    return () => { disposed = true; unsub(); };
  }, [pending]);

  const show = useCallback(async () => {
    if (!isTauri()) { setError('overlay needs the Tauri window'); return; }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('show_overlay', { placement: {} });
      setVisible(true); setError(null);
    } catch (e) { setError(String(e)); }
  }, []);

  const hide = useCallback(async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('hide_overlay').catch(() => {});
    setVisible(false);
  }, []);

  return { visible, error, show, hide, toggle: () => (visible ? hide() : show()) };
}
