import { describe, it, expect } from 'vitest';
import { mcrRuleset, MCR_FAN_TABLE, MCR_EXCLUDES, MCR_DEFAULTS as MCR_DEFAULTS_CFG, mcrCacheStats, clearMCRCache, knittedStraightVariants } from '../game-engine/rules/mcr';
import { countsFromFaces } from '../game-engine/traditional/hand';
import { faceIndex, type TileFace } from '../game-engine/tiles/tiles';

/* Tests for the COMPLETE official MCR table (81 scoring elements) —
 * source: WMO Green Book (mcr_EN.pdf), section 3.8.1 + Appendix 1. */

const F = (suit: TileFace['suit'], rank: number): TileFace => ({ suit, rank });
const man = (r: number) => F('man', r);
const pin = (r: number) => F('pin', r);
const sou = (r: number) => F('sou', r);
const wind = (r: number) => F('wind', r); // 1=E 2=S 3=W 4=N
const dragon = (r: number) => F('dragon', r); // 1=red 2=green 3=white

const M = mcrRuleset();

type Meld = { kind: 'chi' | 'pon' | 'kan' | 'ankan'; faces: [number, number, number, number?] };
const base = {
  melds: [] as Meld[],
  winFace: 0,
  selfDrawn: false,
  seatWind: 2,
  roundWind: 1,
  flowers: 0,
  seasons: 0,
  winOnKong: false,
  robbedKong: false,
  lastTile: false,
  riichi: false,
  ippatsu: false,
  doraIndicators: [],
  uraIndicators: [],
};

const nums = (ctx: ReturnType<typeof M.score>) => ctx.items.map((i) => Number(i.name.slice(0, 2)));
const has = (ctx: ReturnType<typeof M.score>, n: number) => nums(ctx).includes(n);

describe('MCR — tabela oficial completa (81 itens)', () => {
  it('a tabela tem 81 elementos com a distribuição oficial por nível', () => {
    expect(MCR_FAN_TABLE).toHaveLength(81);
    const per: Record<number, number> = {};
    for (const f of MCR_FAN_TABLE) per[f.value] = (per[f.value] ?? 0) + 1;
    expect(per).toEqual({ 88: 7, 64: 6, 48: 2, 32: 3, 24: 9, 16: 6, 12: 5, 8: 10, 6: 6, 4: 4, 2: 10, 1: 13 });
    MCR_FAN_TABLE.forEach((f, i) => expect(f.n).toBe(i + 1));
  });

  it('88 — Grandes Quatro Ventos exclui ventos individuais, toitoi e幺九刻; cap em 88', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([wind(1), wind(1), wind(1), wind(2), wind(2), wind(2), wind(3), wind(3), wind(3), wind(4), wind(4), wind(4), man(1), man(1)]),
      winFace: faceIndex(wind(4)),
    });
    expect(has(res, 1)).toBe(true);
    expect(has(res, 18)).toBe(true); // all terminals & honors combines
    for (const n of [38, 49, 60, 61, 73]) expect(has(res, n)).toBe(false);
    expect(res.points).toBe(88); // capped
    expect(res.capped).toBe(true);
  });

  it('88 — Três Grandes Dragões exclui Dois Dragões e Trinca de Dragão', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([dragon(1), dragon(1), dragon(1), dragon(2), dragon(2), dragon(2), dragon(3), dragon(3), dragon(3), wind(1), wind(1), wind(1), man(9), man(9)]),
      winFace: faceIndex(man(9)),
    });
    expect(has(res, 2)).toBe(true);
    expect(has(res, 54)).toBe(false);
    expect(has(res, 59)).toBe(false);
    expect(has(res, 18)).toBe(true);
  });

  it('88 — Treze Órfãos', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(9), pin(1), pin(9), sou(1), sou(9), wind(1), wind(2), wind(3), wind(4), dragon(1), dragon(2), dragon(3), man(1)]),
      winFace: faceIndex(man(1)),
    });
    expect(has(res, 7)).toBe(true);
    expect(res.points).toBe(88);
  });

  it('88 — Nove Portões (mão fechada, 1112345678999 + extra)', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(1), man(1), man(2), man(3), man(4), man(5), man(5), man(6), man(7), man(8), man(9), man(9), man(9)]),
      winFace: faceIndex(man(5)),
      selfDrawn: true,
    });
    expect(has(res, 4)).toBe(true);
    expect(has(res, 22)).toBe(false); // full flush excluded by nine gates
    expect(res.points).toBe(88);
  });

  it('88 — Sete Pares em Escada exclui sete pares, cor pura, mão fechada e tanki', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(1), man(2), man(2), man(3), man(3), man(4), man(4), man(5), man(5), man(6), man(6), man(7), man(7)]),
      winFace: faceIndex(man(7)),
      selfDrawn: true,
    });
    expect(has(res, 6)).toBe(true);
    for (const n of [19, 22, 62, 79]) expect(has(res, n)).toBe(false);
    expect(res.points).toBe(88);
  });

  it('64 — Quatro Pequenos Ventos exclui vento dominante/do lugar e três ventos (edição chinesa)', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([wind(1), wind(1), wind(1), wind(2), wind(2), wind(2), wind(3), wind(3), wind(3), wind(4), wind(4), man(1), man(1), man(1)]),
      winFace: faceIndex(man(1)),
    });
    expect(has(res, 9)).toBe(true);
    for (const n of [38, 49, 60, 61]) expect(has(res, n)).toBe(false);
    expect(has(res, 18)).toBe(true);
  });

  it('64 — Todas Honras + 2 — Trinca de Dragão combinam', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([wind(1), wind(1), wind(1), wind(2), wind(2), wind(2), wind(3), wind(3), wind(3), dragon(1), dragon(1), dragon(1), dragon(2), dragon(2)]),
      winFace: faceIndex(dragon(2)),
    });
    expect(has(res, 11)).toBe(true);
    expect(has(res, 59)).toBe(true);
    expect(has(res, 49)).toBe(false); // excluded by all honors
  });

  it('48 — Sequência Quádrupla exclui tripla pura, dupla pura e quatro-de-uma-peça', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(1), man(1), man(1), man(2), man(2), man(2), man(2), man(3), man(3), man(3), man(3), man(9), man(9)]),
      winFace: faceIndex(man(9)),
    });
    expect(has(res, 14)).toBe(true);
    for (const n of [23, 64, 69]) expect(has(res, n)).toBe(false);
    expect(has(res, 22)).toBe(true); // full flush combines
  });

  it('32 — Três Kongs exclui os fan de kong menores', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([sou(9), sou(9)]),
      melds: [
        { kind: 'kan', faces: [faceIndex(man(1)), faceIndex(man(1)), faceIndex(man(1)), faceIndex(man(1))] },
        { kind: 'ankan', faces: [faceIndex(pin(2)), faceIndex(pin(2)), faceIndex(pin(2)), faceIndex(pin(2))] },
        { kind: 'kan', faces: [faceIndex(sou(3)), faceIndex(sou(3)), faceIndex(sou(3)), faceIndex(sou(3))] },
        { kind: 'chi', faces: [faceIndex(man(4)), faceIndex(man(5)), faceIndex(man(6))] },
      ],
      winFace: faceIndex(sou(9)),
    });
    expect(has(res, 17)).toBe(true);
    for (const n of [48, 57, 67, 74]) expect(has(res, n)).toBe(false);
  });

  it('24 — Cor Pura + Peças Superiores via Trincas do Mesmo Número', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(7), man(7), man(7), pin(7), pin(7), pin(7), sou(7), sou(7), sou(7), sou(8), sou(8), sou(8), sou(9), sou(9)]),
      winFace: faceIndex(sou(9)),
    });
    expect(has(res, 25)).toBe(true);
    expect(has(res, 32)).toBe(true);
    expect(has(res, 65)).toBe(true);
  });

  it('16 — Sequência Pura exclui Sequência Curta e 123+789 (edição chinesa)', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), man(1), man(2), man(3), sou(5), sou(5)]),
      winFace: faceIndex(man(3)),
    });
    expect(has(res, 28)).toBe(true);
    expect(has(res, 71)).toBe(false);
    expect(has(res, 72)).toBe(false);
    expect(has(res, 69)).toBe(true); // pure double chow combines
  });

  it('12 — Sequência Tricotada (組合龍) vale sem mãos padrão', () => {
    const counts = countsFromFaces([man(1), man(4), man(7), pin(2), pin(5), pin(8), sou(3), sou(6), sou(9), wind(1), wind(1), wind(1), wind(2), wind(2)]);
    expect(M.canWin(counts, 0)).toBe(true);
    const res = M.score({ ...base, concealedCounts: counts, winFace: faceIndex(sou(9)) });
    expect(has(res, 35)).toBe(true);
    expect(has(res, 73)).toBe(true); // east pung
    expect(res.meetsMinimum).toBe(true);
  });

  it('12/24 — 全不靠 e 七星不靠 são mãos válidas', () => {
    const lesser = countsFromFaces([man(1), man(4), man(7), pin(2), pin(5), pin(8), sou(3), sou(6), sou(9), wind(1), wind(2), wind(3), wind(4), dragon(1)]);
    expect(M.canWin(lesser, 0)).toBe(true);
    const r1 = M.score({ ...base, concealedCounts: lesser, winFace: faceIndex(dragon(1)) });
    expect(has(r1, 34)).toBe(true);
    expect(has(r1, 52)).toBe(false); // all types excluded by knitted
    expect(r1.points).toBe(12);

    const greater = countsFromFaces([man(1), man(4), man(7), pin(2), pin(5), pin(8), sou(3), wind(1), wind(2), wind(3), wind(4), dragon(1), dragon(2), dragon(3)]);
    expect(M.canWin(greater, 0)).toBe(true);
    const r2 = M.score({ ...base, concealedCounts: greater, winFace: faceIndex(sou(3)) });
    expect(has(r2, 20)).toBe(true);
    expect(has(r2, 34)).toBe(false); // lesser excluded by greater
    expect(r2.points).toBe(24);
  });

  it('8 — Sequência Mista; 4 — Última de Seu Tipo (3 visíveis); 8 — Roubo do Kong exclui #58', () => {
    const counts = countsFromFaces([man(1), man(2), man(3), pin(4), pin(5), pin(6), sou(7), sou(8), sou(9), man(5), man(5), man(5), sou(9), sou(9)]);
    const r1 = M.score({ ...base, concealedCounts: counts, winFace: faceIndex(sou(9)) });
    expect(has(r1, 39)).toBe(true);

    const r2 = M.score({ ...base, concealedCounts: counts, winFace: faceIndex(sou(9)), winTileVisible: 3 });
    expect(has(r2, 58)).toBe(true);

    const r3 = M.score({ ...base, concealedCounts: counts, winFace: faceIndex(sou(9)), winTileVisible: 3, robbedKong: true });
    expect(has(r3, 47)).toBe(true);
    expect(has(r3, 58)).toBe(false);
  });

  it('6 — Cinco Tipos (五門斉)', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(2), man(3), pin(4), pin(5), pin(6), sou(7), sou(8), sou(9), wind(1), wind(1), wind(1), dragon(1), dragon(1)]),
      winFace: faceIndex(dragon(1)),
    });
    expect(has(res, 52)).toBe(true);
  });

  it('6 — Mão Toda Aberta (全求人) exige 4 melds abertos + tanki + ron', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(1)]),
      melds: [
        { kind: 'chi', faces: [faceIndex(man(2)), faceIndex(man(3)), faceIndex(man(4))] },
        { kind: 'pon', faces: [faceIndex(pin(5)), faceIndex(pin(5)), faceIndex(pin(5))] },
        { kind: 'pon', faces: [faceIndex(sou(7)), faceIndex(sou(7)), faceIndex(sou(7))] },
        { kind: 'pon', faces: [faceIndex(wind(1)), faceIndex(wind(1)), faceIndex(wind(1))] },
      ],
      winFace: faceIndex(man(1)),
      selfDrawn: false,
    });
    expect(has(res, 53)).toBe(true);
    expect(has(res, 79)).toBe(false); // single wait excluded
  });

  it('4 — Mão Externa; 2 — Quatro de Uma Peça; 2 — Duas Trincas Fechadas', () => {
    const outside = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(1), man(2), man(3), pin(7), pin(8), pin(9), wind(1), wind(1), wind(1), sou(9), sou(9), sou(9), pin(1), pin(1)]),
      winFace: faceIndex(pin(1)),
    });
    expect(has(outside, 55)).toBe(true);

    const hog = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(2), man(2), man(2), man(1), man(2), man(3), pin(4), pin(5), pin(6), sou(7), sou(8), sou(9), sou(9), sou(9)]),
      winFace: faceIndex(sou(7)),
    });
    expect(has(hog, 64)).toBe(true);

    const twoConcealed = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(2), man(2), man(2), sou(4), sou(5), sou(6), sou(7), sou(8), sou(9), pin(1), pin(1)]),
      melds: [{ kind: 'ankan', faces: [faceIndex(pin(3)), faceIndex(pin(3)), faceIndex(pin(3)), faceIndex(pin(3))] }],
      winFace: faceIndex(pin(1)),
      selfDrawn: true,
    });
    expect(has(twoConcealed, 66)).toBe(true);
    expect(has(twoConcealed, 67)).toBe(true);
  });

  it('4 — Dois Kongs Abertos exclui Kong Aberto; kong fechado + aberto = 4+2', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([sou(4), sou(5), sou(6), sou(7), sou(8), sou(9), man(5), man(5)]),
      melds: [
        { kind: 'kan', faces: [faceIndex(man(1)), faceIndex(man(1)), faceIndex(man(1)), faceIndex(man(1))] },
        { kind: 'kan', faces: [faceIndex(pin(2)), faceIndex(pin(2)), faceIndex(pin(2)), faceIndex(pin(2))] },
      ],
      winFace: faceIndex(man(5)),
    });
    expect(has(res, 57)).toBe(true);
    expect(has(res, 74)).toBe(false);
  });

  it('8 — Mão sem Fan (無番和): 0 fan estruturais → exatamente 8', () => {
    const res = M.score({
      ...base,
      concealedCounts: countsFromFaces([man(7), man(8), man(9), pin(5), pin(6), pin(7), sou(2), sou(3), sou(4), wind(2), wind(2)]),
      melds: [{ kind: 'chi', faces: [faceIndex(man(3)), faceIndex(man(4)), faceIndex(man(5))] }],
      winFace: faceIndex(man(9)),
      selfDrawn: false,
    });
    expect(res.items.map((i) => i.name)).toEqual(['43. Mão sem Fan (无番和)']);
    expect(res.points).toBe(8);
  });

  it('1 — esperas: borda e central classificadas pela decomposição', () => {
    // 11 concealed (789s 234m 555s 99m) + melded 678p
    const concealed = countsFromFaces([sou(7), sou(8), sou(9), man(2), man(3), man(4), sou(5), sou(5), sou(5), man(9), man(9)]);
    const melds: Meld[] = [{ kind: 'chi', faces: [faceIndex(pin(6)), faceIndex(pin(7)), faceIndex(pin(8))] }];
    const edge = M.score({ ...base, concealedCounts: concealed, melds, winFace: faceIndex(sou(7)) });
    expect(has(edge, 77)).toBe(true);

    const closedW = M.score({ ...base, concealedCounts: concealed, melds, winFace: faceIndex(sou(8)) });
    expect(has(closedW, 78)).toBe(true);
  });

  it('flores: 1 fan por peça + bônus por posição (house rule) sem contar no mínimo', () => {
    const counts = countsFromFaces([man(1), man(2), man(3), pin(4), pin(5), pin(6), sou(7), sou(8), sou(9), man(5), man(5), man(5), sou(9), sou(9)]);
    const res = M.score({
      ...base,
      concealedCounts: counts,
      winFace: faceIndex(sou(9)),
      seatWind: 2,
      flowers: 2,
      seasons: 1,
      flowerRanks: [2, 4],
      seasonRanks: [1],
    });
    // 3 flowers = 3 fan; position matches: flower#2 = seat 2 → +1 bonus
    expect(res.items.find((i) => i.name.startsWith('81'))?.fan).toBe(3);
    expect(res.items.find((i) => i.name.startsWith('Bônus'))?.fan).toBe(1);
    expect(res.qualifyingFan).toBe(res.totalFan - 4);
    // sem ranks (contextos antigos) não há bônus
    const noRanks = M.score({ ...base, concealedCounts: counts, winFace: faceIndex(sou(9)), flowers: 2 });
    expect(noRanks.items.some((i) => i.name.startsWith('Bônus'))).toBe(false);
  });

  it('mínimo de 8 fan e cap de 88 valem para a tabela completa', () => {
    const cfgOff = mcrRuleset({ handsPerMatch: 4, renchan: false, minFan: 8, flowerPositionBonus: false });
    const poor = cfgOff.score({
      ...base,
      concealedCounts: countsFromFaces([man(2), man(3), man(4), man(5), man(6), man(7), pin(2), pin(3), pin(4), sou(6), sou(7), sou(8), wind(2), wind(2)]),
      winFace: faceIndex(sou(8)),
      flowers: 8,
    });
    expect(poor.meetsMinimum).toBe(false);
    expect(poor.points).toBe(0);
  });

  it('tabela de exclusões referencia apenas fan existentes', () => {
    for (const [k, xs] of Object.entries(MCR_EXCLUDES)) {
      expect(Number(k)).toBeGreaterThanOrEqual(1);
      for (const x of xs) expect(MCR_FAN_TABLE[x - 1]?.n).toBe(x);
    }
  });
});

describe('item 6c — cache de decomposições e multi-decomposição', () => {
  it('fan de espera vem da MELHOR decomposição (par 78999 → 单钓将; 46→5 → 嵌张)', () => {
    // 78999s + 123m + 456p + 111e, vitória no 9s: a única decomposição
    // válida usa 99s como par → espera única (79)
    const r1 = M.score({
      ...base,
      concealedCounts: countsFromFaces([
        sou(7), sou(8), sou(9), sou(9), sou(9),
        man(1), man(2), man(3),
        pin(4), pin(5), pin(6),
        wind(1), wind(1), wind(1),
      ]),
      winFace: faceIndex(sou(9)),
    });
    expect(has(r1, 79)).toBe(true); // 单钓将
    expect(has(r1, 73)).toBe(true); // 111e 幺九刻

    // 46s esperando 5s → espera central (78)
    const r2 = M.score({
      ...base,
      concealedCounts: countsFromFaces([
        sou(4), sou(5), sou(6),
        man(1), man(2), man(3),
        pin(4), pin(5), pin(6),
        wind(1), wind(1), wind(1),
        dragon(1), dragon(1),
      ]),
      winFace: faceIndex(sou(5)),
    });
    expect(has(r2, 78)).toBe(true); // 嵌张
  });

  it('組合龍: variantes enumeradas (resto como trinca) pontuam 组合龙', () => {
    const counts = countsFromFaces([
      man(1), man(4), man(7), // grupo 147 em man
      sou(2), sou(5), sou(8), // grupo 258 em sou
      pin(3), pin(6), pin(9), // grupo 369 em pin
      man(5), man(5), man(5),
      pin(8), pin(8),
    ]);
    expect(M.canWin(counts, 0)).toBe(true);
    const variants = knittedStraightVariants(counts);
    expect(variants.length).toBeGreaterThanOrEqual(1);
    expect(variants[0].rest.pungs).toEqual([faceIndex(man(5))]);
    const res = M.score({ ...base, concealedCounts: counts, winFace: faceIndex(man(5)) });
    expect(has(res, 35)).toBe(true); // 组合龙
  });

  it('cache: resultados idênticos com cache frio e quente (150 mãos aleatórias)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const FACES: TileFace[] = [];
    for (const suit of ['man', 'pin', 'sou'] as const)
      for (let r = 1; r <= 9; r++) FACES.push({ suit, rank: r });
    for (let r = 1; r <= 4; r++) FACES.push({ suit: 'wind', rank: r });
    for (let r = 1; r <= 3; r++) FACES.push({ suit: 'dragon', rank: r });

    for (let i = 0; i < 150; i++) {
      const faces: TileFace[] = [];
      for (let k = 0; k < 14; k++) faces.push(FACES[Math.floor(rnd() * FACES.length)]);
      const counts = countsFromFaces(faces);
      const ctx = {
        ...base,
        concealedCounts: counts,
        winFace: faceIndex(faces[13]),
        selfDrawn: i % 2 === 0,
      };
      clearMCRCache();
      const cold = M.score(ctx);
      const warm = M.score(ctx); // segunda chamada bate no cache
      expect(warm.totalFan).toBe(cold.totalFan);
      expect(nums(warm).sort((a, b) => a - b)).toEqual(nums(cold).sort((a, b) => a - b));
    }
    const st = mcrCacheStats();
    expect(st.hits).toBeGreaterThan(0);
    expect(st.size).toBeGreaterThan(0);
  });

  it('cache: repetir a mesma mão 1500× é mais rápido quente do que fria', () => {
    // mão rica em decomposições (九蓮宝燈-like) para isolar o custo do walk
    const ctx = {
      ...base,
      concealedCounts: countsFromFaces([
        man(1), man(1), man(1), man(2), man(3), man(4), man(5),
        man(6), man(7), man(8), man(9), man(9), man(9),
        pin(5), pin(5),
      ]),
      winFace: faceIndex(man(5)),
    };
    const t0 = performance.now();
    for (let i = 0; i < 1500; i++) {
      clearMCRCache();
      M.score(ctx);
    }
    const coldMs = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 1500; i++) M.score(ctx);
    const warmMs = performance.now() - t1;
    expect(warmMs).toBeLessThan(coldMs);
    expect(mcrCacheStats().hits).toBeGreaterThanOrEqual(1500);
  });
});

describe('item 7d — house rules MCR configuráveis', () => {
  // mão de 4 fan: 无字(76) + 平和(63) + 连六(71) — 123m 456m 789s 234p + 55p
  const smallHand = {
    ...base,
    concealedCounts: countsFromFaces([
      man(1), man(2), man(3), man(4), man(5), man(6),
      sou(7), sou(8), sou(9),
      pin(2), pin(3), pin(4),
      pin(5), pin(5),
    ]),
    winFace: faceIndex(pin(5)),
  };

  it('minFan configurável: 6 aprova a mão de 6 fan (fronteira); 8 (oficial) reprova', () => {
    // a mão vale 6 fan: 门前清(62) + 平和(63) + 连六(71) + 单钓将(79)
    // (平和 exclui oficialmente 无字)
    const loose = mcrRuleset({ ...MCR_DEFAULTS_CFG, minFan: 6 });
    const strict = mcrRuleset({ ...MCR_DEFAULTS_CFG, minFan: 8 });
    const rLoose = loose.score(smallHand);
    const rStrict = strict.score(smallHand);
    expect(rLoose.qualifyingFan).toBe(6);
    expect(rLoose.meetsMinimum).toBe(true);
    expect(rLoose.points).toBeGreaterThan(0);
    expect(rStrict.meetsMinimum).toBe(false);
    expect(rStrict.points).toBe(0);
  });

  it('flowerPositionBonus: ligado dá +1 por flor com o número do vento; desligado não', () => {
    const on = mcrRuleset({ ...MCR_DEFAULTS_CFG, flowerPositionBonus: true });
    const off = mcrRuleset({ ...MCR_DEFAULTS_CFG, flowerPositionBonus: false });
    const ctx = {
      ...smallHand,
      flowers: 1,
      flowerRanks: [2], // seatWind do base é 2 → bate
    };
    const rOn = on.score(ctx);
    const rOff = off.score(ctx);
    expect(rOn.items.some((i) => i.name.includes('Bônus de posição'))).toBe(true);
    expect(rOn.totalFan).toBe(rOff.totalFan + 1);
    expect(rOff.items.some((i) => i.name.includes('Bônus'))).toBe(false);
    // em ambos, a flor em si vale 1 fan (não conta no mínimo)
    expect(rOn.items.some((i) => i.name.includes('花牌') || i.name.includes('Flores'))).toBe(true);
  });
});
