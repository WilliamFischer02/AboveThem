import { useEffect } from 'react';
import { useMatch } from '../../state/store';
import { keyLabel } from '../../input/hotkeys';

export function Toast({ pending }: { pending: string | null }) {
  const toast = useMatch(s => s.toast);
  const clearToast = useMatch(s => s.clearToast);
  const undo = useMatch(s => s.undo);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 1500);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  if (pending) {
    return <div className="toast pending"><b>{keyLabel(pending)}</b> <span className="muted">… room or action key?</span></div>;
  }
  if (!toast) return null;
  return (
    <div className="toast">
      <span>{toast.text}</span>
      {toast.undoable && <button className="btn xs" onClick={undo}>Undo (Ctrl+Z)</button>}
    </div>
  );
}
