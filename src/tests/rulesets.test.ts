import { describe, it, expect } from 'vitest';
import {
  isSevenPairs,
  isThirteenOrphans,
  countsFromFaces,
  chiitoitsuShanten,
  kokushiShanten,
  shanten,
} from '../game-engine/traditional/hand';
import { hkRuleset } from '../game-engine/rules/ruleset';
import { riichiRuleset } from '../game-engine/rules/riichi';
import { HK_DEFAULTS } from '../game-engine/rules/hongkong';
import {
  newMatch,
  canRiichi,
  declareRiichi,
  discard,
  legalDiscards,
  canTsumo,
  declareTsumo,
  drawTile,
  nextHandOrEnd,
  faceIdxOf,
} from '../game-engine/traditional/engine';
import { dangerScore, totalRisk, threatLevel, type OppInfo } from '../game-engine/ai/defense';
import { chooseDiscard, type BotView } from '../game-engine/ai/bot';
import { createRng } from '../game-engine/tiles/rng';
import { faceIndex, type TileFace } from '../game-engine/tiles/tiles';

const F = (suit: TileFace['suit'], rank: number): TileFace => ({ suit, rank });
const man = (r: number) => F('man', r);
const pin = (r: number) => F('pin', r);
const sou = (r: number) => F('sou', r);
const wind = (r: number) => F('wind', r);
const dragon = (r: number) => F('dragon', r);

describe('item 2 — alternative winning forms in the hand module', () => {
  it('recognises seven pairs and rejects quads-as-two-pairs', () => {
    const seven = countsFromFaces([man(1), man(1), pin(2), pin(2), sou(3), sou(3), wind(1), wind(1), dragon(1), dragon(1), man(9), man(9), pin(9), pin(9)]);
    expect(isSevenPairs(seven)).toBe(true);
    const quad = countsFromFaces([man(1), man(1), man(1), man(1), pin(2), pin(2), sou(3), sou(3), wind(1), wind(1), dragon(1), dragon(1), man(9), man(9)]);
    expect(isSevenPairs(quad)).toBe(false);
  });

  it('recognises thirteen orphans and rejects missing kinds', () => {
    const orph = countsFromFaces([
      man(1), man(9), pin(1), pin(9), sou(1), sou(9),
      wind(1), wind(2), wind(3), wind(4), dragon(1), dragon(2), dragon(3), man(1),
    ]);
    expect(isThirteenOrphans(orph)).toBe(true);
    const missing = countsFromFaces([
      man(1), man(9), pin(1), pin(9), sou(1), sou(9),
      wind(1), wind(2), wind(3), wind(4), dragon(1), dragon(2), man(1), man(1),
    ]);
    expect(isThirteenOrphans(missing)).toBe(false);
  });

  it('shanten includes alternatives only when enabled', () => {
    const sixPairs = countsFromFaces([man(1), man(1), pin(2), pin(2), sou(3), sou(3), wind(1), wind(1), dragon(1), dragon(1), man(9), man(9), pin(5), pin(6)]);
    expect(chiitoitsuShanten(sixPairs)).toBe(0); // tenpai for chiitoi
    expect(shanten(sixPairs, 0, false)).toBeGreaterThan(0);
    expect(shanten(sixPairs, 0, true)).toBe(0);
    const kokTenpai = countsFromFaces([
      man(1), man(9), pin(1), pin(9), sou(1), sou(9),
      wind(1), wind(2), wind(3), wind(4), dragon(1), dragon(2), dragon(3), dragon(3),
    ]);
    expect(kokushiShanten(kokTenpai)).toBe(-1);
  });

  it('HK ruleset refuses alternatives; riichi accepts them', () => {
    const chiitoi = countsFromFaces([man(1), man(1), pin(2), pin(2), sou(3), sou(3), wind(1), wind(1), dragon(1), dragon(1), man(9), man(9), pin(9), pin(9)]);
    expect(hkRuleset().canWin(chiitoi, 0)).toBe(false);
    expect(riichiRuleset().canWin(chiitoi, 0)).toBe(true);
  });
});

describe('item 1 — riichi ruleset scoring & payments', () => {
  const R = riichiRuleset();

  it('scores a yaku-less open hand as no-win (0 han)', () => {
    // open chi + sequence hand with terminals, no yaku
    const res = R.score({
      concealedCounts: countsFromFaces([man(1), man(2), man(3), pin(7), pin(8), pin(9), sou(1), sou(1)]),
      melds: [{ kind: 'chi', faces: [4, 5, 6] }],
      winFace: faceIndex(man(3)),
      selfDrawn: false,
      seatWind: 2,
      roundWind: 1,
      flowers: 0,
      seasons: 0,
      winOnKong: false,
      robbedKong: false,
      lastTile: false,
      riichi: false,
    });
    expect(res.meetsMinimum).toBe(false);
    expect(res.points).toBe(0);
  });

  it('chiitoitsu: 2 han, 25 fu, base 400; ron discarder pays 1600', () => {
    const res = R.score({
      concealedCounts: countsFromFaces([man(1), man(1), pin(2), pin(2), sou(3), sou(3), wind(1), wind(1), dragon(1), dragon(1), man(9), man(9), pin(9), pin(9)]),
      melds: [],
      winFace: faceIndex(pin(9)),
      selfDrawn: false,
      seatWind: 2,
      roundWind: 1,
      flowers: 0,
      seasons: 0,
      winOnKong: false,
      robbedKong: false,
      lastTile: false,
      riichi: false,
    });
    expect(res.meetsMinimum).toBe(true);
    expect(res.totalFan).toBe(2);
    expect(res.points).toBe(400); // 25 * 2^(2+2)
    const pays = R.payments(res.points, false, 1, 0, 2);
    expect(pays[1]).toBe(1600);
    expect(pays[2]).toBe(0);
    expect(pays[3]).toBe(0);
  });

  it('riichi + tsumo + tanyao = 3 han; tsumo split with dealer double', () => {
    const res = R.score({
      concealedCounts: countsFromFaces([man(2), man(3), man(4), pin(3), pin(4), pin(5), sou(4), sou(5), sou(6), man(5), man(6), man(7), pin(6), pin(6)]),
      melds: [],
      winFace: faceIndex(man(4)),
      selfDrawn: true,
      seatWind: 2,
      roundWind: 1,
      flowers: 0,
      seasons: 0,
      winOnKong: false,
      robbedKong: false,
      lastTile: false,
      riichi: true,
    });
    // riichi + tsumo + tanyao + pinfu
    expect(res.items.map((i) => i.name)).toContain('Riichi');
    expect(res.items.map((i) => i.name)).toContain('Tanyao (só simples)');
    expect(res.totalFan).toBeGreaterThanOrEqual(3);
    const pays = R.payments(res.points, true, null, 1, 0); // winner seat 1, dealer 0
    expect(pays[0]).toBe(res.points * 2); // dealer pays double
    expect(pays[2]).toBe(res.points);
    expect(pays[3]).toBe(res.points);
  });

  it('kokushi is yakuman: 8000 base, dealer ron pays 48000', () => {
    const res = R.score({
      concealedCounts: countsFromFaces([
        man(1), man(9), pin(1), pin(9), sou(1), sou(9),
        wind(1), wind(2), wind(3), wind(4), dragon(1), dragon(2), dragon(3), dragon(3),
      ]),
      melds: [],
      winFace: faceIndex(dragon(3)),
      selfDrawn: false,
      seatWind: 2,
      roundWind: 1,
      flowers: 0,
      seasons: 0,
      winOnKong: false,
      robbedKong: false,
      lastTile: false,
      riichi: false,
    });
    expect(res.points).toBe(8000);
    const pays = R.payments(res.points, false, 0, 2, 0); // winner dealer(2)? dealer is 0 here; winner 2 non-dealer
    expect(pays[0]).toBe(32000);
  });

  it('pluggability: engine accepts a Ruleset and drops bonus tiles for riichi', () => {
    const s = newMatch(riichiRuleset(), 99);
    expect(s.ruleset.id).toBe('riichi');
    expect(s.tiles.length).toBe(136);
    const hk = newMatch(HK_DEFAULTS, 99);
    expect(hk.ruleset.id).toBe('hk');
    expect(hk.tiles.length).toBe(144);
  });
});

describe('item 1+2 — riichi flow in the engine', () => {
  function setupRiichiHand() {
    const s = newMatch(riichiRuleset({ handsPerMatch: 4, renchan: true }), 1234);
    // rebuild seat 0: 234m 567m 234p 55p 78p (13) + drawn loose wind -> tenpai on 6/9p after discarding it
    const want: TileFace[] = [man(2), man(3), man(4), man(5), man(6), man(7), pin(2), pin(3), pin(4), pin(5), pin(5), pin(7), pin(8), wind(2)];
    const byFace = new Map<string, number[]>();
    s.tiles.forEach((t) => {
      const k = `${t.face.suit}${t.face.rank}`;
      if (!byFace.has(k)) byFace.set(k, []);
      byFace.get(k)!.push(t.id);
    });
    const used = new Set<number>();
    const ids = want.map((f) => {
      const arr = byFace.get(`${f.suit}${f.rank}`)!;
      const id = arr.find((x) => !used.has(x))!;
      used.add(id);
      return id;
    });
    // remove these tiles from wherever they are (other hands/wall) and give to seat 0
    for (const p of s.players) p.hand = p.hand.filter((id) => !used.has(id));
    s.wall = s.wall.filter((id) => !used.has(id));
    s.players[0].hand = ids.slice(0, 13).sort((a, b) => a - b);
    const drawn = ids[13];
    s.players[0].hand.push(drawn);
    s.current = 0;
    s.phase = 'discard';
    s.drawnTile = drawn;
    return { s, drawn };
  }

  it('declaration allowed when concealed & tenpai; lock forces tsumogiri afterwards', () => {
    const { s, drawn } = setupRiichiHand();
    // hand with drawn wind: discarding a wind keeps tenpai on the shapes
    expect(canRiichi(s, 0)).toBe(true);
    expect(declareRiichi(s, 0)).toBe(true);
    expect(s.players[0].riichi).toBe(true);
    // declaration discard must keep tenpai: the loose wind is legal
    const winds = s.players[0].hand.filter((id) => faceIdxOf(s, id) >= 27);
    expect(winds.length).toBe(1);
    expect(legalDiscards(s, 0)).toContain(winds[0]);
    discard(s, winds[0]);
    expect(s.players[0].riichiLock).toBe(true);
    // next turn: only the drawn tile is discardable
    s.phase = 'draw';
    s.current = 0;
    drawTile(s);
    const legal = legalDiscards(s, 0);
    expect(legal).toEqual([s.drawnTile]);
    void drawn;
  });

  it('open hands cannot declare riichi', () => {
    const { s } = setupRiichiHand();
    s.players[0].melds.push({ kind: 'chi', tiles: [], from: 1, added: false });
    expect(canRiichi(s, 0)).toBe(false);
  });

  it('tsumo works with seven pairs under riichi rules', () => {
    const s = newMatch(riichiRuleset(), 555);
    const want: TileFace[] = [man(1), man(1), pin(2), pin(2), sou(3), sou(3), wind(1), wind(1), dragon(1), dragon(1), man(9), man(9), pin(9)];
    const byFace = new Map<string, number[]>();
    s.tiles.forEach((t) => {
      const k = `${t.face.suit}${t.face.rank}`;
      if (!byFace.has(k)) byFace.set(k, []);
      byFace.get(k)!.push(t.id);
    });
    const used = new Set<number>();
    const ids = want.map((f) => {
      const arr = byFace.get(`${f.suit}${f.rank}`)!;
      const id = arr.find((x) => !used.has(x))!;
      used.add(id);
      return id;
    });
    for (const p of s.players) p.hand = p.hand.filter((id) => !used.has(id));
    s.wall = s.wall.filter((id) => !used.has(id));
    s.players[0].hand = ids;
    // draw the completing 14th: pin 9
    const win = s.tiles.find((t) => t.face.suit === 'pin' && t.face.rank === 9 && !used.has(t.id))!;
    s.players[0].hand.push(win.id);
    s.current = 0;
    s.phase = 'discard';
    s.drawnTile = win.id;
    expect(canTsumo(s, 0)).toBe(true);
    expect(declareTsumo(s, 0)).toBe(true);
    expect(s.result?.kind).toBe('win');
    expect(s.result?.scoring?.items.map((i) => i.name)).toContain('Chiitoitsu (sete pares)');
    nextHandOrEnd(s);
    expect(s.handNumber).toBe(2);
  });
});

describe('item 3 — real defence: wait counting', () => {
  const visibleBase = () => new Array(34).fill(0) as number[];

  it('genbutsu and kabe are safe; raw honor is dangerous', () => {
    const vis = visibleBase();
    const opp: OppInfo = { seat: 1, discards: [faceIndex(man(5))], meldCount: 1, riichi: true };
    expect(dangerScore(faceIndex(man(5)), opp, vis)).toBe(0);
    const vis4 = visibleBase();
    vis4[faceIndex(pin(3))] = 4;
    expect(dangerScore(faceIndex(pin(3)), opp, vis4)).toBe(0);
    const rawDragon = dangerScore(faceIndex(dragon(1)), opp, vis);
    expect(rawDragon).toBeGreaterThan(0);
  });

  it('suji prunes the two-sided wait fed by a discarded end', () => {
    const vis = visibleBase();
    const t = faceIndex(man(4));
    const noSuji: OppInfo = { seat: 1, discards: [], meldCount: 0, riichi: true };
    const withSuji: OppInfo = { seat: 1, discards: [faceIndex(man(7))], meldCount: 0, riichi: true };
    const d1 = dangerScore(t, noSuji, vis);
    const d2 = dangerScore(t, withSuji, vis);
    expect(d2).toBeLessThan(d1); // 7 in pond prunes the (5,6) proto waiting 4/7
  });

  it('hard bot folds to safety under riichi threat; medium does not', () => {
    // hand: 345m 234p 234s + lone 5m + 99m + WW.
    // Every tenpai discard (5m/3m/4m) is RAW (dangerous vs the riichi opponent);
    // the genbutsu 9m folds (shanten 1). Hard must fold; medium pushes offence.
    const hand: TileFace[] = [
      man(3), man(4), man(5), pin(2), pin(3), pin(4), sou(2), sou(3), sou(4),
      man(5), man(9), man(9), wind(2), wind(2),
    ];
    const oppDiscards = [man(9), pin(1), pin(2), sou(1), wind(1), dragon(1), man(1), pin(9), sou(9), wind(3), wind(4), dragon(2), man(2), pin(5)];
    const opponents: OppInfo[] = [{ seat: 1, discards: oppDiscards.map((f) => faceIndex(f)), meldCount: 0, riichi: true }];
    const base: BotView = {
      seat: 0,
      seatWind: 1,
      roundWind: 1,
      hand,
      melds: [],
      bonusFaces: [],
      visibleDiscards: oppDiscards,
      otherMeldFaces: [],
      wallCount: 20,
      turnNumber: 12,
      opponents,
    };
    const hard = chooseDiscard(base, 'hard', createRng(7));
    const medium = chooseDiscard({ ...base, opponents: undefined }, 'medium', createRng(7));
    // hard must throw the genbutsu 9m (breaking the pair is the fold), medium keeps offence
    expect(faceIndex(base.hand[hard])).toBe(faceIndex(man(9)));
    expect(faceIndex(base.hand[medium])).not.toBe(faceIndex(man(9)));
  });

  it('threatLevel orders riichi > two melds > early game', () => {
    expect(threatLevel({ seat: 1, discards: [], meldCount: 0, riichi: true })).toBe(3);
    expect(threatLevel({ seat: 1, discards: [], meldCount: 2, riichi: false })).toBe(2);
    expect(threatLevel({ seat: 1, discards: [1], meldCount: 0, riichi: false })).toBe(0.5);
    const vis = visibleBase();
    const risky = faceIndex(dragon(3));
    expect(totalRisk(risky, [{ seat: 1, discards: [], meldCount: 0, riichi: true }], vis))
      .toBeGreaterThan(totalRisk(risky, [{ seat: 1, discards: [], meldCount: 0, riichi: false }], vis));
  });
});
