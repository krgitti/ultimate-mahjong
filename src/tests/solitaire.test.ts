import { describe, it, expect } from 'vitest';
import {
  createSolitaire,
  isFree,
  isCovered,
  attemptPair,
  undo,
  redo,
  hasMoves,
  legalPairs,
  hint,
  remainingCount,
  serializeSolitaire,
  deserializeSolitaire,
  shuffleRemaining,
  pairScore,
  type SolitaireState,
  type SolTile,
} from '../game-engine/solitaire/engine';
import { dealSolvable, buildPairBag, poolIsPairable } from '../game-engine/solitaire/generator';
import { solveBoard, greedySolve } from '../game-engine/solver/solver';
import { createRng } from '../game-engine/tiles/rng';
import { layoutPositions, getLayout, listLayouts } from '../game-engine/layouts';
import type { TileFace } from '../game-engine/tiles/tiles';

const f = (suit: TileFace['suit'], rank: number): TileFace => ({ suit, rank });

function tile(id: number, face: TileFace, layer: number, x: number, y: number, removed = false): SolTile {
  return { id, face, pos: { layer, x, y }, removed };
}

function stateOf(tiles: SolTile[]): SolitaireState {
  return {
    layoutId: 'test',
    seed: 1,
    matchMode: 'classic',
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

describe('solitaire: free / covered / blocked tiles', () => {
  it('a lone tile is free', () => {
    const t = tile(0, f('man', 1), 0, 0, 0);
    expect(isFree(t, [t])).toBe(true);
  });

  it('a tile covered from above is not free', () => {
    const bottom = tile(0, f('man', 1), 0, 0, 0);
    const top = tile(1, f('man', 2), 1, 0, 0);
    expect(isCovered(bottom, [bottom, top])).toBe(true);
    expect(isFree(bottom, [bottom, top])).toBe(false);
  });

  it('partial overlap from above still covers', () => {
    const bottom = tile(0, f('man', 1), 0, 0, 0);
    const top = tile(1, f('man', 2), 1, 1, 1); // half-offset overlap
    expect(isCovered(bottom, [bottom, top])).toBe(true);
  });

  it('a tile blocked on both sides is not free', () => {
    const left = tile(0, f('man', 1), 0, 0, 0);
    const mid = tile(1, f('man', 2), 0, 2, 0);
    const right = tile(2, f('man', 3), 0, 4, 0);
    const all = [left, mid, right];
    expect(isFree(left, all)).toBe(true);
    expect(isFree(mid, all)).toBe(false);
    expect(isFree(right, all)).toBe(true);
  });

  it('a tile with one side open is free', () => {
    const left = tile(0, f('man', 1), 0, 0, 0);
    const right = tile(1, f('man', 2), 0, 2, 0);
    expect(isFree(left, [left, right])).toBe(true); // right side blocked? left has no left neighbour -> free
    expect(isFree(right, [left, right])).toBe(true);
  });

  it('diagonal same-layer neighbours do not block', () => {
    const a = tile(0, f('man', 1), 0, 0, 0);
    const b = tile(1, f('man', 2), 0, 2, 2); // touches corner only
    expect(isFree(a, [a, b])).toBe(true);
    expect(isFree(b, [a, b])).toBe(true);
  });

  it('removed tiles do not block or cover', () => {
    const bottom = tile(0, f('man', 1), 0, 0, 0);
    const top = tile(1, f('man', 2), 1, 0, 0, true);
    expect(isFree(bottom, [bottom, top])).toBe(true);
  });
});

describe('solitaire: matching pairs', () => {
  it('identical faces match', () => {
    const a = tile(0, f('pin', 5), 0, 0, 0);
    const b = tile(1, f('pin', 5), 0, 4, 0);
    const s = stateOf([a, b]);
    expect(attemptPair(s, 0, 1).ok).toBe(true);
  });

  it('different faces do not match', () => {
    const a = tile(0, f('pin', 5), 0, 0, 0);
    const b = tile(1, f('pin', 6), 0, 4, 0);
    const s = stateOf([a, b]);
    const r = attemptPair(s, 0, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-matching');
  });

  it('any flower matches any flower in classic mode', () => {
    const a = tile(0, f('flower', 1), 0, 0, 0);
    const b = tile(1, f('flower', 3), 0, 4, 0);
    expect(attemptPair(stateOf([a, b]), 0, 1).ok).toBe(true);
  });

  it('any season matches any season in classic mode', () => {
    const a = tile(0, f('season', 2), 0, 0, 0);
    const b = tile(1, f('season', 4), 0, 4, 0);
    expect(attemptPair(stateOf([a, b]), 0, 1).ok).toBe(true);
  });

  it('flower does not match season', () => {
    const a = tile(0, f('flower', 1), 0, 0, 0);
    const b = tile(1, f('season', 1), 0, 4, 0);
    expect(attemptPair(stateOf([a, b]), 0, 1).ok).toBe(false);
  });

  it('strict mode requires identical flowers', () => {
    const a = tile(0, f('flower', 1), 0, 0, 0);
    const b = tile(1, f('flower', 3), 0, 4, 0);
    const s = stateOf([a, b]);
    s.matchMode = 'strict';
    expect(attemptPair(s, 0, 1).ok).toBe(false);
  });

  it('same rank in different suits does not match', () => {
    const a = tile(0, f('man', 5), 0, 0, 0);
    const b = tile(1, f('sou', 5), 0, 4, 0);
    expect(attemptPair(stateOf([a, b]), 0, 1).ok).toBe(false);
  });

  it('blocked tiles cannot be paired even when faces match', () => {
    const l = tile(0, f('man', 1), 0, 0, 0);
    const m = tile(1, f('man', 1), 0, 2, 0);
    const r = tile(2, f('man', 1), 0, 4, 0);
    const res = attemptPair(stateOf([l, m, r]), 1, 0);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not-free');
  });
});

describe('solitaire: removal, win, deadlock', () => {
  it('removing the last pair wins the game', () => {
    const a = tile(0, f('pin', 5), 0, 0, 0);
    const b = tile(1, f('pin', 5), 0, 4, 0);
    const s = stateOf([a, b]);
    const r = attemptPair(s, 0, 1);
    expect(r.ok).toBe(true);
    expect(r.state.status).toBe('won');
    expect(remainingCount(r.state)).toBe(0);
    expect(r.state.score).toBe(pairScore(1));
  });

  it('detects deadlock when no legal moves remain', () => {
    // 4 tiles, 2 pairs, but arranged so after one removal the rest cannot match
    const a = tile(0, f('man', 1), 0, 0, 0);
    const b = tile(1, f('man', 1), 0, 4, 0);
    const c = tile(2, f('man', 2), 0, 8, 0);
    const d = tile(3, f('man', 3), 0, 12, 0);
    const s = stateOf([a, b, c, d]);
    expect(hasMoves(s)).toBe(true);
    const r = attemptPair(s, 0, 1);
    expect(r.state.status).toBe('deadlock');
    expect(hasMoves(r.state)).toBe(false);
  });

  it('cannot move after game over', () => {
    const a = tile(0, f('pin', 5), 0, 0, 0);
    const b = tile(1, f('pin', 5), 0, 4, 0);
    const s = stateOf([a, b]);
    attemptPair(s, 0, 1);
    const r = attemptPair(s, 0, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('game-over');
  });
});

describe('solitaire: undo / redo', () => {
  it('undo restores removed pair and score; redo re-removes', () => {
    const a = tile(0, f('pin', 5), 0, 0, 0);
    const b = tile(1, f('pin', 5), 0, 4, 0);
    const c = tile(2, f('pin', 6), 0, 8, 0);
    const d = tile(3, f('pin', 6), 0, 12, 0);
    let s = stateOf([a, b, c, d]);
    s = attemptPair(s, 0, 1).state;
    expect(remainingCount(s)).toBe(2);
    const scoreAfter = s.score;
    s = undo(s);
    expect(remainingCount(s)).toBe(4);
    expect(s.score).toBe(0);
    expect(s.status).toBe('playing');
    s = redo(s);
    expect(remainingCount(s)).toBe(2);
    expect(s.score).toBe(scoreAfter);
  });

  it('undo on empty history is a no-op', () => {
    const s = stateOf([tile(0, f('pin', 5), 0, 0, 0)]);
    const before = s.tiles.length;
    undo(s);
    expect(s.tiles.length).toBe(before);
  });

  it('new move clears redo stack', () => {
    const mk = () =>
      stateOf([
        tile(0, f('pin', 5), 0, 0, 0),
        tile(1, f('pin', 5), 0, 4, 0),
        tile(2, f('pin', 6), 0, 8, 0),
        tile(3, f('pin', 6), 0, 12, 0),
      ]);
    let s = mk();
    s = attemptPair(s, 0, 1).state;
    s = undo(s);
    expect(s.future.length).toBe(1);
    s = attemptPair(s, 2, 3).state;
    expect(s.future.length).toBe(0);
  });
});

describe('solitaire: hints and legal pairs', () => {
  it('lists legal pairs among free tiles only', () => {
    const l = tile(0, f('man', 1), 0, 0, 0);
    const m = tile(1, f('man', 1), 0, 2, 0); // blocked in the middle
    const r = tile(2, f('man', 1), 0, 4, 0);
    const s = stateOf([l, m, r]);
    const pairs = legalPairs(s);
    expect(pairs.length).toBe(1);
    expect(pairs[0].a.id).toBe(0);
    expect(pairs[0].b.id).toBe(2);
  });

  it('hint returns null when no moves', () => {
    const a = tile(0, f('man', 1), 0, 0, 0);
    const b = tile(1, f('man', 2), 0, 4, 0);
    expect(hint(stateOf([a, b]))).toBeNull();
  });
});

describe('solitaire: scoring', () => {
  it('base pair is 10 points and streak adds up to +10', () => {
    expect(pairScore(1)).toBe(10);
    expect(pairScore(2)).toBe(12);
    expect(pairScore(6)).toBe(20);
    expect(pairScore(9)).toBe(20); // capped
  });
});

describe('solitaire: serialization', () => {
  it('round-trips a game state', () => {
    const positions = layoutPositions('turtle');
    const rng = createRng(123);
    const { faces } = dealSolvable(positions, rng);
    let s = createSolitaire({ layoutId: 'turtle', seed: 123, faces, positions });
    const pair = hint(s)!;
    s = attemptPair(s, pair.a.id, pair.b.id).state;
    const restored = deserializeSolitaire(serializeSolitaire(s));
    expect(remainingCount(restored)).toBe(remainingCount(s));
    expect(restored.score).toBe(s.score);
    expect(restored.status).toBe(s.status);
    expect(restored.matchMode).toBe(s.matchMode);
  });
});

describe('solitaire: shuffle', () => {
  it('shuffle keeps the face multiset and can be undone', () => {
    const positions = layoutPositions('turtle');
    const rng = createRng(7);
    const { faces } = dealSolvable(positions, rng);
    let s = createSolitaire({ layoutId: 'turtle', seed: 7, faces, positions });
    const before = s.tiles.map((t) => `${t.face.suit}${t.face.rank}`).sort().join();
    const pool = s.tiles.filter((t) => !t.removed).map((t) => t.face);
    s = shuffleRemaining(s, [...pool].reverse());
    const after = s.tiles.map((t) => `${t.face.suit}${t.face.rank}`).sort().join();
    expect(after).toBe(before);
    expect(s.shufflesUsed).toBe(1);
    s = undo(s);
    expect(s.shufflesUsed).toBe(0);
  });
});

describe('layouts', () => {
  it('all core layouts exist with 144 tiles', () => {
    for (const id of ['turtle', 'dragon', 'pyramid', 'fortress', 'butterfly']) {
      const l = getLayout(id);
      expect(l, id).toBeTruthy();
      expect(l!.tiles.length, `${id} count`).toBe(144);
    }
  });

  it('catalog has at least 20 layouts total', () => {
    expect(listLayouts().length).toBeGreaterThanOrEqual(20);
  });

  it('no layout has duplicate positions', () => {
    for (const l of listLayouts()) {
      const seen = new Set<string>();
      for (const [layer, x, y] of l.tiles) {
        const k = `${layer}|${x}|${y}`;
        expect(seen.has(k), `${l.id} duplicate ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('every layout has an even tile count', () => {
    for (const l of listLayouts()) expect(l.count % 2, l.id).toBe(0);
  });

  it('upper layers are supported by lower layers (classic layouts)', () => {
    for (const id of ['turtle', 'pyramid', 'fortress', 'butterfly', 'dragon']) {
      const l = getLayout(id)!;
      for (const [z, x, y] of l.tiles) {
        if (z === 0) continue;
        // supported = some tile on the layer below geometrically overlaps (engine rule)
        const supported = l.tiles.some(
          ([z2, x2, y2]) => z2 === z - 1 && Math.abs(x2 - x) < 2 && Math.abs(y2 - y) < 2
        );
        expect(supported, `${id}: tile ${z}|${x}|${y} floats`).toBe(true);
      }
    }
  });
});

describe('generator + solver', () => {
  it('buildPairBag produces 72 pairs for a full board', () => {
    const bag = buildPairBag(144, true, createRng(1));
    expect(bag.length).toBe(72);
    const counts = new Map<string, number>();
    for (const [a, b] of bag)
      for (const t of [a, b]) {
        const k = `${t.suit}-${t.rank}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    // each basic face exactly 4, each bonus exactly 1
    expect(counts.get('man-1')).toBe(4);
    expect(counts.get('flower-1')).toBe(1);
    expect(counts.get('season-4')).toBe(1);
    let total = 0;
    counts.forEach((v) => (total += v));
    expect(total).toBe(144);
  });

  it('buildPairBag pool is pairable for custom sizes', () => {
    const bag = buildPairBag(36, false, createRng(2));
    const faces = bag.flat();
    expect(poolIsPairable(faces, 'strict')).toBe(true);
  });

  const seeds = [11, 22, 33];
  for (const id of ['turtle', 'pyramid', 'fortress', 'butterfly']) {
    for (const seed of seeds) {
      it(`generated ${id} (seed ${seed}) is verified solvable`, () => {
        const positions = layoutPositions(id);
        const { faces, verified } = dealSolvable(positions, createRng(seed));
        expect(verified).toBe(true);
        const tiles: SolTile[] = positions.map((pos, i) => ({ id: i, face: faces[i], pos, removed: false }));
        const res = solveBoard(tiles, 'classic', { maxNodes: 300_000, maxTimeMs: 10_000 });
        expect(res.status).toBe('solved');
      }, 30_000);
    }
  }

  it('solver proves a deadlocked position unsolvable (exhaustive)', () => {
    // 4 tiles: two non-matching pairs interleaved so nothing can ever be removed? Use blocked geometry:
    // row: A B A B where only ends are free: A(0,0) B(0,2) A(0,4)... free = A0 and A4 match -> solvable.
    // Construct truly deadlocked: 4 in a row: man1 pin5 pin5 man1? ends: man1 & man1 -> pair; leaves pin5 pin5 -> wins. Not deadlocked.
    // Real deadlock: 6 tiles in a row: A B C A B C -> free: A(pos0) & C(pos5) no match; remove? no move at all.
    const faces = [f('man', 1), f('pin', 5), f('sou', 9), f('man', 1), f('pin', 5), f('sou', 9)];
    const tiles: SolTile[] = faces.map((face, i) => tile(i, face, 0, i * 2, 0));
    const res = solveBoard(tiles, 'strict', { maxNodes: 10_000 });
    expect(res.status).toBe('unsolvable');
  });

  it('greedy solver solves a generated board', () => {
    const positions = layoutPositions('dragon');
    const { faces } = dealSolvable(positions, createRng(99));
    const tiles: SolTile[] = positions.map((pos, i) => ({ id: i, face: faces[i], pos, removed: false }));
    const res = greedySolve(tiles, 'classic', createRng(5), 60);
    expect(res.status).toBe('solved');
  }, 30_000);
});
