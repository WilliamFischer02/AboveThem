/**
 * AboveThem — canonical domain model.
 *
 * Everything the engine reasons about is defined here. Keep it free of UI and
 * Tauri concerns. Change deliberately; update all consumers in the same commit.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type PlayerColor =
  | 'red' | 'blue' | 'green' | 'pink' | 'orange' | 'yellow' | 'black' | 'white'
  | 'purple' | 'brown' | 'cyan' | 'lime' | 'maroon' | 'rose' | 'banana' | 'gray'
  | 'tan' | 'coral' | 'unknown';

export type PlayerId = string; // stable per match; usually the color unless colors repeat (modded)

export type MapId = 'skeld' | 'mira' | 'polus' | 'airship' | 'fungle';

export type RoomId = string; // per-map key from data/maps/<map>.json

export type Role = 'crew' | 'impostor' | 'unknown';

export interface Player {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  isMe: boolean;
  status: 'alive' | 'dead' | 'ejected' | 'disconnected';
  /** What we KNOW, not what we suspect. */
  knownRole: Role;
  /** Marked by user as "my impostor partner" (impostor mode only). */
  isPartner?: boolean;
  /** The user set this player's role / partner flag by hand: automatic reads must not change it. */
  roleLocked?: boolean;
  /** 1-based position in the meeting vote grid (what the player sees); hotkey target prefix+digit. */
  slot?: number;
  /** Colour was set by the user; automatic reads must not change it. */
  colorLocked?: boolean;
  /** Name was typed by the user; repeated OCR readings must not change it. */
  nameLocked?: boolean;
  /** Meeting index the slot was read in (slots re-sort every meeting: alive first, dead last). */
  slotMeeting?: number;
  /** User said "not dead" during this meeting: automatic death reads are ignored until the next one. */
  aliveLockMeeting?: number;
}

// ---------------------------------------------------------------------------
// Lobby settings that change the reasoning
// ---------------------------------------------------------------------------

export interface LobbySettings {
  map: MapId;
  impostorCount: number;
  killCooldownSec: number;
  visualTasksOn: boolean;
  confirmEjectsOn: boolean;
  anonymousVotes: boolean;
  taskBarMode: 'always' | 'meetings' | 'never';
  crewVision: number;
  impostorVision: number;
  playerSpeed: number;
  emergencyMeetings: number;
  discussionTimeSec: number;
  votingTimeSec: number;
  commonTasks: number;
  longTasks: number;
  shortTasks: number;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Seconds since the current round started (round = play between meetings). */
export type RoundTime = number;

export interface Stamp {
  round: number;        // 0 = first round after lobby
  t: RoundTime;         // seconds into that round
  wall: number;         // Date.now()
}

// ---------------------------------------------------------------------------
// Observations — what the local player SAW (highest trust)
// ---------------------------------------------------------------------------

export type ObservationSource = 'me' | 'ocr' | 'mod' | 'manual';

interface BaseObs {
  id: string;
  stamp: Stamp;
  source: ObservationSource;
  /** 0..1; 'me' sightings default 0.95 (humans misremember), ocr 0.8, mod 1.0 */
  confidence: number;
  note?: string;
}

export interface SightingObs extends BaseObs {
  type: 'sighting';
  player: PlayerId;
  room: RoomId;
  /** Was the player alone, with me, or with others? */
  alone?: boolean;
  withPlayers?: PlayerId[];
  heading?: RoomId; // where they appeared to be going
}

export interface WithMeObs extends BaseObs {
  type: 'withMe';
  player: PlayerId;
  room: RoomId;
  on: boolean; // true = started being with me; false = left
}

export interface MyRoomObs extends BaseObs {
  type: 'myRoom';
  room: RoomId;
}

export interface SawTaskObs extends BaseObs {
  type: 'sawTask';
  player: PlayerId;
  room: RoomId;
  taskId?: string;
  /** Only true if the animation itself was seen (visual tasks). Hard clear when visuals ON. */
  visualConfirmed: boolean;
  /** Seconds they stood there, if timed. */
  durationSec?: number;
  taskBarMoved?: boolean;
}

export interface SawVentObs extends BaseObs {
  type: 'sawVent';
  player: PlayerId;
  room: RoomId;
}

export interface SawKillObs extends BaseObs {
  type: 'sawKill';
  killer: PlayerId;
  victim: PlayerId;
  room: RoomId;
}

export interface BodyFoundObs extends BaseObs {
  type: 'bodyFound';
  victim: PlayerId;
  room: RoomId;
  reporter?: PlayerId;
  /** Who else was present when found/reported. */
  present?: PlayerId[];
}

export interface SabotageObs extends BaseObs {
  type: 'sabotage';
  kind: 'lights' | 'reactor' | 'o2' | 'comms' | 'doors' | 'other';
  phase: 'start' | 'end';
  fixers?: PlayerId[];
}

export interface ManualMarkObs extends BaseObs {
  type: 'manualMark';
  player: PlayerId;
  /** sus = soft suspicion; clear = round clear (soft); hardClear = you are certain (visual task, kill-window); neutral = unmark. */
  mark: 'sus' | 'clear' | 'hardClear' | 'neutral';
  weight?: number;
  /** Why the user marked them (picked from SUS_REASONS / CLEAR_REASONS in engine/marks.ts). Each reason has its own weight. */
  reason?: MarkReason;
}

export type UserMark = 'sus' | 'clear' | 'hardClear';

/** Why a player is sus, as picked by the user in one click (labels + weights: engine/marks.ts, data/tactics/weights.json). */
export type SusReason =
  | 'proximityToBody' | 'unaccountedFor' | 'strangeBehavior' | 'followedMe' | 'fakeTasking'
  | 'ventSound' | 'lyingInChat' | 'selfReport' | 'other';

/** Why a player is (soft) clear, as picked by the user. */
export type ClearReason = 'withMeWholeRound' | 'sawVisualTask' | 'taskBarMoved' | 'otherClear';

export type MarkReason = SusReason | ClearReason;

export type Observation =
  | SightingObs | WithMeObs | MyRoomObs | SawTaskObs | SawVentObs
  | SawKillObs | BodyFoundObs | SabotageObs | ManualMarkObs;

// ---------------------------------------------------------------------------
// Meeting data — what people SAID (lower trust, checkable)
// ---------------------------------------------------------------------------

export interface ChatLine {
  id: string;
  meeting: number;
  stamp: Stamp;
  sender: PlayerId;
  original: string;
  translated?: string;
  lang?: string;         // ISO 639-1
  langConfidence?: number;
  source: ObservationSource;
}

export type ClaimType = 'location' | 'companion' | 'task' | 'sighting' | 'accusation' | 'defense' | 'clear';

export interface Claim {
  id: string;
  meeting: number;
  stamp: Stamp;
  by: PlayerId;
  type: ClaimType;
  /** Structured content; fields depend on type. */
  room?: RoomId;
  about?: PlayerId;        // companion / accused / cleared / sighted player
  taskId?: string;
  timeWindow?: [RoundTime, RoundTime];
  text?: string;           // the raw line, for display
  chatLineId?: string;
  /** Set by the engine, not the user. */
  verification?: 'confirmed' | 'contradicted' | 'pending';
}

export interface Vote {
  meeting: number;
  voter: PlayerId;
  target: PlayerId | 'skip' | 'none';
  /** Only known if lobby shows votes. */
  known: boolean;
}

export interface Ejection {
  meeting: number;
  player: PlayerId | null;   // null = skipped/tie
  wasImpostor: boolean | null; // null if confirm ejects OFF
  impostorsRemaining?: number;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export type Phase =
  | 'lobby' | 'roundStart' | 'round' | 'meetingDiscussion' | 'meetingVoting'
  | 'ejection' | 'gameOver';

export interface PhaseChange {
  phase: Phase;
  wall: number;
  round: number;
  meeting?: number;
  /** For meetings: who called it and why. */
  calledBy?: PlayerId;
  reason?: 'body' | 'button';
  /** For gameOver: read from the end screen (VICTORY / DEFEAT word or its colour). */
  outcome?: 'victory' | 'defeat';
}

// ---------------------------------------------------------------------------
// Map data
// ---------------------------------------------------------------------------

export interface MapRoom {
  id: RoomId;
  name: string;
  key: string;              // hotkey suffix
  deadEnd: boolean;
  /** Neighbouring rooms and rough travel time in seconds at speed 1.0. */
  adjacent: { room: RoomId; sec: number }[];
  /** Other labels the game / OCR may show for this room (e.g. "Outside" for split outdoor zones). Additive. */
  aliases?: string[];
  _note?: string;
}

export interface MapVentNetwork {
  id: string;
  rooms: RoomId[];          // vents in this network connect all of these
  /** Single vent hops (room pairs), when known. Every pair is inside `rooms`. Additive. */
  links?: [RoomId, RoomId][];
  _note?: string;
}

export interface MapTask {
  id: string;
  name: string;
  rooms: RoomId[];          // where it can be done (multi-stage tasks list all)
  kind: 'common' | 'short' | 'long';
  visual: boolean;
  stages: number;
  /** Seconds to complete one stage, roughly. */
  stageDurationSec: number;
  _note?: string;
}

export interface MapData {
  id: MapId;
  name: string;
  rooms: MapRoom[];
  vents: MapVentNetwork[];
  tasks: MapTask[];
  _verified: { rooms: boolean; vents: boolean; tasks: boolean; durations: boolean };
  _note?: string;
  /** Map-specific monitoring / sabotage / movement facts (additive; may be absent on old data). */
  info?: MapInfo;
}

// --- Map info (additive, maps agent) ----------------------------------------

export type MapSabotage = 'lights' | 'comms' | 'reactor' | 'o2' | 'doors' | 'seismic' | 'crashCourse' | 'mushroomMixup';

export type MapFeature = 'doorLog' | 'decontamination' | 'oneVentNetwork' | 'ladders' | 'movingPlatform' | 'zipline' | 'spawnChoice' | 'mushroomMixup';

/** Monitoring, sabotage and traversal facts per map. Everything here is visible to any player, never hidden info. */
export interface MapInfo {
  /** Rooms with an Admin table (empty on The Fungle; two on The Airship). */
  admin: RoomId[];
  /** Where the camera / binocular console is, and which rooms (or hallways next to them) it shows. null = none (MIRA HQ). */
  security: { room: RoomId; kind: 'cameras' | 'binoculars'; covers: RoomId[]; _note?: string } | null;
  /** Room with the Vitals monitor (Polus, Airship, Fungle), else null. */
  vitals: RoomId | null;
  /** MIRA HQ only: the Communications computer listing who crossed the Hallway sensors. */
  doorLog: { room: RoomId; sensors: string[] } | null;
  emergencyButton: RoomId;
  sabotages: MapSabotage[];
  /** Where each sabotage is fixed (or, for doors, which rooms can be shut). Unverified spots carry a note in `_note`. */
  sabotageRooms?: Partial<Record<MapSabotage, RoomId[]>>;
  /** Impostors can shut doors on this map. */
  doors: boolean;
  features: MapFeature[];
  /** Non-walking links that are already in the adjacency graph (ladders, zipline, moving platform), for display / reasoning. */
  shortcuts?: { from: RoomId; to: RoomId; kind: 'ladder' | 'zipline' | 'platform'; sec: number }[];
  /** Where players appear at game start / after a meeting (Airship: each player picks one of these). */
  spawn?: { start: RoomId[]; afterMeeting: RoomId[]; _note?: string };
  /** Panels that look like a task but can never be done: anyone "doing" one is faking. */
  dummyPanels?: { room: RoomId; taskId: string }[];
  _note?: string;
}

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  id: string;
  player: PlayerId;
  weight: number;           // log-odds contribution (+ = sus)
  category: 'movement' | 'task' | 'meeting' | 'sabotage' | 'structural' | 'manual' | 'hard' | 'social';
  label: string;            // short human line
  refs: string[];           // observation/claim ids
  /** true if the rule depends on unverified map data */
  shaky?: boolean;
  /** Situation key from data/tactics/crew.json this evidence maps to (drives the meeting script). */
  kind?: string;
  /** Template variables for that situation: P, R, T, W, V, TASK, P2, R2... */
  vars?: Record<string, string>;
  /** Round this evidence is about (drives time decay). Derived from refs when the rule does not set it. */
  round?: number;
  /** Weight before time decay / shaky halving (set by scoreAll; `weight` is what was actually applied). */
  baseWeight?: number;
  /** 0..1 multiplier applied for age (1 = fresh; hard facts never decay). */
  decay?: number;
}

export interface SuspectScore {
  player: PlayerId;
  /** 'certainImpostor' | 'certainCrew' short-circuit the score */
  verdict: 'certainImpostor' | 'certainCrew' | 'hardClear' | 'softClear' | 'unknown';
  logOdds: number;
  probability: number;      // sigmoid(logOdds), 0..1
  evidence: EvidenceItem[];
  /** Per-kill clears, for multi-impostor lobbies */
  clearedForKills: string[]; // bodyFound observation ids
  /** Probability at the end of each completed meeting (oldest first), then `now`. For arrows / sparklines. */
  trend?: { meeting: number; probability: number }[];
  /** probability now − probability at the end of the last completed meeting (0 when there is none). */
  delta?: number;
  /** One line for the card: "2 accusations · alone near the Electrical body". */
  summary?: string;
  /** Where the score starts before evidence: impostors remaining among unresolved players. */
  baseline?: { logOdds: number; label: string };
}

export interface MeetingQuestion {
  to: PlayerId | 'all';
  text: string;
  why: string[];            // evidence ids
  expectedGain: number;
}

export interface MeetingScript {
  meeting: number;
  headline: string;
  ask: MeetingQuestion[];
  say: { text: string; why: string[] }[];
  vote: { target: PlayerId | 'skip'; confidence: number; alternative?: PlayerId | 'skip'; reason: string };
  watch: string[];
  insufficientInfo: boolean;
}

// ---------------------------------------------------------------------------
// Impostor mode
// ---------------------------------------------------------------------------

export interface LedgerClaim {
  id: string;
  meeting: number;
  type: ClaimType;
  room?: RoomId;
  about?: PlayerId;
  taskId?: string;
  timeWindow?: [RoundTime, RoundTime];
  text: string;
  basedOn: string[];        // real observation ids this lie leans on
  dependsOn: string[];      // other ledger claim ids
  risk: number;             // 0..1
  exposedBy?: string[];     // claim/observation ids that contradict it
}

export interface AlibiOption {
  text: string;
  room: RoomId;
  companion?: PlayerId;
  taskId?: string;
  timeWindow: [RoundTime, RoundTime];
  score: number;
  weakPoint: string;
  basedOn: string[];
}

export interface FakeTaskStop {
  taskId: string;
  room: RoomId;
  standSec: number;
  note: string;
}

export interface DefenseResponse {
  accusationType: string;
  response: string;
  avoid: string[];
  followup: string;
  basedOn: string[];
}

// ---------------------------------------------------------------------------
// Whole-match snapshot (serialised to NDJSON as events; this is the reduced view)
// ---------------------------------------------------------------------------

export interface MatchState {
  id: string;
  startedAt: number;
  settings: LobbySettings;
  map: MapData;
  me: PlayerId;
  myRole: Role;
  /** Room code this match was created in (a different code means different people: fresh roster). */
  lobbyCode?: string;
  /** Set by hand in the UI: automatic reads must not change myRole for the rest of this match. */
  myRoleLocked?: boolean;
  /** How many players the screen says there are: vote-grid cards (exact) or the lobby CAPACITY counter (±1). */
  rosterSize?: number;
  rosterSizeSource?: 'grid' | 'lobby' | 'manual';
  players: Record<PlayerId, Player>;
  phase: PhaseChange;
  observations: Observation[];
  chat: ChatLine[];
  claims: Claim[];
  votes: Vote[];
  ejections: Ejection[];
  ledger: LedgerClaim[];
  /** My own task list as read from the screen (Phase 2). Enables the common-task rule. */
  myTasks?: MyTask[];
}

export interface MyTask {
  /** Map task id when matched, else the raw text. */
  id: string;
  name: string;
  room?: RoomId;
  progress?: string;
  matched: boolean;
}
