import type { SolTile } from '../solitaire/engine';
import { facesMatch, type MatchMode } from '../tiles/tiles';

/**
 * Solitaire solver: depth-first search over "remaining tile set" states.
 *
 * Guarantees & limits (documented):
 *  - Uses a visited-state table (transposition table) so identical
 *    remaining-sets are never expanded twice.
 *  - `maxNodes` bounds the search. When the bound is hit without a
 *    conclusion we return status 'unknown' — we NEVER claim
 *    unsolvability without exhausting the search.
 *  - Move ordering prefers pairs on higher layers (they unlock more),
 *    which makes typical generated boards solve in a few hundred nodes.
 */

export interface SolverOptions {
  maxNodes?: number;
  maxTimeMs?: number;
}

export type SolverStatus = 'solved' | 'unsolvable' | 'unknown';

export interface SolverResult {
  status: SolverStatus;
  /** tile id pairs in removal order (only when solved) */
  moves?: [number, number][];
  nodes: number;
  ms: number;
}

interface Ctx {
  tiles: SolTile[];
  matchMode: MatchMode;
  maxNodes: number;
  deadline: number;
  nodes: number;
  timedOut: boolean;
  visited: Set<string>;
}

function keyOf(remaining: number[]): string {
  // remaining is kept sorted; join is compact enough for typical boards
  return remaining.join(',');
}

function overlaps(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) < 2 && Math.abs(ay - by) < 2;
}

/** Compute free tiles among `remaining` (indices into ctx.tiles). */
function computeFree(ctx: Ctx, remaining: number[]): number[] {
  const alive = new Uint8Array(ctx.tiles.length);
  for (const i of remaining) alive[i] = 1;
  const free: number[] = [];
  for (const i of remaining) {
    const t = ctx.tiles[i].pos;
    let covered = false, left = false, right = false;
    for (const j of remaining) {
      if (j === i) continue;
      const o = ctx.tiles[j].pos;
      if (o.layer === t.layer + 1 && overlaps(o.x, o.y, t.x, t.y)) { covered = true; break; }
    }
    if (covered) continue;
    for (const j of remaining) {
      if (j === i) continue;
      const o = ctx.tiles[j].pos;
      if (o.layer === t.layer && Math.abs(o.y - t.y) < 2) {
        if (o.x === t.x - 2) left = true;
        else if (o.x === t.x + 2) right = true;
      }
    }
    if (!left || !right) free.push(i);
  }
  return free;
}

function dfs(ctx: Ctx, remaining: number[], path: [number, number][]): boolean {
  if (remaining.length === 0) return true;
  if (ctx.nodes >= ctx.maxNodes) return false;
  if (Date.now() > ctx.deadline) { ctx.timedOut = true; return false; }
  const key = keyOf(remaining);
  if (ctx.visited.has(key)) return false;
  ctx.visited.add(key);
  ctx.nodes++;

  const free = computeFree(ctx, remaining);
  // candidate pairs
  const pairs: [number, number][] = [];
  for (let a = 0; a < free.length; a++)
    for (let b = a + 1; b < free.length; b++)
      if (facesMatch(ctx.tiles[free[a]].face, ctx.tiles[free[b]].face, ctx.matchMode))
        pairs.push([free[a], free[b]]);
  // order: higher layers first
  pairs.sort((p, q) => {
    const sp = Math.max(ctx.tiles[p[0]].pos.layer, ctx.tiles[p[1]].pos.layer);
    const sq = Math.max(ctx.tiles[q[0]].pos.layer, ctx.tiles[q[1]].pos.layer);
    return sq - sp;
  });

  const remSet = new Set(remaining);
  for (const [a, b] of pairs) {
    remSet.delete(a);
    remSet.delete(b);
    const next = [...remSet].sort((x, y) => x - y);
    path.push([a, b]);
    if (dfs(ctx, next, path)) return true;
    path.pop();
    remSet.add(a);
    remSet.add(b);
    if (ctx.timedOut) return false;
  }
  return false;
}

/**
 * Solve a board described by its tiles (with faces). Removed tiles are ignored.
 */
export function solveBoard(
  tiles: SolTile[],
  matchMode: MatchMode = 'classic',
  opts: SolverOptions = {}
): SolverResult {
  const t0 = Date.now();
  const ctx: Ctx = {
    tiles,
    matchMode,
    maxNodes: opts.maxNodes ?? 300_000,
    deadline: t0 + (opts.maxTimeMs ?? 5000),
    nodes: 0,
    timedOut: false,
    visited: new Set(),
  };
  const remaining = tiles.filter((t) => !t.removed).map((t) => t.id).sort((a, b) => a - b);
  const path: [number, number][] = [];
  const solved = dfs(ctx, remaining, path);
  const ms = Date.now() - t0;
  if (solved) return { status: 'solved', moves: path, nodes: ctx.nodes, ms };
  if (ctx.timedOut || ctx.nodes >= ctx.maxNodes)
    return { status: 'unknown', nodes: ctx.nodes, ms };
  // Search space exhausted: provably unsolvable from this position.
  return { status: 'unsolvable', nodes: ctx.nodes, ms };
}

/** Fast randomized solver: repeatedly picks a random legal pair; k tries. */
export function greedySolve(
  tiles: SolTile[],
  matchMode: MatchMode,
  rng: { nextInt(n: number): number },
  tries = 40
): SolverResult {
  const t0 = Date.now();
  let nodes = 0;
  for (let attempt = 0; attempt < tries; attempt++) {
    const alive = tiles.filter((t) => !t.removed);
    const removedLocal = new Set<number>();
    const path: [number, number][] = [];
    let progress = true;
    while (alive.length - removedLocal.size > 0 && progress) {
      progress = false;
      const view = alive.map((t) => ({ ...t, removed: removedLocal.has(t.id) }));
      const free = computeFree(
        { tiles: view, matchMode } as Ctx,
        view.filter((t) => !t.removed).map((t) => t.id)
      );
      const idToTile = new Map(view.map((t) => [t.id, t]));
      const pairs: [number, number][] = [];
      for (let a = 0; a < free.length; a++)
        for (let b = a + 1; b < free.length; b++) {
          const ta = idToTile.get(free[a])!;
          const tb = idToTile.get(free[b])!;
          if (facesMatch(ta.face, tb.face, matchMode)) pairs.push([free[a], free[b]]);
        }
      nodes++;
      if (pairs.length > 0) {
        const [a, b] = pairs[rng.nextInt(pairs.length)];
        removedLocal.add(a);
        removedLocal.add(b);
        path.push([a, b]);
        progress = true;
      }
    }
    if (alive.length - removedLocal.size === 0)
      return { status: 'solved', moves: path, nodes, ms: Date.now() - t0 };
  }
  return { status: 'unknown', nodes, ms: Date.now() - t0 };
}
