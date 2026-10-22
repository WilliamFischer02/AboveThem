/**
 * Roster consolidation (pure).
 *
 * Every automatic roster source (lobby labels, vote grid, chat bubbles) can invent a
 * player: an OCR variant of a real name ("BigBihgis" for "BigBingus"), the host line's
 * colour suffix ("(Red)"), a chat sentence read as a sender, a UI word. Left alone the
 * roster grows to 30+ cards and stops being useful. This module decides, from the
 * evidence each card carries, which cards are the same person and which are junk, and
 * keeps the roster at the size the screen says the lobby has.
 *
 * Quality order (what survives a merge): me > a card seen on the vote grid (slot) > a
 * card with a headshot hash > a readable, plausible name > anything else.
 */
import { hashDistance, nameScore, norm, similarity } from './rosterMatch';

export interface ConsolidatePlayer {
  id: string;
  name: string;
  color: string;
  status: 'alive' | 'dead' | 'ejected' | 'disconnected';
  isMe: boolean;
  slot?: number;
  slotMeeting?: number;
  iconHash?: string;
  colorLocked?: boolean;
  roleLocked?: boolean;
  /** Observations / claims / votes that mention this card (evidence we would lose by dropping it). */
  refs: number;
}

export type ConsolidateAction =
  | { kind: 'merge'; from: string; into: string; why: string }
  | { kind: 'remove'; id: string; why: string };

/** Among Us caps names at 12 characters. UNVERIFIED for modded clients; the stock client enforces it. */
export const NAME_MAX = 12;

const COLOUR_WORDS = /^(red|blue|green|pink|orange|yellow|black|white|purple|brown|cyan|lime|maroon|rose|banana|gray|grey|tan|coral)$/i;

/** Names that carry no identity: "#3", "slot7", "You", "(Black)", "black", "unknown". */
export function isPlaceholderName(name: string): boolean {
  const t = name.trim();
  if (t.length < 2) return true;
  if (/^#\d+$/.test(t) || /^slot\d+$/i.test(t) || /^you$/i.test(t) || /^unknown$/i.test(t)) return true;
  if (/^\(.*\)$/.test(t)) return true;
  if (COLOUR_WORDS.test(t)) return true;
  return false;
}

/** 0..1: how much a name looks like something a player typed rather than OCR noise. */
export function nameQuality(name: string): number {
  const t = name.trim();
  if (isPlaceholderName(t)) return 0;
  if (t.length > NAME_MAX) return 0.1;                     // longer than the game allows: a chat line
  const words = t.split(/\s+/).length;
  if (words >= 3) return 0.3;                               // "i saw it ot"
  if (/[()[\]{}<>:;,"]/.test(t)) return 0.3;               // punctuation the game does not allow
  const letters = t.replace(/[^a-z]/gi, '').length;
  if (letters === 0) return 0.2;                             // digits / symbols only
  if (/[^\x00-\x7f]/.test(t) && letters >= 3) return 0.6;    // "BAMBÄM", "GrÜbbyqb": an accent OCR put into an ASCII name
  if (/[a-z][0-9][a-z]/i.test(t)) return 0.7;                // digit between letters: "ExceLL0l"
  return 1;
}

/** Evidence weight of a card: the better one survives a merge, the weakest ones go when the roster is over size. */
export function playerQuality(p: ConsolidatePlayer, meeting: number): number {
  if (p.isMe) return 1000;
  let q = 0;
  if (p.slot !== undefined) q += p.slotMeeting === meeting ? 4 : 3;
  if (p.iconHash) q += 2;
  if (p.color !== 'unknown' && p.color !== 'gray') q += 0.5;
  if (p.colorLocked || p.roleLocked) q += 2;               // the user touched this card
  q += nameQuality(p.name) * 2;
  q += Math.min(1, p.refs * 0.25);
  return q;
}

/** Are these two cards the same person? Never when both were on the grid in the same meeting (they coexist). */
export function sameIdentity(a: ConsolidatePlayer, b: ConsolidatePlayer): { same: boolean; why: string } {
  if (a.slot !== undefined && b.slot !== undefined && a.slotMeeting === b.slotMeeting && a.slot !== b.slot) return { same: false, why: 'both on the grid' };
  if (a.colorLocked && b.colorLocked && a.color !== b.color) return { same: false, why: 'colours set by hand' };
  const hd = hashDistance(a.iconHash, b.iconHash);
  if (hd <= 10) return { same: true, why: 'same headshot' };
  const ns = nameScore(a.name, b.name);
  if (ns >= 0.6) return { same: true, why: `name ${a.name} ≈ ${b.name}` };
  // A short OCR fragment of a longer name ("ymidland" / "Raymidland", "tamin m" / "vitamin D").
  const na = norm(a.name), nb = norm(b.name);
  if (na.length >= 4 && nb.length >= 4 && (nb.includes(na.slice(0, 4)) || na.includes(nb.slice(0, 4))) && similarity(na, nb) >= 0.45) return { same: true, why: `fragment ${a.name} ~ ${b.name}` };
  // A nameless card ("(Black)", "#4") with the same known colour as a named card, never seen on the grid together.
  const placeholderA = isPlaceholderName(a.name), placeholderB = isPlaceholderName(b.name);
  if ((placeholderA || placeholderB) && a.color === b.color && a.color !== 'unknown' && a.color !== 'gray' && (a.slot === undefined || b.slot === undefined)) return { same: true, why: `colour ${a.color}` };
  return { same: false, why: '' };
}

export interface ConsolidateOptions {
  /** How many players the screen says there are (vote-grid cards, or the lobby capacity counter). */
  size: number | null;
  /** Extra cards tolerated above `size` (1 in the lobby, where people join and leave; 0 at a meeting). */
  tolerance: number;
  meeting: number;
}

/**
 * Merge duplicates (lower quality into higher), then drop the weakest cards until the
 * roster fits `size + tolerance`. Returns the actions in the order to apply them.
 */
export function consolidate(players: ConsolidatePlayer[], opts: ConsolidateOptions): ConsolidateAction[] {
  const actions: ConsolidateAction[] = [];
  const ranked = [...players].sort((a, b) => playerQuality(b, opts.meeting) - playerQuality(a, opts.meeting));
  const gone = new Set<string>();
  for (let i = 0; i < ranked.length; i++) {
    const p = ranked[i];
    if (gone.has(p.id) || p.isMe) continue;
    for (let j = 0; j < i; j++) {
      const q = ranked[j];
      if (gone.has(q.id)) continue;
      const r = sameIdentity(p, q);
      if (!r.same) continue;
      actions.push({ kind: 'merge', from: p.id, into: q.id, why: r.why });
      gone.add(p.id);
      break;
    }
  }
  if (opts.size !== null && opts.size > 0) {
    const survivors = ranked.filter(p => !gone.has(p.id));
    const limit = opts.size + opts.tolerance;
    let count = survivors.length;
    // Drop from the bottom; a card seen on the grid this meeting is the screen's truth and stays.
    for (let i = survivors.length - 1; i >= 0 && count > limit; i--) {
      const p = survivors[i];
      if (p.isMe || (p.slot !== undefined && p.slotMeeting === opts.meeting)) continue;
      actions.push({ kind: 'remove', id: p.id, why: `roster over ${opts.size}` });
      gone.add(p.id);
      count--;
    }
  }
  return actions;
}
