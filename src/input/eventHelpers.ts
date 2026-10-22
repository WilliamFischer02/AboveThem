/**
 * Pure helpers for the automatic layer (`useGameEvents.ts`): no React, no Tauri, unit-tested.
 * Moved here so the decisions the event wiring makes can be tested without a game.
 */

/** Words that prove a chat line is English already (so it never leaves the machine). */
const EN = new Set(('i im me my you u ur your he she it we they the a an and or but so if not no yes ok okay lol lmao omg bro guys guy who what where when why how was were is are am be been do did does done have has had go went going come came get got see saw seen say said tell told know think thought sus vent vented venting kill killed killer body report reported self button skip vote voted voting imp impostor crew crewmate task tasks fake faking clear clean safe trust with alone there here this that these those on in at to of for from by about near around behind left right up down out over just only also too very really maybe idk dunk hard soft wait stop pls please thanks thx ty gg gl hi hello hey bye yo nah yeah yep nope red blue green pink orange yellow black white purple brown cyan lime maroon rose banana gray grey tan coral cafeteria cafe weapons o2 navigation nav admin storage electrical elec medbay med security sec cams comms shields reactor engine engines upper lower lights sabotage sab doors lab office specimen dropship boiler laboratory communications decontamination cockpit vault records kitchen gap room showers vent vents rounds round meeting emergency last first then now before after dead died die vents saw sees look looked follow followed following chase chased stack stacked group two one three 1 2 3 4 5').split(' '));

/**
 * Quick "is this English already" check so most chat never leaves the machine.
 * Script-aware: any letter outside ASCII Latin (accents, Cyrillic, CJK, Arabic) means "translate".
 * (Session-5 bug: the ASCII filter ran first, so pure Cyrillic left zero words and counted as English.)
 */
export function looksEnglish(text: string): boolean {
  if (/[^\x00-\x7f]/.test(text) && /\p{L}/u.test(text.replace(/[\x00-\x7f]/g, ''))) return false;
  const words = text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hits = words.filter(w => EN.has(w) || /^\d+$/.test(w)).length;
  return hits / words.length >= 0.6 || (words.length <= 2 && hits >= 1);
}

/** Chat payload from `game://chat` (Rust `chat::ChatMsg`). Fields after `color` arrived in session 5. */
export interface ChatPayload {
  sender: string; text: string; mine: boolean; system: boolean; y: number; color: string;
  unreadable?: boolean; ocr_lang?: string | null; plausibility?: number; script_hint?: string | null; cyrillic_guess?: string | null;
}

/** What to send to the translator for a chat line, or null for "nothing to translate". */
export function translationRequest(msg: Pick<ChatPayload, 'text' | 'unreadable' | 'script_hint' | 'cyrillic_guess'>): { text: string; from?: string; guess: boolean } | null {
  if (msg.unreadable) {
    // Cyrillic read by a Latin-only OCR: translate the look-alike guess, labelled as a guess.
    if (msg.script_hint === 'cyrillic' && msg.cyrillic_guess && msg.cyrillic_guess.trim().length >= 2) return { text: msg.cyrillic_guess, from: 'ru', guess: true };
    return null; // garbage or empty: a translation of garbage is worse than none
  }
  if (!msg.text.trim() || looksEnglish(msg.text)) return null;
  return { text: msg.text, guess: false };
}

/** The hint shown under an unreadable chat line. `ocrLangs` = installed Windows OCR languages (BCP-47). */
export function unreadableHint(line: { unreadable?: boolean; scriptHint?: string; original: string }, ocrLangs: string[] | null): string | null {
  if (!line.unreadable) return null;
  const hasRu = (ocrLangs ?? []).some(l => /^ru\b/i.test(l));
  if (line.scriptHint === 'cyrillic' && !hasRu) return "⚠ can't read: looks like Cyrillic — install the Russian OCR pack (Screen reading panel)";
  if (line.scriptHint === 'cyrillic') return "⚠ can't read this line reliably (Cyrillic)";
  return line.original.trim()
    ? "⚠ can't read this line — another language? Install its OCR pack (Screen reading panel)"
    : "⚠ can't read this message — another language? Install its OCR pack (Screen reading panel)";
}

/** Windows steps to add an OCR language (shown in the Screen reading panel). */
export const OCR_INSTALL_STEPS = 'Windows Settings → Time & language → Language & region → Add a language → Russian (or the lobby\'s language) → tick "Optical character recognition" / Basic typing → Install. Restart AboveThem afterwards.';

/** Sender id by the bubble's icon colour, when exactly one other player has that colour. */
export function senderByIconColor(color: string | undefined, others: { id: string; color: string }[]): string | null {
  if (!color || color === 'unknown' || color === 'gray') return null;
  const hit = others.filter(p => p.color === color);
  return hit.length === 1 ? hit[0].id : null;
}
