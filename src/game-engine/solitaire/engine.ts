import type { TileFace, MatchMode } from '../tiles/tiles';
import { facesMatch } from '../tiles/tiles';
import type { TilePos } from '../layouts/types';

/**
 * Mahjong Solitaire engine — pure, deterministic, UI-independent.
 *
 * A tile occupies a 2x2 square of half-units at (x, y) on `layer`.
 * FREE  := no tile on layer+1 overlaps it AND (no left neighbour OR no right neighbour)
 *          where a neighbour is a same-layer tile whose x differs by exactly 2 and y-range overlaps.
 */

export interface SolTile {
  id: number;
  face: TileFace;
  pos: TilePos;
  removed: boolean;
}

export type SolStatus = 'playing' | 'won' | 'deadlock';

export interface SolitaireSnapshot {
  tiles: SolTile[];
  score: number;
  streak: number;
  moves: number;
  shufflesUsed: number;
  hintsUsed: number;
}

export interface SolitaireState {
  layoutId: string;
  seed: number;
  matchMode: MatchMode;
  tiles: SolTile[];
  history: SolitaireSnapshot[]; // undo stack
  future: SolitaireSnapshot[]; // redo stack
  score: number;
  streak: number;
  moves: number;
  shufflesUsed: number;
  hintsUsed: number;
  status: SolStatus;
  elapsedMs: number;
}

export interface SolitaireOptions {
  layoutId: string;
  /** pre-assigned faces, index-aligned with layout positions. Produced by the generator. */
  faces: TileFace[];
  positions: TilePos[];
  seed: number;
  matchMode?: MatchMode;
}

/* ---------- geometry ---------- */

const overlaps = (a: TilePos, b: TilePos) =>
  Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;

export function isCovered(tile: SolTile, tiles: SolTile[]): boolean {
  return tiles.some(
    (t) => !t.removed && t.pos.layer === tile.pos.layer + 1 && overlaps(t.pos, tile.pos)
  );
}

function hasNeighbour(tile: SolTile, tiles: SolTile[], dx: number): boolean {
  return tiles.some(
    (t) =>
      !t.removed &&
      t.pos.layer === tile.pos.layer &&
      t.pos.x === tile.pos.x + dx &&
      Math.abs(t.pos.y - tile.pos.y) < 2
  );
}

export function isFree(tile: SolTile, tiles: SolTile[]): boolean {
  if (tile.removed) return false;
  if (isCovered(tile, tiles)) return false;
  return !hasNeighbour(tile, tiles, -2) || !hasNeighbour(tile, tiles, 2);
}

export function freeTiles(state: SolitaireState): SolTile[] {
  return state.tiles.filter((t) => isFree(t, state.tiles));
}

export function remainingCount(state: SolitaireState): number {
  return state.tiles.reduce((n, t) => n + (t.removed ? 0 : 1), 0);
}

/* ---------- pairs / hints ---------- */

export interface SolPair {
  a: SolTile;
  b: SolTile;
}

/** All legal pairs among free tiles. */
export function legalPairs(state: SolitaireState): SolPair[] {
  const free = freeTiles(state);
  const pairs: SolPair[] = [];
  for (let i = 0; i < free.length; i++)
    for (let j = i + 1; j < free.length; j++)
      if (facesMatch(free[i].face, free[j].face, state.matchMode))
        pairs.push({ a: free[i], b: free[j] });
  return pairs;
}

export function hint(state: SolitaireState): SolPair | null {
  const pairs = legalPairs(state);
  if (pairs.length === 0) return null;
  // Prefer pairs on higher layers / more covered tiles (they unlock more).
  const score = (t: SolTile) =>
    t.pos.layer * 2 +
    state.tiles.filter(
      (o) => !o.removed && o.pos.layer === t.pos.layer + 1 && overlaps(o.pos, t.pos)
    ).length;
  pairs.sort((p, q) => score(q.a) + score(q.b) - (score(p.a) + score(p.b)));
  return pairs[0];
}

export function hasMoves(state: SolitaireState): boolean {
  const free = freeTiles(state);
  for (let i = 0; i < free.length; i++)
    for (let j = i + 1; j < free.length; j++)
      if (facesMatch(free[i].face, free[j].face, state.matchMode)) return true;
  return false;
}

/* ---------- state transitions ---------- */

function snapshot(s: SolitaireState): SolitaireSnapshot {
  return {
    tiles: s.tiles.map((t) => ({ ...t, face: { ...t.face }, pos: { ...t.pos } })),
    score: s.score,
    streak: s.streak,
    moves: s.moves,
    shufflesUsed: s.shufflesUsed,
    hintsUsed: s.hintsUsed,
  };
}

const HISTORY_CAP = 200;

function pushHistory(s: SolitaireState): void {
  s.history.push(snapshot(s));
  if (s.history.length > HISTORY_CAP) s.history.shift();
  s.future = [];
}

export function createSolitaire(opts: SolitaireOptions): SolitaireState {
  if (opts.faces.length !== opts.positions.length)
    throw new Error('faces/positions length mismatch');
  const tiles: SolTile[] = opts.positions.map((pos, i) => ({
    id: i,
    face: opts.faces[i],
    pos,
    removed: false,
  }));
  return {
    layoutId: opts.layoutId,
    seed: opts.seed,
    matchMode: opts.matchMode ?? 'classic',
    tiles,
    history: [],
    future: [],
    score: 0,
    streak: 0,
    moves: 0,
    shufflesUsed: 0,
    hintsUsed: 0,
    status: 'playing',
    elapsedMs: 0,
  };
}

export type MoveError = 'not-free' | 'not-matching' | 'same-tile' | 'removed' | 'game-over';

export interface MoveResult {
  ok: boolean;
  error?: MoveError;
  state: SolitaireState;
}

/** Score: base 10 per pair + 2 per consecutive-match streak level (max +10). */
export function pairScore(streakAfter: number): number {
  return 10 + Math.min(Math.max(streakAfter - 1, 0), 5) * 2;
}

export function attemptPair(state: SolitaireState, idA: number, idB: number): MoveResult {
  if (state.status !== 'playing') return { ok: false, error: 'game-over', state };
  if (idA === idB) return { ok: false, error: 'same-tile', state };
  const a = state.tiles[idA];
  const b = state.tiles[idB];
  if (!a || !b) return { ok: false, error: 'removed', state };
  if (a.removed || b.removed) return { ok: false, error: 'removed', state };
  if (!isFree(a, state.tiles) || !isFree(b, state.tiles))
    return { ok: false, error: 'not-free', state };
  if (!facesMatch(a.face, b.face, state.matchMode))
    return { ok: false, error: 'not-matching', state };

  pushHistory(state);
  a.removed = true;
  b.removed = true;
  state.streak += 1;
  state.score += pairScore(state.streak);
  state.moves += 1;
  if (remainingCount(state) === 0) state.status = 'won';
  else if (!hasMoves(state)) state.status = 'deadlock';
  return { ok: true, state };
}

export function canMatch(state: SolitaireState, idA: number, idB: number): boolean {
  return attemptPair(structuralClone(state), idA, idB).ok;
}

export function undo(state: SolitaireState): SolitaireState {
  const snap = state.history.pop();
  if (!snap) return state;
  state.future.push(snapshot(state));
  return restore(state, snap);
}

export function redo(state: SolitaireState): SolitaireState {
  const snap = state.future.pop();
  if (!snap) return state;
  state.history.push(snapshot(state));
  return restore(state, snap);
}

function restore(state: SolitaireState, snap: SolitaireSnapshot): SolitaireState {
  state.tiles = snap.tiles;
  state.score = snap.score;
  state.streak = snap.streak;
  state.moves = snap.moves;
  state.shufflesUsed = snap.shufflesUsed;
  state.hintsUsed = snap.hintsUsed;
  state.status =
    remainingCount(state) === 0 ? 'won' : hasMoves(state) ? 'playing' : 'deadlock';
  return state;
}

/**
 * Shuffle the faces of the remaining tiles (positions untouched).
 * Pure w.r.t. the given rng — callers pass a deterministic rng for reproducibility.
 */
export function shuffleRemaining(state: SolitaireState, facesPool: TileFace[]): SolitaireState {
  pushHistory(state);
  const remaining = state.tiles.filter((t) => !t.removed);
  if (facesPool.length !== remaining.length) throw new Error('shuffle pool size mismatch');
  remaining.forEach((t, i) => (t.face = facesPool[i]));
  state.shufflesUsed += 1;
  state.status = hasMoves(state) ? 'playing' : 'deadlock';
  return state;
}

export function useHint(state: SolitaireState): SolitaireState {
  state.hintsUsed += 1;
  return state;
}

/** Reset to the initial position (faces as dealt), clearing history. */
export function restart(state: SolitaireState, initialFaces: TileFace[]): SolitaireState {
  state.tiles.forEach((t, i) => {
    t.removed = false;
    t.face = initialFaces[i];
  });
  state.history = [];
  state.future = [];
  state.score = 0;
  state.streak = 0;
  state.moves = 0;
  state.shufflesUsed = 0;
  state.hintsUsed = 0;
  state.status = 'playing';
  state.elapsedMs = 0;
  return state;
}

/* ---------- serialization ---------- */

export function serializeSolitaire(state: SolitaireState): string {
  return JSON.stringify({
    v: 1,
    layoutId: state.layoutId,
    seed: state.seed,
    matchMode: state.matchMode,
    tiles: state.tiles.map((t) => [t.id, t.face.suit, t.face.rank, t.pos.layer, t.pos.x, t.pos.y, t.removed ? 1 : 0]),
    score: state.score,
    streak: state.streak,
    moves: state.moves,
    shufflesUsed: state.shufflesUsed,
    hintsUsed: state.hintsUsed,
    status: state.status,
    elapsedMs: state.elapsedMs,
  });
}

export function deserializeSolitaire(json: string): SolitaireState {
  const d = JSON.parse(json);
  if (d.v !== 1) throw new Error('unsupported solitaire save version');
  const tiles: SolTile[] = d.tiles.map((t: [number, string, number, number, number, number, number]) => ({
    id: t[0],
    face: { suit: t[1] as TileFace['suit'], rank: t[2] },
    pos: { layer: t[3], x: t[4], y: t[5] },
    removed: t[6] === 1,
  }));
  return {
    layoutId: d.layoutId,
    seed: d.seed,
    matchMode: d.matchMode,
    tiles,
    history: [],
    future: [],
    score: d.score,
    streak: d.streak,
    moves: d.moves,
    shufflesUsed: d.shufflesUsed,
    hintsUsed: d.hintsUsed,
    status: d.status,
    elapsedMs: d.elapsedMs,
  };
}

/** deep clone without structuredClone (jsdom/node compat) */
export function structuralClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
