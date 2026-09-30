import type { TilePos } from '../layouts/types';
import type { TileFace, MatchMode } from '../tiles/tiles';
import { BASIC_FACES, facesMatch } from '../tiles/tiles';
import type { Rng } from '../tiles/rng';
import { shuffle } from '../tiles/rng';
import type { SolTile } from './engine';
import { solveBoard } from '../solver/solver';

/**
 * Board generator using REVERSE CONSTRUCTION:
 *
 * Start with every layout position "on the board". Repeatedly pick two
 * positions that are currently FREE (same geometry rules as the game),
 * assign them a matching face pair from the bag, and remove them from the
 * remaining set. The assignment order, reversed, is a valid solution —
 * so the produced board is solvable BY CONSTRUCTION.
 *
 * The result is additionally VERIFIED with the exact solver
 * (solveBoard) before being accepted; if verification fails the
 * generator retries with a fresh seed (bounded).
 */

export interface DealOptions {
  /** use the 8 bonus tiles (flowers/seasons)? Requires tileCount === 144. */
  includeBonus?: boolean;
  maxRetries?: number;
  /** solver node budget for verification */
  solverMaxNodes?: number;
}

export interface DealResult {
  faces: TileFace[]; // index-aligned with positions
  verified: boolean;
  attempts: number;
  solverNodes: number;
}

function overlaps(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) < 2 && Math.abs(ay - by) < 2;
}

function freeIndices(positions: TilePos[], alive: Uint8Array): number[] {
  const free: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    if (!alive[i]) continue;
    const p = positions[i];
    let covered = false, left = false, right = false;
    for (let j = 0; j < positions.length; j++) {
      if (!alive[j] || j === i) continue;
      const q = positions[j];
      if (q.layer === p.layer + 1 && overlaps(q.x, q.y, p.x, p.y)) { covered = true; break; }
    }
    if (covered) continue;
    for (let j = 0; j < positions.length; j++) {
      if (!alive[j] || j === i) continue;
      const q = positions[j];
      if (q.layer === p.layer && Math.abs(q.y - p.y) < 2) {
        if (q.x === p.x - 2) left = true;
        else if (q.x === p.x + 2) right = true;
      }
    }
    if (!left || !right) free.push(i);
  }
  return free;
}

/**
 * Build a bag of face-PAIRS for `n` tiles (n must be even).
 * - n === 144 && includeBonus: the standard set (34 faces x2 pairs + 4 flower pairs + 4 season pairs).
 * - otherwise: basic faces cycled 4-at-a-time (always pairable).
 */
export function buildPairBag(n: number, includeBonus: boolean, rng: Rng): [TileFace, TileFace][] {
  if (n % 2 !== 0) throw new Error('tile count must be even');
  const pairs = n / 2;
  const bag: [TileFace, TileFace][] = [];
  if (n === 144 && includeBonus) {
    // 34 basic faces x 2 pairs = 68 pairs (136 tiles)
    for (const f of BASIC_FACES) { bag.push([f, f]); bag.push([f, f]); }
    // 4 flowers = 2 pairs, 4 seasons = 2 pairs (8 tiles) -> 72 pairs total
    const flowers: TileFace[] = [1, 2, 3, 4].map((r) => ({ suit: 'flower', rank: r }));
    const seasons: TileFace[] = [1, 2, 3, 4].map((r) => ({ suit: 'season', rank: r }));
    shuffle(flowers, rng);
    shuffle(seasons, rng);
    bag.push([flowers[0], flowers[1]]);
    bag.push([flowers[2], flowers[3]]);
    bag.push([seasons[0], seasons[1]]);
    bag.push([seasons[2], seasons[3]]);
    return shuffle(bag, rng);
  }
  for (let i = 0; i < pairs; i++) {
    const f = BASIC_FACES[(i * 2) % BASIC_FACES.length];
    bag.push([f, f]);
  }
  return shuffle(bag, rng);
}

function reverseFill(positions: TilePos[], bag: [TileFace, TileFace][], rng: Rng): TileFace[] | null {
  const faces: (TileFace | null)[] = new Array(positions.length).fill(null);
  const alive = new Uint8Array(positions.length).fill(1);
  const bagCopy = [...bag];
  for (let step = 0; step < bagCopy.length; step++) {
    const free = freeIndices(positions, alive);
    if (free.length < 2) return null; // stuck -> caller retries
    // pick two distinct free positions
    const i1 = free[rng.nextInt(free.length)];
    let i2 = free[rng.nextInt(free.length)];
    let guard = 0;
    while (i2 === i1 && guard++ < 32) i2 = free[rng.nextInt(free.length)];
    if (i2 === i1) {
      i2 = free.find((x) => x !== i1)!;
    }
    const [fa, fb] = bagCopy[step];
    faces[i1] = fa;
    faces[i2] = fb;
    alive[i1] = 0;
    alive[i2] = 0;
  }
  return faces as TileFace[];
}

export function dealSolvable(
  positions: TilePos[],
  rng: Rng,
  opts: DealOptions = {}
): DealResult {
  const includeBonus = opts.includeBonus ?? positions.length === 144;
  const maxRetries = opts.maxRetries ?? 24;
  let attempts = 0;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    attempts++;
    const bag = buildPairBag(positions.length, includeBonus, rng);
    const faces = reverseFill(positions, bag, rng);
    if (!faces) continue;
    // VERIFY with the exact solver — never claim solvability without validation.
    const tiles: SolTile[] = positions.map((pos, i) => ({ id: i, face: faces[i], pos, removed: false }));
    const res = solveBoard(tiles, includeBonus ? 'classic' : 'strict', {
      maxNodes: opts.solverMaxNodes ?? 300_000,
      maxTimeMs: 5000,
    });
    if (res.status === 'solved') return { faces, verified: true, attempts, solverNodes: res.nodes };
    // 'unknown' (limit hit) or 'unsolvable' -> retry
  }
  throw new Error(`dealSolvable: failed to produce a verified solvable board in ${attempts} attempts`);
}

/** Faces currently on non-removed tiles (for shuffles). */
export function remainingFaces(tiles: SolTile[], matchMode: MatchMode): TileFace[] {
  const faces = tiles.filter((t) => !t.removed).map((t) => t.face);
  // keep the pool pairable: sort so matching faces stay adjacent count-wise is unnecessary;
  // shuffles can create deadlocks by design (that is part of the game), but we ensure the
  // multiset is unchanged.
  void matchMode;
  return faces;
}

export function poolIsPairable(faces: TileFace[], matchMode: MatchMode): boolean {
  const used = new Uint8Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    if (used[i]) continue;
    let found = false;
    for (let j = i + 1; j < faces.length; j++) {
      if (!used[j] && facesMatch(faces[i], faces[j], matchMode)) { used[j] = 1; found = true; break; }
    }
    if (!found) return false;
    used[i] = 1;
  }
  return true;
}
