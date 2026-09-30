import type { Tile } from '../tiles/tiles';
import { buildFullSet, faceIndex, isBonus, BASIC_FACES } from '../tiles/tiles';
import { createRng, shuffle, type Rng } from '../tiles/rng';
import type { HKRules } from '../rules/hongkong';
import { HK_DEFAULTS } from '../rules/hongkong';
import type { Ruleset } from '../rules/ruleset';
import { isRuleset, hkRuleset } from '../rules/ruleset';
import { shanten as shantenOf } from './hand';
import { countsFromFaces, winningWaits, type Counts } from './hand';
import type { MeldLike, ScoringResult } from '../scoring/hongkong-scoring';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type MeldKind = 'chi' | 'pon' | 'kan' | 'ankan';

export interface Meld {
  kind: MeldKind;
  tiles: number[]; // tile ids
  from: number | null; // seat the claimed tile came from (null for ankan)
  added: boolean; // added kong (upgraded pon)
}

export interface PlayerState {
  seat: number;
  name: string;
  isHuman: boolean;
  hand: number[]; // tile ids, kept sorted
  melds: Meld[];
  bonus: number[]; // flower/season tile ids
  discards: number[]; // tile ids in discard order
  score: number; // cumulative match score
  riichi: boolean; // declared (riichi ruleset)
  riichiLock: boolean; // after the declaration discard, only tsumogiri
  ippatsu: boolean; // win within one turn cycle of riichi, no calls in between
}

export type Phase = 'draw' | 'discard' | 'calls' | 'calls-rob' | 'hand-over' | 'match-over';

export interface Offer {
  seat: number;
  kind: 'ron' | 'pon' | 'kan' | 'chi';
  chiOptions?: number[][]; // hand tile id triples? -> pairs that combine with the discard
}

export interface GameEvent {
  t: string;
  seat?: number;
  tileId?: number;
  detail?: string;
  hand?: number;
}

export interface HandResult {
  kind: 'win' | 'draw';
  winner?: number;
  selfDrawn?: boolean;
  tileId?: number;
  scoring?: ScoringResult;
  payments?: number[]; // per seat (what each pays; winner receives)
}

export interface TradState {
  ruleset: Ruleset;
  rngState: number;
  tiles: Tile[]; // the physical 144
  players: PlayerState[];
  wall: number[]; // remaining live wall (draw from front)
  deadWall: number[]; // replacement draws
  current: number; // seat to act
  dealer: number;
  roundWind: number; // 1=E 2=S 3=W 4=N
  handNumber: number; // 1-based
  phase: Phase;
  lastDiscard: { tileId: number; seat: number } | null;
  offers: Offer[];
  pendingReplacementDraw: boolean; // next draw comes from dead wall
  lastDrawWasReplacement: boolean; // the current drawn tile came from the dead wall
  drawnTile: number | null; // tile just drawn by current (for UI)
  result: HandResult | null;
  events: GameEvent[];
  /** set while an added kong waits for possible robs */
  robTarget: { seat: number; tileId: number } | null;
  /** riichi: dora indicator tiles (grows with each kan); ura revealed on riichi win */
  doraIndicators: number[];
  uraIndicators: number[];
  /** deterministic replay: every external input is recorded (see replayMatch) */
  recording: boolean;
  replay: { seed: number; actions: ReplayAction[] };
}

/** Every EXTERNAL input that mutates the match. Internal randomness comes
 *  from the seeded rng (mulberry32, serializable), so seed + actions fully
 *  reproduce a match — see replayMatch(). */
export type ReplayAction =
  | { t: 'draw' }
  | { t: 'discard'; tileId: number }
  | { t: 'riichi'; seat: number }
  | { t: 'tsumo'; seat: number }
  | { t: 'ankan'; seat: number }
  | { t: 'addedkong'; seat: number }
  | { t: 'decision'; seat: number; kind: 'pass' | 'chi' | 'pon' | 'kan' | 'ron'; chiChoice?: number[] }
  | { t: 'rob'; seat: number; yes: boolean }
  | { t: 'next-hand' };

function rec(s: TradState, a: ReplayAction): void {
  if (s.recording) s.replay.actions.push(a);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function faceOf(s: TradState, tileId: number) {
  return s.tiles[tileId].face;
}

export function faceIdxOf(s: TradState, tileId: number): number {
  return faceIndex(s.tiles[tileId].face);
}

export function seatWindOf(s: TradState, seat: number): number {
  return (((seat - s.dealer) % 4) + 4) % 4 + 1;
}

export function sortHand(s: TradState, seat: number): void {
  s.players[seat].hand.sort((a, b) => a - b);
}

export function handFaces(s: TradState, seat: number) {
  return s.players[seat].hand.map((id) => s.tiles[id].face);
}

export function handCounts(s: TradState, seat: number): Counts {
  return countsFromFaces(handFaces(s, seat));
}

function rng(s: TradState): Rng {
  const r = createRng(s.rngState);
  // advance persistent state after use
  r.next();
  s.rngState = r.state();
  return createRng(s.rngState);
}

function log(s: TradState, t: string, seat?: number, tileId?: number, detail?: string) {
  s.events.push({ t, seat, tileId, detail, hand: s.handNumber });
  if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
}

/* ------------------------------------------------------------------ */
/* Match / hand setup                                                  */
/* ------------------------------------------------------------------ */

export function newMatch(
  rules: HKRules | Ruleset = HK_DEFAULTS,
  seed = Date.now() >>> 0,
  names = ['Você', 'Bot Sul', 'Bot Oeste', 'Bot Norte']
): TradState {
  const ruleset = isRuleset(rules) ? rules : hkRuleset(rules);
  const tiles = buildFullSet(ruleset.includeBonus);
  const s: TradState = {
    ruleset,
    rngState: seed >>> 0,
    tiles,
    players: names.map((name, seat) => ({
      seat,
      name,
      isHuman: seat === 0,
      hand: [],
      melds: [],
      bonus: [],
      discards: [],
      score: 0,
      riichi: false,
      riichiLock: false,
      ippatsu: false,
    })),
    wall: [],
    deadWall: [],
    current: 0,
    dealer: 0,
    roundWind: 1,
    handNumber: 1,
    phase: 'draw',
    lastDiscard: null,
    offers: [],
    pendingReplacementDraw: false,
    lastDrawWasReplacement: false,
    drawnTile: null,
    result: null,
    events: [],
    robTarget: null,
    doraIndicators: [],
    uraIndicators: [],
    recording: true,
    replay: { seed, actions: [] },
  };
  startHand(s);
  return s;
}

export function startHand(s: TradState): void {
  const r = rng(s);
  const order = shuffle(s.tiles.map((t) => t.id), r);
  s.deadWall = order.splice(order.length - 14, 14);
  s.wall = order; // 130 live tiles
  for (const p of s.players) {
    p.hand = [];
    p.melds = [];
    p.bonus = [];
    p.discards = [];
    p.riichi = false;
    p.riichiLock = false;
    p.ippatsu = false;
  }
  s.lastDiscard = null;
  s.offers = [];
  s.result = null;
  s.pendingReplacementDraw = false;
  s.lastDrawWasReplacement = false;
  s.drawnTile = null;
  s.robTarget = null;
  s.uraIndicators = [];
  s.doraIndicators = s.ruleset.name === 'Riichi' && s.deadWall.length > 0 ? [s.deadWall[s.deadWall.length - 1]] : [];
  s.roundWind = Math.min(4, Math.floor((s.handNumber - 1) / 4) + 1);

  // deal 13 to each, dealer gets 14th
  for (let round = 0; round < 13; round++)
    for (let i = 0; i < 4; i++) s.players[(s.dealer + i) % 4].hand.push(s.wall.shift()!);
  s.players[s.dealer].hand.push(s.wall.shift()!);
  for (let i = 0; i < 4; i++) sortHand(s, i);

  log(s, 'deal', undefined, undefined, `Mão ${s.handNumber} — vento dominante ${windName(s.roundWind)}`);
  // expose bonus tiles (start with dealer, then counter-clockwise as per tradition)
  for (let i = 0; i < 4; i++) replaceBonusTiles(s, (s.dealer + i) % 4);

  s.current = s.dealer;
  s.phase = 'discard'; // dealer starts with 14 tiles
  s.drawnTile = s.players[s.dealer].hand[s.players[s.dealer].hand.length - 1];
}

function windName(w: number) {
  return ['Leste', 'Sul', 'Oeste', 'Norte'][w - 1];
}

/** Expose all bonus tiles of a seat and replace them from the dead wall. */
export function replaceBonusTiles(s: TradState, seat: number): number {
  const p = s.players[seat];
  let exposed = 0;
  for (let i = p.hand.length - 1; i >= 0; i--) {
    const id = p.hand[i];
    if (isBonus(s.tiles[id].face)) {
      p.hand.splice(i, 1);
      p.bonus.push(id);
      exposed++;
      if (s.deadWall.length > 0) p.hand.push(s.deadWall.shift()!);
      else p.hand.push(s.wall.shift()!); // fallback if dead wall empty
    }
  }
  if (exposed > 0) {
    sortHand(s, seat);
    log(s, 'bonus', seat, undefined, `${p.name} expõe ${exposed} bônus`);
    // replacements can themselves be bonus -> repeat
    if (p.hand.some((id) => isBonus(s.tiles[id].face))) return exposed + replaceBonusTiles(s, seat);
  }
  return exposed;
}

/* ------------------------------------------------------------------ */
/* Draw / discard                                                      */
/* ------------------------------------------------------------------ */

export interface DrawResult {
  ok: boolean;
  tileId?: number;
  exhaustiveDraw?: boolean;
}

export function drawTile(s: TradState): DrawResult {
  if (s.phase !== 'draw') return { ok: false };
  rec(s, { t: 'draw' }); // recorded as an ATTEMPT: an exhaustive draw also ends the hand
  const replacement = s.pendingReplacementDraw;
  if (!replacement && s.wall.length === 0) {
    // exhaustive draw
    s.result = { kind: 'draw' };
    s.phase = 'hand-over';
    log(s, 'draw-game', undefined, undefined, 'Empate — muro esgotado');
    return { ok: false, exhaustiveDraw: true };
  }
  let tileId: number;
  if (replacement) {
    if (s.deadWall.length > 0) tileId = s.deadWall.shift()!;
    else if (s.wall.length > 0) tileId = s.wall.shift()!;
    else {
      s.result = { kind: 'draw' };
      s.phase = 'hand-over';
      log(s, 'draw-game', undefined, undefined, 'Empate — muro esgotado');
      return { ok: false, exhaustiveDraw: true };
    }
  } else {
    tileId = s.wall.shift()!;
  }
  s.pendingReplacementDraw = false;
  s.lastDrawWasReplacement = replacement;
  const p = s.players[s.current];
  p.hand.push(tileId);
  s.drawnTile = tileId;
  log(s, replacement ? 'draw-replacement' : 'draw', s.current, tileId);
  if (isBonus(s.tiles[tileId].face)) {
    replaceBonusTiles(s, s.current);
    s.drawnTile = p.hand[p.hand.length - 1] ?? null;
    // the effective drawn tile came from the dead wall (flower replacement)
    s.lastDrawWasReplacement = true;
  }
  s.phase = 'discard';
  return { ok: true, tileId };
}

export function legalDiscards(s: TradState, seat: number): number[] {
  if (s.phase !== 'discard' || s.current !== seat) return [];
  const p = s.players[seat];
  const all = [...new Set(p.hand)];
  if (!p.riichi) return all;
  if (p.riichiLock && s.drawnTile !== null) return p.hand.includes(s.drawnTile) ? [s.drawnTile] : all;
  // declaration turn: only discards that keep the hand tenpai
  const counts = handCounts(s, seat);
  return all.filter((id) => {
    const f = faceIdxOf(s, id);
    counts[f]--;
    const t = shantenOf(counts, p.melds.length, true);
    counts[f]++;
    return t === 0;
  });
}

export function discard(s: TradState, tileId: number): boolean {
  if (s.phase !== 'discard' || s.current < 0) return false;
  const p = s.players[s.current];
  if (!legalDiscards(s, s.current).includes(tileId)) return false;
  rec(s, { t: 'discard', tileId });
  const idx = p.hand.indexOf(tileId);
  if (idx === -1) return false;
  if (p.riichi && !p.riichiLock) p.riichiLock = true; // lock tsumogiri from next turn
  p.hand.splice(idx, 1);
  p.discards.push(tileId);
  s.lastDiscard = { tileId, seat: s.current };
  sortHand(s, s.current);
  log(s, 'discard', s.current, tileId);
  s.drawnTile = null;
  computeOffers(s);
  if (s.offers.length === 0) {
    advanceTurn(s);
  } else {
    s.phase = 'calls';
  }
  return true;
}

function advanceTurn(s: TradState) {
  s.current = (s.current + 1) % 4;
  s.phase = 'draw';
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

/** Does seat have a winning hand using `tileId`? (subject to min fan) */
export function canRon(s: TradState, seat: number, tileId: number): boolean {
  const p = s.players[seat];
  const faces = handFaces(s, seat).concat(s.tiles[tileId].face);
  if (!s.ruleset.canWin(countsFromFaces(faces), p.melds.length)) return false;
  // minimum fan check with provisional context
  const scoring = scoreCandidate(s, seat, tileId, false);
  return scoring.meetsMinimum;
}

export function canTsumo(s: TradState, seat: number): boolean {
  const p = s.players[seat];
  if (s.current !== seat || s.phase !== 'discard') return false;
  if (s.drawnTile === null) return false; // win requires an actual drawn tile (not after a call)
  if (!s.ruleset.canWin(handCounts(s, seat), p.melds.length)) return false;
  const lastTile = !s.lastDrawWasReplacement && s.wall.length === 0;
  const scoring = scoreCandidate(s, seat, s.drawnTile, true, lastTile);
  return scoring.meetsMinimum;
}

export function canAnkan(s: TradState, seat: number): number | null {
  if (s.current !== seat || s.phase !== 'discard') return null;
  if (s.players[seat].riichi) return null; // v1: no kans after riichi
  const counts = handCounts(s, seat);
  for (let i = 0; i < 34; i++) if (counts[i] === 4) return i;
  return null;
}

/**
 * Riichi declaration (riichi ruleset only): concealed hand, on own discard
 * phase with a drawn tile, and at least one discard keeps the hand tenpai.
 */
export function canRiichi(s: TradState, seat: number): boolean {
  if (!s.ruleset.allowsRiichi) return false;
  if (s.current !== seat || s.phase !== 'discard' || s.drawnTile === null) return false;
  const p = s.players[seat];
  if (p.riichi) return false;
  if (p.melds.some((m) => m.kind !== 'ankan')) return false;
  return legalDiscards(s, seat).some((id) => {
    const counts = handCounts(s, seat);
    counts[faceIdxOf(s, id)]--;
    return shantenOf(counts, p.melds.length, true) === 0;
  });
}

export function declareRiichi(s: TradState, seat: number): boolean {
  if (!canRiichi(s, seat)) return false;
  s.players[seat].riichi = true;
  s.players[seat].ippatsu = true;
  log(s, 'riichi', seat, undefined, `${s.players[seat].name} declara RIICHI`);
  rec(s, { t: 'riichi', seat });
  return true;
}

/** every executed call breaks ippatsu (v1 documented simplification) */
function breakIppatsu(s: TradState) {
  for (const p of s.players) p.ippatsu = false;
}

/** Added kong: seat holds the 4th tile of an existing pon, during their discard phase. */
export function canAddKong(s: TradState, seat: number): number | null {
  if (s.current !== seat || s.phase !== 'discard') return null;
  const p = s.players[seat];
  for (const m of p.melds) {
    if (m.kind === 'pon' && !m.added) {
      const fIdx = faceIdxOf(s, m.tiles[0]);
      if (p.hand.some((id) => faceIdxOf(s, id) === fIdx)) return fIdx;
    }
  }
  return null;
}

export function computeOffers(s: TradState): void {
  s.offers = [];
  if (!s.lastDiscard) return;
  const { tileId, seat: from } = s.lastDiscard;
  const face = s.tiles[tileId].face;
  const fIdx = faceIndex(face);
  for (let i = 1; i <= 3; i++) {
    const seat = (from + i) % 4;
    if (canRon(s, seat, tileId)) s.offers.push({ seat, kind: 'ron' });
    // a player in riichi may only ron — no further calls
    if (s.players[seat].riichi) continue;
    const counts = handCounts(s, seat);
    if (counts[fIdx] >= 2) s.offers.push({ seat, kind: 'pon' });
    if (counts[fIdx] === 3) s.offers.push({ seat, kind: 'kan' });
    // chi only from the previous seat (i === 1)
    if (i === 1 && fIdx < 27) {
      const chiOptions = chiCombinations(s, seat, fIdx);
      if (chiOptions.length > 0) s.offers.push({ seat, kind: 'chi', chiOptions });
    }
  }
  // dedupe: a seat may only hold the HIGHEST priority offer + alternatives
  // (ron > pon/kan > chi). Keep all; resolution picks per seat with priority.
}

export function chiCombinations(s: TradState, seat: number, fIdx: number): number[][] {
  // returns pairs of hand tile ids forming a sequence with face fIdx
  if (fIdx >= 27) return [];
  const p = s.players[seat];
  const byFace = new Map<number, number[]>();
  for (const id of p.hand) {
    const fi = faceIdxOf(s, id);
    if (!byFace.has(fi)) byFace.set(fi, []);
    byFace.get(fi)!.push(id);
  }
  const combos: number[][] = [];
  const suitStart = Math.floor(fIdx / 9) * 9;
  const rank = fIdx - suitStart; // 0..8
  const patterns = [
    [-2, -1],
    [-1, 1],
    [1, 2],
  ];
  for (const [d1, d2] of patterns) {
    const a = rank + d1;
    const b = rank + d2;
    if (a < 0 || b < 0 || a > 8 || b > 8) continue;
    const ta = byFace.get(suitStart + a)?.[0];
    const tb = byFace.get(suitStart + b)?.[0];
    if (ta !== undefined && tb !== undefined && ta !== tb) combos.push([ta, tb]);
  }
  return combos;
}

export interface CallDecision {
  offer: Offer | null; // null = pass
  chiChoice?: number[]; // chosen pair for chi
}

/**
 * Resolve the call window. `decide(seat, offers)` must return the seat's
 * choice (or null). Bots answer immediately; for the human the caller
 * supplies a decision when available. Priority: ron (nearest to discarder)
 * > pon/kan > chi.
 */
export function resolveCalls(
  s: TradState,
  decide: (seat: number, offers: Offer[]) => CallDecision | 'pending'
): 'resolved' | 'pending' {
  if (s.phase !== 'calls') return 'resolved';
  const from = s.lastDiscard!.seat;
  const bySeat = new Map<number, Offer[]>();
  for (const o of s.offers) {
    if (!bySeat.has(o.seat)) bySeat.set(o.seat, []);
    bySeat.get(o.seat)!.push(o);
  }
  // order seats: by priority of their best offer, then by proximity to discarder
  const seats = [...bySeat.keys()].sort((a, b) => {
    const pa = bestPriority(bySeat.get(a)!);
    const pb = bestPriority(bySeat.get(b)!);
    if (pa !== pb) return pa - pb;
    return ((a - from + 4) % 4) - ((b - from + 4) % 4);
  });
  const passed = new Set<number>();
  for (const seat of seats) {
    const offers = bySeat.get(seat)!.filter((o) => kindPriority(o.kind) >= 0);
    const decision = decide(seat, offers);
    if (decision === 'pending') return 'pending';
    rec(s, { t: 'decision', seat, kind: decision.offer ? decision.offer.kind : 'pass', chiChoice: decision.chiChoice });
    if (decision.offer === null) {
      passed.add(seat);
      continue;
    }
    executeCall(s, seat, decision.offer, decision.chiChoice);
    return 'resolved';
  }
  // everybody passed
  s.offers = [];
  s.phase = 'draw';
  advanceTurn(s);
  return 'resolved';
}

function kindPriority(k: Offer['kind']): number {
  return k === 'ron' ? 0 : k === 'pon' ? 1 : k === 'kan' ? 1 : 2;
}
function bestPriority(offers: Offer[]): number {
  return Math.min(...offers.map((o) => kindPriority(o.kind)));
}

export function executeCall(s: TradState, seat: number, offer: Offer, chiChoice?: number[]): void {
  const { tileId, seat: from } = s.lastDiscard!;
  const taker = s.players[seat];

  if (offer.kind === 'ron') {
    // the winning tile stays visible in the discarder's pond (standard display);
    // it is NOT removed — integrity preserved, and it marks the winning tile.
    s.offers = [];
    finishHandWithWin(s, seat, tileId, false);
    return;
  }

  // claimed tile leaves the discarder's pond
  const dIdx = s.players[from].discards.indexOf(tileId);
  if (dIdx !== -1) s.players[from].discards.splice(dIdx, 1);
  s.lastDiscard = null;
  s.offers = [];
  const take = (need: number) => {
    const taken: number[] = [];
    const fIdx = faceIdxOf(s, tileId);
    for (let k = 0; k < need; k++) {
      const i = taker.hand.findIndex((id) => faceIdxOf(s, id) === fIdx);
      taken.push(taker.hand.splice(i, 1)[0]);
    }
    return taken;
  };
  if (offer.kind === 'pon') {
    const taken = take(2);
    taker.melds.push({ kind: 'pon', tiles: [...taken, tileId], from, added: false });
    breakIppatsu(s);
    log(s, 'call', seat, tileId, `${taker.name} faz PON`);
  } else if (offer.kind === 'kan') {
    const taken = take(3);
    taker.melds.push({ kind: 'kan', tiles: [...taken, tileId], from, added: false });
    s.pendingReplacementDraw = true;
    addKanDora(s);
    breakIppatsu(s);
    log(s, 'call', seat, tileId, `${taker.name} faz KONG`);
  } else if (offer.kind === 'chi') {
    const [a, b] = chiChoice ?? offer.chiOptions![0];
    taker.hand = taker.hand.filter((id) => id !== a && id !== b);
    taker.melds.push({ kind: 'chi', tiles: [a, b, tileId], from, added: false });
    breakIppatsu(s);
    log(s, 'call', seat, tileId, `${taker.name} faz CHOW`);
  }
  sortHand(s, seat);
  s.current = seat;
  if (offer.kind === 'kan') {
    s.phase = 'draw';
  } else {
    s.phase = 'discard';
  }
}

/** Concealed kong during own discard phase. */
export function declareAnkan(s: TradState, seat: number): boolean {
  if (s.current !== seat || s.phase !== 'discard') return false;
  const fIdx = canAnkan(s, seat);
  if (fIdx === null) return false;
  const p = s.players[seat];
  const taken = p.hand.filter((id) => faceIdxOf(s, id) === fIdx);
  p.hand = p.hand.filter((id) => faceIdxOf(s, id) !== fIdx);
  p.melds.push({ kind: 'ankan', tiles: taken, from: null, added: false });
  s.pendingReplacementDraw = true;
  addKanDora(s);
  s.phase = 'draw';
  log(s, 'call', seat, taken[0], `${p.name} faz KONG fechado`);
  rec(s, { t: 'ankan', seat });
  return true;
}

/** Added kong: opens a rob window (phase 'calls-rob'). */
export function declareAddedKong(s: TradState, seat: number): boolean {
  if (s.current !== seat || s.phase !== 'discard') return false;
  const p = s.players[seat];
  const meld = p.melds.find((m) => m.kind === 'pon' && !m.added &&
    p.hand.some((id) => faceIdxOf(s, id) === faceIdxOf(s, m.tiles[0])));
  if (!meld) return false;
  const fIdx = faceIdxOf(s, meld.tiles[0]);
  const tileId = p.hand.find((id) => faceIdxOf(s, id) === fIdx)!;
  rec(s, { t: 'addedkong', seat });
  // check if anyone can rob
  const robbers: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const other = (seat + i) % 4;
    if (canRonWith(s, other, tileId)) robbers.push(other);
  }
  s.robTarget = { seat, tileId };
  if (robbers.length > 0) {
    s.offers = robbers.map((r) => ({ seat: r, kind: 'ron' as const }));
    s.phase = 'calls-rob';
    log(s, 'call', seat, tileId, `${p.name} tenta adicionar KONG — janela de roubo`);
    return true;
  }
  completeAddedKong(s);
  return true;
}

function completeAddedKong(s: TradState): void {
  const { seat, tileId } = s.robTarget!;
  const p = s.players[seat];
  const fIdx = faceIdxOf(s, tileId);
  const meld = p.melds.find((m) => m.kind === 'pon' && faceIdxOf(s, m.tiles[0]) === fIdx);
  const i = p.hand.indexOf(tileId);
  if (i !== -1) p.hand.splice(i, 1);
  if (meld) {
    meld.kind = 'kan';
    meld.tiles.push(tileId);
    meld.added = true;
  }
  s.robTarget = null;
  s.pendingReplacementDraw = true;
  addKanDora(s);
  s.phase = 'draw';
  log(s, 'call', seat, tileId, `${p.name} adiciona KONG`);
}

/** each kan reveals the next dead-wall tile as dora indicator (riichi only).
 *  The tile STAYS on the dead wall (it is only flipped), keeping tile counts intact. */
function addKanDora(s: TradState) {
  if (s.ruleset.name !== 'Riichi') return;
  const idx = s.deadWall.length - 1 - s.doraIndicators.length;
  if (idx >= 0) s.doraIndicators.push(s.deadWall[idx]);
}

/** Resolve the rob window; decide(seat) returns true to rob. */
export function resolveRob(
  s: TradState,
  decide: (seat: number) => boolean | 'pending'
): 'resolved' | 'pending' {
  if (s.phase !== 'calls-rob') return 'resolved';
  const from = s.robTarget!.seat;
  const robSeats = s.offers.map((o) => o.seat).sort((a, b) => ((a - from + 4) % 4) - ((b - from + 4) % 4));
  for (const seat of robSeats) {
    const d = decide(seat);
    if (d === 'pending') return 'pending';
    rec(s, { t: 'rob', seat, yes: d });
    if (d) {
      const tileId = s.robTarget!.tileId;
      const kongSeat = s.robTarget!.seat;
      s.robTarget = null;
      s.offers = [];
      // score BEFORE moving the tile (scoreCandidate treats a ron tile as external)
      finishHandWithWin(s, seat, tileId, false, true, false, kongSeat);
      // then move the robbed tile from the kong player's hand to the winner's hand
      const ki = s.players[kongSeat].hand.indexOf(tileId);
      if (ki !== -1) s.players[kongSeat].hand.splice(ki, 1);
      s.players[seat].hand.push(tileId);
      return 'resolved';
    }
  }
  s.offers = [];
  completeAddedKong(s);
  return 'resolved';
}

function canRonWith(s: TradState, seat: number, tileId: number): boolean {
  const p = s.players[seat];
  const faces = handFaces(s, seat).concat(s.tiles[tileId].face);
  if (!s.ruleset.canWin(countsFromFaces(faces), p.melds.length)) return false;
  return scoreCandidate(s, seat, tileId, false, false, true).meetsMinimum;
}

/* ------------------------------------------------------------------ */
/* Winning & scoring                                                   */
/* ------------------------------------------------------------------ */

export function scoreCandidate(
  s: TradState,
  seat: number,
  tileId: number,
  selfDrawn: boolean,
  lastTile = false,
  robbedKong = false
): ScoringResult {
  const p = s.players[seat];
  const concealed = countsFromFaces(handFaces(s, seat).concat(selfDrawn ? [] : s.tiles[tileId].face));
  const melds: MeldLike[] = p.melds.map((m) => ({
    kind: m.kind === 'ankan' ? 'ankan' : m.kind,
    faces: m.tiles.map((t) => faceIdxOf(s, t)) as MeldLike['faces'],
  }));
  const flowers = p.bonus.filter((id) => s.tiles[id].face.suit === 'flower').length;
  const seasons = p.bonus.filter((id) => s.tiles[id].face.suit === 'season').length;
    // ura indicators are revealed only to a riichi winner, at win time
    if (p.riichi && s.uraIndicators.length === 0) {
      const L = s.deadWall.length;
      const n = s.doraIndicators.length;
      s.uraIndicators = s.deadWall.slice(Math.max(0, L - 2 * n), L - n);
    }
  const wFace = faceIdxOf(s, tileId);
  // copies of the winning tile visible to everyone BEFORE the win
  let winTileVisible = 0;
  for (const pl of s.players) {
    for (const d of pl.discards) if (faceIdxOf(s, d) === wFace) winTileVisible++;
    for (const m of pl.melds) {
      if (m.kind === 'ankan' && pl.seat !== seat) continue; // concealed kongs are hidden
      for (const t of m.tiles) if (faceIdxOf(s, t) === wFace) winTileVisible++;
    }
    if (pl.seat === seat) {
      // winner's own concealed copies (the winning tile itself is not counted)
      for (const t of pl.hand) if (t !== tileId && faceIdxOf(s, t) === wFace) winTileVisible++;
    }
  }
  return s.ruleset.score({
    concealedCounts: concealed,
    melds,
    winTileVisible,
    flowerRanks: p.bonus.filter((id) => s.tiles[id].face.suit === 'flower').map((id) => s.tiles[id].face.rank),
    seasonRanks: p.bonus.filter((id) => s.tiles[id].face.suit === 'season').map((id) => s.tiles[id].face.rank),
    winFace: wFace,
    selfDrawn,
    seatWind: seatWindOf(s, seat),
    roundWind: s.roundWind,
    flowers,
    seasons,
    winOnKong: selfDrawn && s.lastDrawWasReplacement,
    robbedKong,
    lastTile,
    riichi: p.riichi,
    ippatsu: p.ippatsu,
    doraIndicators: s.doraIndicators.map((id) => faceIdxOf(s, id)),
    uraIndicators: p.riichi ? s.uraIndicators.map((id) => faceIdxOf(s, id)) : [],
  });
}

export function declareTsumo(s: TradState, seat: number): boolean {
  if (!canTsumo(s, seat)) return false;
  rec(s, { t: 'tsumo', seat });
  const tileId = s.drawnTile!;
  finishHandWithWin(s, seat, tileId, true, false, s.wall.length === 0);
  return true;
}

function finishHandWithWin(
  s: TradState,
  seat: number,
  tileId: number,
  selfDrawn: boolean,
  robbedKong = false,
  lastTile = false,
  discardSeatOverride?: number
): void {
  const scoring = scoreCandidate(s, seat, tileId, selfDrawn, lastTile, robbedKong);
  const discardSeat = selfDrawn
    ? null
    : (discardSeatOverride ?? s.lastDiscard?.seat ?? null);
  const payments = s.ruleset.payments(scoring.points, selfDrawn, discardSeat, seat, s.dealer);
  for (let i = 0; i < 4; i++) {
    s.players[i].score -= payments[i];
    s.players[seat].score += payments[i];
  }
  s.result = { kind: 'win', winner: seat, selfDrawn, tileId, scoring, payments };
  s.phase = 'hand-over';
  s.offers = [];
  log(
    s,
    'win',
    seat,
    tileId,
    `${s.players[seat].name} vence (${selfDrawn ? 'TSUMO' : robbedKong ? 'ROUBO DO KONG' : 'RON'}) — ${scoring.totalFan} ${s.ruleset.id === 'riichi' ? 'han' : 'fan'}, ${scoring.points} pontos`
  );
}

export function nextHandOrEnd(s: TradState): void {
  rec(s, { t: 'next-hand' });
  if (s.phase !== 'hand-over') return;
  if (s.handNumber >= s.ruleset.handsPerMatch) {
    s.phase = 'match-over';
    log(s, 'match-over', undefined, undefined, 'Fim da partida');
    return;
  }
  // dealer retention
  if (s.ruleset.renchan && s.result?.kind === 'win' && s.result.winner === s.dealer) {
    // dealer stays
  } else {
    s.dealer = (s.dealer + 1) % 4;
  }
  s.handNumber += 1;
  startHand(s);
}

/* ------------------------------------------------------------------ */
/* Public views (no hidden info leakage)                               */
/* ------------------------------------------------------------------ */

export interface PublicPlayer {
  seat: number;
  name: string;
  isHuman: boolean;
  handCount: number;
  melds: { kind: MeldKind; faces: ReturnType<typeof faceOf>[]; added: boolean }[];
  bonusCount: number;
  bonusFaces: ReturnType<typeof faceOf>[];
  discards: ReturnType<typeof faceOf>[];
  score: number;
  riichi: boolean;
}

export interface PublicState {
  phase: Phase;
  current: number;
  dealer: number;
  roundWind: number;
  handNumber: number;
  wallCount: number;
  players: PublicPlayer[];
  lastDiscard: { face: ReturnType<typeof faceOf>; seat: number } | null;
  offers: Offer[];
  result: HandResult | null;
  events: GameEvent[];
  /** only present for the human's own seat */
  myHand?: { seat: number; tiles: { id: number; face: ReturnType<typeof faceOf> }[] };
  drawnTile?: number | null;
}

export function publicView(s: TradState, viewerSeat: number): PublicState {
  return {
    phase: s.phase,
    current: s.current,
    dealer: s.dealer,
    roundWind: s.roundWind,
    handNumber: s.handNumber,
    wallCount: s.wall.length,
    players: s.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      isHuman: p.isHuman,
      handCount: p.hand.length,
      melds: p.melds.map((m) => ({
        kind: m.kind,
        faces: m.tiles.map((t) => faceOf(s, t)),
        added: m.added,
      })),
      bonusCount: p.bonus.length,
      bonusFaces: p.bonus.map((id) => faceOf(s, id)),
      discards: p.discards.map((id) => faceOf(s, id)),
      score: p.score,
      riichi: p.riichi,
    })),
    lastDiscard: s.lastDiscard ? { face: faceOf(s, s.lastDiscard.tileId), seat: s.lastDiscard.seat } : null,
    offers: s.offers,
    result: s.result,
    events: s.events,
    myHand: viewerSeat >= 0 ? {
      seat: viewerSeat,
      tiles: s.players[viewerSeat].hand.map((id) => ({ id, face: faceOf(s, id) })),
    } : undefined,
    drawnTile: s.drawnTile,
  };
}

/** Wait tiles for the human seat (for UI hints; counts as public info about own hand). */
export function myWaits(s: TradState, seat: number): number[] {
  const p = s.players[seat];
  // hand must be 3n+1 for waits
  if (p.hand.length % 3 !== 1) return [];
  return winningWaits(handCounts(s, seat), p.melds.length);
}

export { BASIC_FACES };


/* ------------------------------------------------------------------ */
/* Deterministic replay                                                */
/* ------------------------------------------------------------------ */

/** Serializable replay record: seed + every external input. */
export interface ReplayRecord {
  rulesetId: string;
  seed: number;
  actions: ReplayAction[];
}

export function serializeReplay(s: TradState): ReplayRecord {
  return { rulesetId: s.ruleset.id, seed: s.replay.seed, actions: s.replay.actions };
}

/**
 * Re-applies a recorded match from its seed. The rng (mulberry32) is fully
 * determined by the seed, and every external input (draws, discards, calls,
 * decisions, wins) is in the action log — so the resulting state is
 * bit-identical to the original at the same point of the match.
 */
export function replayMatch(ruleset: Ruleset, record: { seed: number; actions: ReplayAction[] }): TradState {
  const s = newMatch(ruleset, record.seed);
  s.recording = false; // do not re-record while replaying
  const actions = record.actions;
  let i = 0;
  let guard = 0;
  const limit = actions.length * 4 + 1000;
  while (guard++ < limit) {
    if (s.phase === 'calls') {
      const res = resolveCalls(s, (seat) => {
        const a = actions[i];
        if (!a || a.t !== 'decision' || a.seat !== seat) return 'pending';
        i++;
        if (a.kind === 'pass') return { offer: null };
        const offer = s.offers.find((o) => o.seat === seat && o.kind === a.kind);
        return offer ? { offer, chiChoice: a.chiChoice } : { offer: null };
      });
      if (res === 'pending') break;
      continue;
    }
    if (s.phase === 'calls-rob') {
      const res = resolveRob(s, (seat) => {
        const a = actions[i];
        if (!a || a.t !== 'rob' || a.seat !== seat) return 'pending';
        i++;
        return a.yes;
      });
      if (res === 'pending') break;
      continue;
    }
    if (i >= actions.length) break;
    const a = actions[i++];
    switch (a.t) {
      case 'draw': drawTile(s); break;
      case 'discard': discard(s, a.tileId); break;
      case 'riichi': declareRiichi(s, a.seat); break;
      case 'tsumo': declareTsumo(s, a.seat); break;
      case 'ankan': declareAnkan(s, a.seat); break;
      case 'addedkong': declareAddedKong(s, a.seat); break;
      case 'next-hand': nextHandOrEnd(s); break;
      default: break; // decisions are consumed inside the resolve phases
    }
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Tenpai information for the UI                                       */
/* ------------------------------------------------------------------ */

export interface WaitInfo {
  face: number;
  /** copies of this face not visible anywhere (hand+ponds+open melds) */
  left: number;
}

/**
 * Which faces would complete `seat`'s hand (given `handF`) and how many
 * copies of each are still available. Uses the ruleset's own canWin, so it
 * honours alternative shapes (seven pairs, orphans, MCR knitted hands).
 */
export function waitsWithCounts(s: TradState, seat: number, handF: Tile['face'][]): WaitInfo[] {
  const p = s.players[seat];
  const meldCount = p.melds.length;
  const visible = new Array(34).fill(0);
  for (const pl of s.players) {
    for (const id of pl.discards) visible[faceIdxOf(s, id)]++;
    for (const m of pl.melds) {
      if (m.kind === 'ankan') continue; // concealed kongs are not public info
      for (const id of m.tiles) visible[faceIdxOf(s, id)]++;
    }
  }
  const cc = countsFromFaces(handF);
  for (let f = 0; f < 34; f++) visible[f] += cc[f];
  const out: WaitInfo[] = [];
  for (let f = 0; f < 34; f++) {
    if (cc[f] >= 4) continue;
    cc[f]++;
    if (s.ruleset.canWin(cc, meldCount)) out.push({ face: f, left: Math.max(0, 4 - visible[f]) });
    cc[f]--;
  }
  return out;
}
