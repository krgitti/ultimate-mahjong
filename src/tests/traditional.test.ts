import { describe, it, expect } from 'vitest';
import {
  newMatch,
  drawTile,
  discard,
  legalDiscards,
  resolveCalls,
  executeCall,
  canRon,
  canTsumo,
  canAnkan,
  declareAnkan,
  declareAddedKong,
  resolveRob,
  declareTsumo,
  nextHandOrEnd,
  handFaces,
  seatWindOf,
  publicView,
  replaceBonusTiles,
  waitsWithCounts,
  type TradState,
} from '../game-engine/traditional/engine';
import { HK_DEFAULTS, HK_CHICKEN } from '../game-engine/rules/hongkong';
import { mcrRuleset } from '../game-engine/rules/mcr';
import { computeScoring, computePayments } from '../game-engine/scoring/hongkong-scoring';
import { isCompleteHand, normalShanten, winningWaits, countsFromFaces } from '../game-engine/traditional/hand';
import type { TileFace } from '../game-engine/tiles/tiles';
import { faceIndex } from '../game-engine/tiles/tiles';
import { createRng } from '../game-engine/tiles/rng';
import { chooseDiscard, chooseCall, type BotView } from '../game-engine/ai/bot';

const f = (suit: TileFace['suit'], rank: number): TileFace => ({ suit, rank });

/* ---------- helpers: scenario construction ---------- */

function idsForFaces(s: TradState, faces: TileFace[]): number[] {
  const ids: number[] = [];
  for (const face of faces) {
    const matches = (tid: number) => {
      const tf = s.tiles[tid].face;
      return tf.suit === face.suit && tf.rank === face.rank;
    };
    let found = -1;
    let source: 'wall' | 'dead' | number = 'wall';
    found = s.wall.findIndex(matches);
    if (found === -1) {
      found = s.deadWall.findIndex(matches);
      source = 'dead';
    }
    if (found === -1) {
      for (const p of s.players) {
        found = p.hand.findIndex(matches);
        if (found !== -1) { source = p.seat; break; }
      }
    }
    if (found === -1) throw new Error(`tile not available: ${face.suit}${face.rank}`);
    if (source === 'wall') { ids.push(s.wall[found]); s.wall.splice(found, 1); }
    else if (source === 'dead') { ids.push(s.deadWall[found]); s.deadWall.splice(found, 1); }
    else { ids.push(s.players[source].hand[found]); s.players[source].hand.splice(found, 1); }
  }
  return ids;
}

function setHand(s: TradState, seat: number, faces: TileFace[]): void {
  // return current hand tiles to the wall (keep integrity); clear BEFORE pulling
  // so idsForFaces can never double-book a tile still referenced by the hand.
  const old = s.players[seat].hand;
  s.players[seat].hand = [];
  s.wall.push(...old);
  s.players[seat].hand = idsForFaces(s, faces);
  s.players[seat].hand.sort((a, b) => a - b);
}

/** Return every seat's hand to the wall so scenario tiles come only from wall/dead wall. */
function resetHands(s: TradState): void {
  for (const p of s.players) {
    s.wall.push(...p.hand);
    p.hand = [];
  }
}

/** Move a seat's bonus tiles back to the dead wall (isolates fan assertions). */
function clearBonus(s: TradState, seat: number): void {
  s.deadWall.push(...s.players[seat].bonus);
  s.players[seat].bonus = [];
}

function checkTileIntegrity(s: TradState) {
  const seen = new Set<number>();
  const add = (id: number) => {
    if (seen.has(id)) throw new Error(`duplicate tile ${id}`);
    seen.add(id);
  };
  s.wall.forEach(add);
  s.deadWall.forEach(add);
  for (const p of s.players) {
    p.hand.forEach(add);
    p.bonus.forEach(add);
    p.discards.forEach(add);
    p.melds.forEach((m) => m.tiles.forEach(add));
  }
  if (seen.size !== 144) throw new Error(`tile count ${seen.size} != 144`);
}

/* ---------- tests ---------- */

describe('traditional: tile set integrity', () => {
  it('the set has 144 unique tiles with correct per-face counts', () => {
    const s = newMatch(HK_DEFAULTS, 1);
    expect(s.tiles.length).toBe(144);
    const ids = new Set(s.tiles.map((t) => t.id));
    expect(ids.size).toBe(144);
    const counts = new Map<string, number>();
    for (const t of s.tiles) {
      const k = `${t.face.suit}-${t.face.rank}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.get('man-1')).toBe(4);
    expect(counts.get('wind-4')).toBe(4);
    expect(counts.get('dragon-3')).toBe(4);
    expect(counts.get('flower-1')).toBe(1);
    expect(counts.get('season-4')).toBe(1);
  });

  it('dealing keeps all 144 tiles accounted for', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = newMatch(HK_DEFAULTS, seed);
      checkTileIntegrity(s);
      checkTileIntegrity(s);
      // 13 each + dealer 14th = 53 in hands; bonus exposures move tiles hand->bonus (hand size kept by replacements)
      const totalHands = s.players.reduce((n, p) => n + p.hand.length, 0);
      const totalBonus = s.players.reduce((n, p) => n + p.bonus.length, 0);
      expect(totalHands).toBe(53);
      expect(s.wall.length + s.deadWall.length).toBe(144 - 53 - totalBonus);
    }
  });
});

describe('traditional: turns, draws, discards', () => {
  it('dealer starts in discard phase with 14 tiles', () => {
    const s = newMatch(HK_DEFAULTS, 42);
    expect(s.phase).toBe('discard');
    expect(s.current).toBe(s.dealer);
    expect(s.players[s.dealer].hand.length).toBe(14);
  });

  it('a discard moves the tile to the pond and passes the turn', () => {
    const s = newMatch(HK_DEFAULTS, 42);
    const seat = s.current;
    const tileId = s.players[seat].hand[0];
    expect(legalDiscards(s, seat)).toContain(tileId);
    expect(legalDiscards(s, (seat + 1) % 4)).toEqual([]);
    const ok = discard(s, tileId);
    expect(ok).toBe(true);
    expect(s.players[seat].discards).toContain(tileId);
    expect(s.players[seat].hand).not.toContain(tileId);
    if (s.phase === 'draw') expect(s.current).toBe((seat + 1) % 4);
  });

  it('drawing adds a tile to the hand', () => {
    const s = newMatch(HK_DEFAULTS, 7);
    discard(s, s.players[s.current].hand[0]);
    if (s.phase === 'calls') resolveCalls(s, () => ({ offer: null }));
    expect(s.phase).toBe('draw');
    const before = s.players[s.current].hand.length;
    const wallBefore = s.wall.length;
    const res = drawTile(s);
    expect(res.ok).toBe(true);
    expect(s.players[s.current].hand.length).toBe(before + 1);
    expect(s.wall.length).toBe(wallBefore - 1);
    checkTileIntegrity(s);
  });

  it('invalid discard is rejected', () => {
    const s = newMatch(HK_DEFAULTS, 3);
    expect(discard(s, 999999)).toBe(false);
    expect(discard(s, s.players[(s.current + 1) % 4].hand[0])).toBe(false);
  });

  it('bonus tiles are exposed and replaced when drawn', () => {
    const s = newMatch(HK_DEFAULTS, 5);
    // force a flower into the current player's hand
    const seat = s.current;
    const flowerId = [...s.wall, ...s.deadWall].find((id) => s.tiles[id].face.suit === 'flower')!;
    s.players[seat].hand.push(flowerId);
    s.wall = s.wall.filter((id) => id !== flowerId);
    const handBefore = s.players[seat].hand.length;
    const deadBefore = s.deadWall.length;
    replaceBonusTiles(s, seat);
    expect(s.players[seat].bonus).toContain(flowerId);
    expect(s.players[seat].hand.length).toBe(handBefore); // replaced
    expect(s.deadWall.length).toBe(deadBefore - 1);
    checkTileIntegrity(s);
  });
});

describe('traditional: calls (chi/pon/kan)', () => {
  function setupDiscard(s: TradState, seat: number, face: TileFace): number {
    const [tileId] = idsForFaces(s, [face]);
    s.current = seat;
    s.phase = 'discard';
    s.players[seat].hand.push(tileId);
    discard(s, tileId);
    return tileId;
  }

  it('pon is offered to any seat holding a pair', () => {
    const s = newMatch(HK_DEFAULTS, 11);
    resetHands(s);
    // seat 2 holds a pair of 5-pin
    setHand(s, 2, [f('pin', 5), f('pin', 5), f('man', 2), f('man', 3), f('man', 4), f('sou', 7), f('sou', 8), f('sou', 9), f('pin', 1), f('pin', 2), f('pin', 3), f('wind', 1), f('wind', 1)]);
    setHand(s, 0, [f('man', 1), f('man', 5), f('man', 9), f('pin', 4), f('pin', 6), f('sou', 2), f('sou', 3), f('sou', 5), f('wind', 2), f('wind', 3), f('dragon', 1), f('dragon', 2), f('pin', 8)]);
    // strip bonuses that may have been auto-exposed from setHand (kept simple)
    setupDiscard(s, 1, f('pin', 5));
    const pon = s.offers.find((o) => o.kind === 'pon' && o.seat === 2);
    expect(pon).toBeTruthy();
    const res = resolveCalls(s, (seat, offers) => {
      if (seat === 2) return { offer: offers.find((o) => o.kind === 'pon') ?? null };
      return { offer: null };
    });
    expect(res).toBe('resolved');
    expect(s.players[2].melds.some((m) => m.kind === 'pon')).toBe(true);
    expect(s.current).toBe(2);
    expect(s.phase).toBe('discard');
    checkTileIntegrity(s);
  });

  it('chi is offered ONLY to the next seat', () => {
    const s = newMatch(HK_DEFAULTS, 12);
    resetHands(s);
    const seq = [f('man', 4), f('man', 6)]; // waits 5-man; discarder will be seat 3 -> next seat is 0
    setHand(s, 0, [...seq, f('pin', 2), f('pin', 3), f('pin', 4), f('sou', 2), f('sou', 3), f('sou', 4), f('pin', 7), f('pin', 7), f('wind', 1), f('wind', 2), f('wind', 3)]);
    // seat 2 also could form a chi geometrically but must NOT be offered
    setHand(s, 2, [f('man', 4), f('man', 6), f('pin', 2), f('pin', 3), f('pin', 4), f('sou', 2), f('sou', 3), f('sou', 4), f('pin', 7), f('pin', 8), f('wind', 1), f('wind', 2), f('wind', 3)]);
    setupDiscard(s, 3, f('man', 5));
    const chiSeats = s.offers.filter((o) => o.kind === 'chi').map((o) => o.seat);
    expect(chiSeats).toEqual([0]);
  });

  it('chi execution forms the meld with chosen tiles and gives the turn to the caller', () => {
    const s = newMatch(HK_DEFAULTS, 13);
    resetHands(s);
    setHand(s, 0, [f('man', 4), f('man', 6), f('pin', 2), f('pin', 3), f('pin', 4), f('sou', 2), f('sou', 3), f('sou', 4), f('pin', 7), f('pin', 7), f('wind', 1), f('wind', 2), f('wind', 3)]);
    setupDiscard(s, 3, f('man', 5));
    const chi = s.offers.find((o) => o.kind === 'chi' && o.seat === 0)!;
    expect(chi.chiOptions!.length).toBeGreaterThan(0);
    executeCall(s, 0, chi, chi.chiOptions![0]);
    const meld = s.players[0].melds.find((m) => m.kind === 'chi')!;
    const meldFaces = meld.tiles.map((t) => s.tiles[t].face);
    expect(meldFaces.map((x) => `${x.suit}${x.rank}`).sort()).toEqual(['man4', 'man5', 'man6']);
    expect(s.current).toBe(0);
    expect(s.phase).toBe('discard');
    checkTileIntegrity(s);
  });

  it('kan from a discard draws a replacement from the dead wall', () => {
    const s = newMatch(HK_DEFAULTS, 14);
    resetHands(s);
    setHand(s, 1, [f('pin', 9), f('pin', 9), f('pin', 9), f('man', 2), f('man', 3), f('man', 4), f('sou', 2), f('sou', 3), f('sou', 4), f('pin', 2), f('pin', 3), f('pin', 4), f('wind', 2)]);
    const deadBefore = s.deadWall.length;
    setupDiscard(s, 0, f('pin', 9));
    const kan = s.offers.find((o) => o.kind === 'kan' && o.seat === 1)!;
    executeCall(s, 1, kan);
    expect(s.players[1].melds.some((m) => m.kind === 'kan')).toBe(true);
    expect(s.pendingReplacementDraw).toBe(true);
    expect(s.phase).toBe('draw');
    const res = drawTile(s);
    expect(res.ok).toBe(true);
    expect(s.deadWall.length).toBe(deadBefore - 1);
    checkTileIntegrity(s);
  });

  it('concealed kong during own turn sets replacement draw', () => {
    const s = newMatch(HK_DEFAULTS, 15);
    resetHands(s);
    s.phase = 'discard';
    s.current = 0;
    setHand(s, 0, [f('pin', 1), f('pin', 1), f('pin', 1), f('pin', 1), f('man', 2), f('man', 3), f('man', 4), f('sou', 2), f('sou', 3), f('sou', 4), f('pin', 7), f('pin', 7), f('wind', 2), f('wind', 3)]);
    expect(declareAnkan(s, 0)).toBe(true);
    expect(s.players[0].melds.some((m) => m.kind === 'ankan')).toBe(true);
    expect(s.pendingReplacementDraw).toBe(true);
    expect(s.phase).toBe('draw');
    checkTileIntegrity(s);
  });
});

describe('traditional: winning', () => {
  it('detects a tsumo win and pays everyone', () => {
    const s = newMatch(HK_CHICKEN, 21);
    clearBonus(s, 0);
    s.current = 0;
    s.phase = 'draw';
    s.pendingReplacementDraw = false;
    s.lastDrawWasReplacement = false;
    drawTile(s);
    setHand(s, 0, [
      f('man', 2), f('man', 2), f('man', 2),
      f('man', 3), f('man', 4), f('man', 5),
      f('man', 6), f('man', 7), f('man', 8),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('sou', 5), f('sou', 5),
    ]);
    s.drawnTile = s.players[0].hand[s.players[0].hand.length - 1];
    s.lastDrawWasReplacement = false; // the rigged hand was not a kong replacement
    expect(canTsumo(s, 0)).toBe(true);
    expect(declareTsumo(s, 0)).toBe(true);
    expect(s.phase).toBe('hand-over');
    expect(s.result!.kind).toBe('win');
    expect(s.result!.selfDrawn).toBe(true);
    // fan: tsumo + concealed + all simples = 3 -> 8 points each
    const pts = s.result!.scoring!.points;
    expect(s.result!.scoring!.totalFan).toBe(3);
    expect(pts).toBe(8);
    const total = s.players.reduce((n, p) => n + p.score, 0);
    expect(total).toBe(0); // zero-sum
    checkTileIntegrity(s);
  });

  it('detects a ron win; discarder pays double', () => {
    const s = newMatch(HK_CHICKEN, 22);
    resetHands(s);
    clearBonus(s, 2);
    setHand(s, 2, [
      f('man', 2), f('man', 2), f('man', 2),
      f('man', 3), f('man', 4), f('man', 5),
      f('man', 6), f('man', 7), f('man', 8),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('sou', 5),
    ]);
    // seat 1 discards sou5
    s.current = 1;
    s.phase = 'discard';
    const [tileId] = idsForFaces(s, [f('sou', 5)]);
    s.players[1].hand.push(tileId);
    discard(s, tileId);
    expect(canRon(s, 2, tileId)).toBe(true);
    const ron = s.offers.find((o) => o.kind === 'ron' && o.seat === 2)!;
    executeCall(s, 2, ron);
    expect(s.result!.kind).toBe('win');
    expect(s.result!.winner).toBe(2);
    // fan: concealed + all simples = 2 -> 4 points; discarder(1) pays 8, others 4
    expect(s.result!.scoring!.totalFan).toBe(2);
    expect(s.result!.payments).toEqual([4, 8, 0, 4]);
    expect(s.players[2].score).toBe(16);
    expect(s.players[1].score).toBe(-8);
    checkTileIntegrity(s);
  });

  it('minimum fan blocks a weak ron (classic HK minimum 3)', () => {
    const s = newMatch(HK_DEFAULTS, 23); // minFan 3
    setHand(s, 2, [
      f('man', 2), f('man', 2), f('man', 2),
      f('man', 3), f('man', 4), f('man', 5),
      f('man', 6), f('man', 7), f('man', 8),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('sou', 5),
    ]);
    s.current = 1;
    s.phase = 'discard';
    const [tileId] = idsForFaces(s, [f('sou', 5)]);
    s.players[1].hand.push(tileId);
    discard(s, tileId);
    // hand complete but only 2 qualifying fan (concealed + simples) -> no ron offer
    expect(canRon(s, 2, tileId)).toBe(false);
    expect(s.offers.some((o) => o.kind === 'ron')).toBe(false);
  });

  it('ron outranks pon (priority resolution)', () => {
    const s = newMatch(HK_CHICKEN, 24);
    // seat 2 can ron; seat 3 holds a pair for pon — same discard
    setHand(s, 2, [
      f('man', 2), f('man', 2), f('man', 2),
      f('man', 3), f('man', 4), f('man', 5),
      f('man', 6), f('man', 7), f('man', 8),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('sou', 5),
    ]);
    setHand(s, 3, [f('sou', 5), f('sou', 5), f('man', 8), f('man', 8), f('pin', 1), f('pin', 2), f('pin', 3), f('sou', 1), f('sou', 2), f('sou', 3), f('wind', 1), f('wind', 2), f('wind', 3)]);
    s.current = 1;
    s.phase = 'discard';
    const [tileId] = idsForFaces(s, [f('sou', 5)]);
    s.players[1].hand.push(tileId);
    discard(s, tileId);
    // seat 3 wants pon, seat 2 wants ron — decision callback accepts everything
    resolveCalls(s, (_seat, offers) => ({ offer: offers[0] ?? null }));
    expect(s.result!.winner).toBe(2);
    checkTileIntegrity(s);
  });

  it('exhaustive draw ends the hand with no payment', () => {
    const s = newMatch(HK_DEFAULTS, 25);
    s.current = 1;
    s.phase = 'draw';
    s.wall = [];
    const res = drawTile(s);
    expect(res.exhaustiveDraw).toBe(true);
    expect(s.result!.kind).toBe('draw');
    expect(s.phase).toBe('hand-over');
    expect(s.players.every((p) => p.score === 0)).toBe(true);
  });
});

describe('traditional: robbing the kong', () => {
  it('added kong can be robbed by a waiting player', () => {
    const s = newMatch(HK_CHICKEN, 26);
    resetHands(s);
    clearBonus(s, 2);
    // seat 0 has a pon of sou5 and the 4th tile in hand (10-tile hand + pon meld)
    setHand(s, 0, [
      f('man', 1), f('man', 2), f('man', 3),
      f('man', 5), f('man', 6), f('man', 7),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('pin', 7),
    ]);
    const ponIds = idsForFaces(s, [f('sou', 5), f('sou', 5)]);
    const fifthId = idsForFaces(s, [f('sou', 5)])[0];
    s.players[0].melds.push({ kind: 'pon', tiles: ponIds, from: 1, added: false });
    s.players[0].hand.push(fifthId);
    // seat 2 waits on sou5 as the pair: 123m 456m 789m 234p + lone sou5
    setHand(s, 2, [
      f('man', 1), f('man', 2), f('man', 3),
      f('man', 4), f('man', 5), f('man', 6),
      f('man', 7), f('man', 8), f('man', 9),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('sou', 5),
    ]);
    s.current = 0;
    s.phase = 'discard';
    expect(declareAddedKong(s, 0)).toBe(true);
    expect(s.phase).toBe('calls-rob');
    const res = resolveRob(s, (seat) => seat === 2);
    expect(res).toBe('resolved');
    expect(s.result!.kind).toBe('win');
    expect(s.result!.winner).toBe(2);
    expect(s.result!.scoring!.items.some((i) => i.name.includes('Roubo'))).toBe(true);
    checkTileIntegrity(s);
  });
});

describe('traditional: scoring', () => {
  const mkInput = (over: Partial<Parameters<typeof computeScoring>[0]> = {}) => ({
    concealedCounts: countsFromFaces([]),
    melds: [],
    winFace: 0,
    selfDrawn: false,
    seatWind: 1,
    roundWind: 1,
    flowers: 0,
    seasons: 0,
    winOnKong: false,
    robbedKong: false,
    lastTile: false,
    rules: HK_DEFAULTS,
    ...over,
  });

  it('all pungs + dragon + seat&round wind = 6 fan, 64 points', () => {
    // melds: pon red dragon, pon east, pon 9-man, pon 1-pin; concealed: 55-sou pair, win on sou5 (tsumo would add 1; use ron)
    const melds = [
      { kind: 'pon' as const, faces: [31, 31, 31] as [number, number, number] },
      { kind: 'pon' as const, faces: [27, 27, 27] as [number, number, number] },
      { kind: 'pon' as const, faces: [8, 8, 8] as [number, number, number] },
      { kind: 'pon' as const, faces: [9, 9, 9] as [number, number, number] },
    ];
    const r = computeScoring(mkInput({
      concealedCounts: countsFromFaces([f('sou', 5), f('sou', 5)]),
      melds,
      winFace: faceIndex(f('sou', 5)),
      seatWind: 1,
      roundWind: 1,
    }));
    // all pungs 3 + dragon 1 + seat 1 + round 1 = 6
    expect(r.totalFan).toBe(6);
    expect(r.points).toBe(64);
  });

  it('full flush = 6 fan', () => {
    const melds = [
      { kind: 'pon' as const, faces: [10, 10, 10] as [number, number, number] }, // 2-pin
      { kind: 'pon' as const, faces: [13, 13, 13] as [number, number, number] }, // 5-pin
      { kind: 'chi' as const, faces: [15, 16, 17] as [number, number, number] }, // 789-pin
    ];
    const r = computeScoring(mkInput({
      concealedCounts: countsFromFaces([f('pin', 3), f('pin', 3), f('pin', 3)]),
      melds,
      winFace: faceIndex(f('pin', 3)),
    }));
    expect(r.items.some((i) => i.name.includes('Flush completo'))).toBe(true);
    expect(r.totalFan).toBe(6);
  });

  it('bonus fan does not satisfy the minimum', () => {
    // chicken hand + 4 bonus tiles: qualifying 0, total 4 -> blocked with minFan 3
    const r = computeScoring(mkInput({
      concealedCounts: countsFromFaces([f('man', 1), f('man', 1)]),
      melds: [
        { kind: 'chi' as const, faces: [1, 2, 3] as [number, number, number] }, // 234m
        { kind: 'chi' as const, faces: [3, 4, 5] as [number, number, number] }, // 456m
        { kind: 'chi' as const, faces: [10, 11, 12] as [number, number, number] }, // 234p
        { kind: 'pon' as const, faces: [19, 19, 19] as [number, number, number] }, // 222s
      ],
      winFace: faceIndex(f('man', 1)),
      flowers: 4,
      seasons: 0,
    }));
    expect(r.qualifyingFan).toBe(0);
    expect(r.totalFan).toBe(6); // 4 bonus tiles + complete flower set bonus (all non-qualifying)
    expect(r.meetsMinimum).toBe(false);
    expect(r.points).toBe(0);
  });

  it('fan cap at 13', () => {
    const r = computeScoring(mkInput({
      concealedCounts: countsFromFaces([f('wind', 3), f('wind', 3)]), // west pair (honor)
      melds: [
        { kind: 'pon' as const, faces: [31, 31, 31] as [number, number, number] },
        { kind: 'pon' as const, faces: [32, 32, 32] as [number, number, number] },
        { kind: 'pon' as const, faces: [33, 33, 33] as [number, number, number] },
        { kind: 'pon' as const, faces: [27, 27, 27] as [number, number, number] },
      ],
      winFace: faceIndex(f('wind', 3)),
      selfDrawn: true,
      roundWind: 1,
      seatWind: 1,
    }));
    // all honors 8 + dragons 3 + seat 1 + round 1 + all pungs 3 + tsumo 1 = 17 -> capped 13 -> 8192
    expect(r.capped).toBe(true);
    expect(r.points).toBe(8192);
  });

  it('payment split: self-draw vs ron', () => {
    expect(computePayments(HK_DEFAULTS, 8, true, null, 0)).toEqual([0, 8, 8, 8]);
    expect(computePayments(HK_DEFAULTS, 8, false, 3, 0)).toEqual([0, 8, 8, 16]);
    const noDouble = { ...HK_DEFAULTS, doubleDiscard: false };
    expect(computePayments(noDouble, 8, false, 3, 0)).toEqual([0, 8, 8, 8]);
  });
});

describe('traditional: hand analysis', () => {
  it('complete hand detected', () => {
    const faces = [
      f('man', 1), f('man', 1), f('man', 1),
      f('man', 2), f('man', 3), f('man', 4),
      f('man', 5), f('man', 6), f('man', 7),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('sou', 5), f('sou', 5),
    ];
    expect(isCompleteHand(countsFromFaces(faces), 0)).toBe(true);
    expect(normalShanten(countsFromFaces(faces), 0)).toBe(-1);
  });

  it('tenpai hand: shanten 0 and correct waits', () => {
    const faces = [
      f('man', 1), f('man', 2), f('man', 3),
      f('pin', 4), f('pin', 5), f('pin', 6),
      f('sou', 7), f('sou', 8), f('sou', 9),
      f('pin', 1), f('pin', 2),
      f('wind', 1), f('wind', 1),
    ];
    const c = countsFromFaces(faces);
    expect(normalShanten(c, 0)).toBe(0);
    const waits = winningWaits(c, 0).map((i) => [Math.floor(i / 9), i % 9]);
    expect(waits).toContainEqual([1, 2]); // 3-pin
  });

  it('one-away hand: shanten 1', () => {
    const faces = [
      f('man', 1), f('man', 2), f('man', 3),
      f('pin', 4), f('pin', 5), f('pin', 6),
      f('sou', 7), f('sou', 8), f('sou', 9),
      f('pin', 1), f('pin', 4),
      f('wind', 1), f('wind', 1),
    ];
    expect(normalShanten(countsFromFaces(faces), 0)).toBe(1);
  });

  it('counts declared melds', () => {
    // concealed 11 tiles (3 melds + pair) + 1 declared meld = complete
    const faces = [
      f('man', 1), f('man', 2), f('man', 3),
      f('pin', 4), f('pin', 5), f('pin', 6),
      f('sou', 7), f('sou', 8), f('sou', 9),
      f('man', 5), f('man', 5),
    ];
    expect(isCompleteHand(countsFromFaces(faces), 1)).toBe(true);
    expect(normalShanten(countsFromFaces(faces), 1)).toBe(-1);
  });
});

describe('traditional: rounds & match end', () => {
  it('dealer rotates on loss, retains on win (renchan)', () => {
    const s = newMatch(HK_DEFAULTS, 31);
    expect(s.dealer).toBe(0);
    s.result = { kind: 'draw' };
    s.phase = 'hand-over';
    nextHandOrEnd(s);
    expect(s.dealer).toBe(1);
    expect(s.handNumber).toBe(2);
    s.result = { kind: 'win', winner: 1 };
    s.phase = 'hand-over';
    nextHandOrEnd(s);
    expect(s.dealer).toBe(1); // renchan
    expect(s.handNumber).toBe(3);
  });

  it('match ends after configured hands', () => {
    const s = newMatch({ ...HK_DEFAULTS, handsPerMatch: 4 }, 32);
    s.handNumber = 4;
    s.result = { kind: 'draw' };
    s.phase = 'hand-over';
    nextHandOrEnd(s);
    expect(s.phase).toBe('match-over');
  });

  it('seat winds rotate with the deal', () => {
    const s = newMatch(HK_DEFAULTS, 33);
    expect(seatWindOf(s, 0)).toBe(1); // East
    s.dealer = 2;
    expect(seatWindOf(s, 2)).toBe(1);
    expect(seatWindOf(s, 0)).toBe(3); // West
  });
});

describe('traditional: public view hides information', () => {
  it('opponents hands are not exposed in the public view', () => {
    const s = newMatch(HK_DEFAULTS, 41);
    const view = publicView(s, 0);
    expect(view.myHand!.seat).toBe(0);
    expect(view.myHand!.tiles.length).toBe(s.players[0].hand.length);
    for (const p of view.players) {
      expect(p.handCount).toBe(s.players[p.seat].hand.length);
      expect('hand' in p).toBe(false);
    }
  });
});

describe('bots', () => {
  function botViewFrom(s: TradState, seat: number): BotView {
    return {
      seat,
      seatWind: seatWindOf(s, seat),
      roundWind: s.roundWind,
      hand: handFaces(s, seat),
      melds: s.players[seat].melds.map((m) => ({ kind: m.kind, faces: m.tiles.map((t) => s.tiles[t].face) })),
      bonusFaces: s.players[seat].bonus.map((id) => s.tiles[id].face),
      visibleDiscards: s.players.flatMap((p) => p.discards.map((id) => s.tiles[id].face)),
      otherMeldFaces: s.players
        .filter((p) => p.seat !== seat)
        .flatMap((p) => p.melds.flatMap((m) => m.tiles.map((t) => s.tiles[t].face))),
      wallCount: s.wall.length,
      turnNumber: 0,
    };
  }

  it('bot discards are always legal hand tiles and deterministic', () => {
    const s = newMatch(HK_DEFAULTS, 51);
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const view = botViewFrom(s, 1);
      const d1 = chooseDiscard(view, diff, createRng(9));
      const d2 = chooseDiscard(view, diff, createRng(9));
      expect(d1).toBe(d2); // determinism with same rng seed
      expect(d1).toBeGreaterThanOrEqual(0);
      expect(d1).toBeLessThan(view.hand.length);
    }
  });

  it('medium/hard keep the best shape (discard an isolated honor, not a sequence tile)', () => {
    const s = newMatch(HK_DEFAULTS, 52);
    setHand(s, 0, [
      f('man', 2), f('man', 3), f('man', 4),
      f('pin', 5), f('pin', 6), f('pin', 7),
      f('sou', 2), f('sou', 3), f('sou', 4),
      f('sou', 6), f('sou', 7), f('sou', 8),
      f('wind', 1), f('dragon', 1),
    ]);
    const view = botViewFrom(s, 0);
    for (const diff of ['medium', 'hard'] as const) {
      const i = chooseDiscard(view, diff, createRng(1));
      const face = view.hand[i];
      expect(['wind', 'dragon']).toContain(face.suit);
    }
  });

  it('difficulty changes decisions', () => {
    // same rigged state: easy (random) vs hard (shanten) differ across most seeds
    const s = newMatch(HK_DEFAULTS, 53);
    setHand(s, 0, [
      f('man', 2), f('man', 3), f('man', 4),
      f('pin', 5), f('pin', 6), f('pin', 7),
      f('sou', 2), f('sou', 3), f('sou', 4),
      f('sou', 6), f('sou', 7), f('sou', 8),
      f('wind', 1), f('dragon', 1),
    ]);
    const view = botViewFrom(s, 0);
    let differ = 0;
    for (let seed = 0; seed < 20; seed++) {
      const e = chooseDiscard(view, 'easy', createRng(seed));
      const h = chooseDiscard(view, 'hard', createRng(seed));
      if (view.hand[e].suit !== view.hand[h].suit || view.hand[e].rank !== view.hand[h].rank) differ++;
    }
    expect(differ).toBeGreaterThan(5);
  });

  it('bots never claim ron when hand is incomplete', () => {
    const s = newMatch(HK_DEFAULTS, 54);
    const view = botViewFrom(s, 1);
    const { call } = chooseCall(
      view,
      { canRon: false, canPon: false, canKan: false, chiOptions: null, discardFace: f('man', 1) },
      'hard',
      createRng(1)
    );
    expect(call).toBe('pass');
  });

  it('full simulated hand with bots terminates and keeps integrity', () => {
    for (const seed of [101, 202, 303]) {
      const s = newMatch(HK_DEFAULTS, seed);
      let guard = 0;
      while (s.phase !== 'hand-over' && guard++ < 2000) {
        if (s.phase === 'draw') {
          const r = drawTile(s);
          if (!r.ok) break;
        } else if (s.phase === 'discard') {
          const seat = s.current;
          if (canTsumo(s, seat)) { declareTsumo(s, seat); continue; }
          if (canAnkanNow(s, seat)) { declareAnkan(s, seat); continue; }
          const view = {
            seat,
            seatWind: seatWindOf(s, seat),
            roundWind: s.roundWind,
            hand: handFaces(s, seat),
            melds: s.players[seat].melds.map((m) => ({ kind: m.kind, faces: m.tiles.map((t) => s.tiles[t].face) })),
            bonusFaces: s.players[seat].bonus.map((id) => s.tiles[id].face),
            visibleDiscards: s.players.flatMap((p) => p.discards.map((id) => s.tiles[id].face)),
            otherMeldFaces: [],
            wallCount: s.wall.length,
            turnNumber: guard,
          };
          const i = chooseDiscard(view, 'medium', createRng(s.rngState + guard));
          const tileId = view.hand.length > 0 ? s.players[seat].hand[i] : s.players[seat].hand[0];
          if (!discard(s, tileId)) throw new Error(`illegal discard at guard ${guard}`);
        } else if (s.phase === 'calls') {
          resolveCalls(s, (seat, offers) => {
            const view = {
              seat,
              seatWind: seatWindOf(s, seat),
              roundWind: s.roundWind,
              hand: handFaces(s, seat),
              melds: s.players[seat].melds.map((m) => ({ kind: m.kind, faces: m.tiles.map((t) => s.tiles[t].face) })),
              bonusFaces: [],
              visibleDiscards: s.players.flatMap((p) => p.discards.map((id) => s.tiles[id].face)),
              otherMeldFaces: [],
              wallCount: s.wall.length,
              turnNumber: guard,
            };
            const opts = {
              canRon: offers.some((o) => o.kind === 'ron'),
              canPon: offers.some((o) => o.kind === 'pon'),
              canKan: offers.some((o) => o.kind === 'kan'),
              chiOptions: offers.find((o) => o.kind === 'chi')?.chiOptions
                ? (offers.find((o) => o.kind === 'chi')!.chiOptions!.map((pair) =>
                    pair.map((id) => s.tiles[id].face) as [TileFace, TileFace]
                  ))
                : null,
              discardFace: s.lastDiscard ? s.tiles[s.lastDiscard.tileId].face : f('man', 1),
            };
            const { call } = chooseCall(view, opts, 'medium', createRng(s.rngState + seat));
            if (call === 'ron') return { offer: offers.find((o) => o.kind === 'ron')! };
            if (call === 'pon') return { offer: offers.find((o) => o.kind === 'pon')! };
            if (call === 'kan') return { offer: offers.find((o) => o.kind === 'kan')! };
            if (call === 'chi') return { offer: offers.find((o) => o.kind === 'chi')! };
            return { offer: null };
          });
        } else if (s.phase === 'calls-rob') {
          resolveRob(s, () => false);
        }
      }
      expect(s.phase).toBe('hand-over');
      expect(s.result).toBeTruthy();
      checkTileIntegrity(s);
    }
  }, 60_000);
});

function canAnkanNow(s: TradState, seat: number): boolean {
  return canAnkan(s, seat) !== null;
}

describe('esperas informativas (item 2) — waitsWithCounts', () => {
  it('lista as peças que completam a mão e quantas restam', () => {
    const s = newMatch(HK_DEFAULTS, 777);
    s.wall.push(...s.players[0].hand); // devolve o deal original ao muro
    // 234m 567m 234p 67p 99s -> espera 5p/8p
    s.players[0].hand = idsForFaces(s, [
      f('man', 2), f('man', 3), f('man', 4),
      f('man', 5), f('man', 6), f('man', 7),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('pin', 6), f('pin', 7),
      f('sou', 9), f('sou', 9),
    ]);
    // uma cópia do 5-pin já visível no descarte do seat 1
    const [id5p] = idsForFaces(s, [f('pin', 5)]);
    s.players[1].discards.push(id5p);

    const w = waitsWithCounts(s, 0, handFaces(s, 0));
    const byFace = new Map(w.map((x) => [x.face, x.left]));
    expect(w).toHaveLength(2);
    expect(byFace.get(faceIndex(f('pin', 5)))).toBe(3); // 4 - 1 visível
    expect(byFace.get(faceIndex(f('pin', 8)))).toBe(4);
  });

  it('respeita o ruleset: sete pares em MCR aparece como espera', () => {
    const s = newMatch(mcrRuleset(), 888);
    s.wall.push(...s.players[0].hand); // devolve o deal original ao muro
    // 6 pares + 8s isolado -> só o 8s completa (tanki de sete pares)
    s.players[0].hand = idsForFaces(s, [
      f('man', 2), f('man', 2), f('man', 3), f('man', 3),
      f('pin', 4), f('pin', 4), f('pin', 5), f('pin', 5),
      f('sou', 6), f('sou', 6), f('sou', 7), f('sou', 7),
      f('sou', 8),
    ]);
    const w = waitsWithCounts(s, 0, handFaces(s, 0));
    expect(w).toHaveLength(1);
    expect(w[0].face).toBe(faceIndex(f('sou', 8)));
  });

  it('peças totalmente visíveis (kabe) aparecem com 0 restantes', () => {
    const s = newMatch(HK_DEFAULTS, 999);
    s.wall.push(...s.players[0].hand); // devolve o deal original ao muro
    s.players[0].hand = idsForFaces(s, [
      f('man', 2), f('man', 3), f('man', 4),
      f('man', 5), f('man', 6), f('man', 7),
      f('pin', 2), f('pin', 3), f('pin', 4),
      f('pin', 6), f('pin', 7),
      f('sou', 9), f('sou', 9),
    ]);
    // as 4 cópias do 8-pin visíveis: 1 descarte + pon exposto
    const ids8p = idsForFaces(s, [f('pin', 8), f('pin', 8), f('pin', 8), f('pin', 8)]);
    s.players[1].discards.push(ids8p[0]);
    s.players[2].melds.push({ kind: 'pon', tiles: [ids8p[1], ids8p[2], ids8p[3]], from: 1, added: false });
    const w = waitsWithCounts(s, 0, handFaces(s, 0));
    const byFace = new Map(w.map((x) => [x.face, x.left]));
    expect(byFace.get(faceIndex(f('pin', 8)))).toBe(0);
  });
});
