import type { Tile } from '../tiles/tiles';
import { buildFullSet, faceIndex, isBonus, BASIC_FACES } from '../tiles/tiles';
import { createRng, shuffle, type Rng } from '../tiles/rng';
import type { HKRules } from '../rules/hongkong';
import { HK_DEFAULTS } from '../rules/hongkong';
import { countsFromFaces, isCompleteHand, winningWaits, type Counts } from './hand';
import { computeScoring, computePayments, type MeldLike, type ScoringResult } from '../scoring/hongkong-scoring';

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
  config: HKRules;
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
  config: HKRules = HK_DEFAULTS,
  seed = Date.now() >>> 0,
  names = ['Você', 'Bot Sul', 'Bot Oeste', 'Bot Norte']
): TradState {
  const tiles = buildFullSet();
  const s: TradState = {
    config,
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
  }
  s.lastDiscard = null;
  s.offers = [];
  s.result = null;
  s.pendingReplacementDraw = false;
  s.lastDrawWasReplacement = false;
  s.drawnTile = null;
  s.robTarget = null;
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
  return [...new Set(s.players[seat].hand)];
}

export function discard(s: TradState, tileId: number): boolean {
  if (s.phase !== 'discard' || s.current < 0) return false;
  const p = s.players[s.current];
  const idx = p.hand.indexOf(tileId);
  if (idx === -1) return false;
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
  if (!isCompleteHand(countsFromFaces(faces), p.melds.length)) return false;
  // minimum fan check with provisional context
  const scoring = scoreCandidate(s, seat, tileId, false);
  return scoring.meetsMinimum;
}

export function canTsumo(s: TradState, seat: number): boolean {
  const p = s.players[seat];
  if (s.current !== seat || s.phase !== 'discard') return false;
  if (s.drawnTile === null) return false; // win requires an actual drawn tile (not after a call)
  if (!isCompleteHand(handCounts(s, seat), p.melds.length)) return false;
  const lastTile = !s.lastDrawWasReplacement && s.wall.length === 0;
  const scoring = scoreCandidate(s, seat, s.drawnTile, true, lastTile);
  return scoring.meetsMinimum;
}

export function canAnkan(s: TradState, seat: number): number | null {
  if (s.current !== seat || s.phase !== 'discard') return null;
  const counts = handCounts(s, seat);
  for (let i = 0; i < 34; i++) if (counts[i] === 4) return i;
  return null;
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
    log(s, 'call', seat, tileId, `${taker.name} faz PON`);
  } else if (offer.kind === 'kan') {
    const taken = take(3);
    taker.melds.push({ kind: 'kan', tiles: [...taken, tileId], from, added: false });
    s.pendingReplacementDraw = true;
    log(s, 'call', seat, tileId, `${taker.name} faz KONG`);
  } else if (offer.kind === 'chi') {
    const [a, b] = chiChoice ?? offer.chiOptions![0];
    taker.hand = taker.hand.filter((id) => id !== a && id !== b);
    taker.melds.push({ kind: 'chi', tiles: [a, b, tileId], from, added: false });
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
  s.phase = 'draw';
  log(s, 'call', seat, taken[0], `${p.name} faz KONG fechado`);
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
  s.phase = 'draw';
  log(s, 'call', seat, tileId, `${p.name} adiciona KONG`);
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
  if (!isCompleteHand(countsFromFaces(faces), p.melds.length)) return false;
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
  return computeScoring({
    concealedCounts: concealed,
    melds,
    winFace: faceIdxOf(s, tileId),
    selfDrawn,
    seatWind: seatWindOf(s, seat),
    roundWind: s.roundWind,
    flowers,
    seasons,
    winOnKong: selfDrawn && s.lastDrawWasReplacement,
    robbedKong,
    lastTile,
    rules: s.config,
  });
}

export function declareTsumo(s: TradState, seat: number): boolean {
  if (!canTsumo(s, seat)) return false;
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
  const payments = computePayments(s.config, scoring.points, selfDrawn, discardSeat, seat);
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
    `${s.players[seat].name} vence (${selfDrawn ? 'TSUMO' : robbedKong ? 'ROUBO DO KONG' : 'RON'}) — ${scoring.totalFan} fan, ${scoring.points} pontos`
  );
}

export function nextHandOrEnd(s: TradState): void {
  if (s.phase !== 'hand-over') return;
  if (s.handNumber >= s.config.handsPerMatch) {
    s.phase = 'match-over';
    log(s, 'match-over', undefined, undefined, 'Fim da partida');
    return;
  }
  // dealer retention
  if (s.config.renchan && s.result?.kind === 'win' && s.result.winner === s.dealer) {
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
    })),
    lastDiscard: s.lastDiscard ? { face: faceOf(s, s.lastDiscard.tileId), seat: s.lastDiscard.seat } : null,
    offers: s.offers,
    result: s.result,
    events: s.events,
    myHand: {
      seat: viewerSeat,
      tiles: s.players[viewerSeat].hand.map((id) => ({ id, face: faceOf(s, id) })),
    },
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
