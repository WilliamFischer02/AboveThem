/**
 * Under a chat bubble the OCR could not read: why, and what to install (owned by bugs-rust; ChatDock
 * renders it with one line). Also labels translations made from a look-alike guess.
 */
import { useEffect, useState } from 'react';
import { isTauri } from '../../state/persist';
import { unreadableHint } from '../../input/eventHelpers';
import type { ChatLine } from '../../types/game';

let langsPromise: Promise<string[]> | null = null;
/** Installed Windows OCR languages, fetched once per app run (null outside Tauri). */
export function ocrLanguages(): Promise<string[]> {
  if (!isTauri()) return Promise.resolve([]);
  langsPromise ??= import('@tauri-apps/api/core').then(({ invoke }) => invoke<string[]>('ocr_languages')).catch(() => { langsPromise = null; return []; });
  return langsPromise;
}

export function ChatHint({ line }: { line: ChatLine }) {
  const [langs, setLangs] = useState<string[] | null>(null);
  const needed = !!line.unreadable || !!line.xlatGuess;
  useEffect(() => {
    if (!needed) return;
    let live = true;
    ocrLanguages().then(l => { if (live) setLangs(l); });
    return () => { live = false; };
  }, [needed]);
  if (!needed) return null;
  const hint = unreadableHint(line, langs);
  return (
    <div className="muted small chat-hint">
      {line.xlatGuess && <div>≈ translation guessed from a mis-read; treat as a hint, not a quote</div>}
      {hint && <div>{hint}</div>}
    </div>
  );
}
