import { isCompleteHand, isSevenPairs, isThirteenOrphans } from '../traditional/hand';
import type { FanItem, ScoringResult } from '../scoring/hongkong-scoring';
import type { MeldLike } from '../scoring/hongkong-scoring';
import type { Counts } from '../traditional/hand';
import type { Ruleset, WinContext } from './ruleset';

/* ============================================================================
 * MCR — MAHJONG COMPETITION RULES (China 1998 / WMO Green Book 2006).
 *
 * TABELA COMPLETA: os 81 elementos de pontuação oficiais, nos 12 níveis
 * (88/64/48/32/24/16/12/8/6/4/2/1), com a tabela oficial de exclusões
 * ("does not combine with"). Fonte: Green Book (mahjong-europe.org,
 * mcr_EN.pdf), seção 3.8.1 + Apêndice 1. Onde a tradução inglesa diverge da
 * edição chinesa (que o prefácio declara prevalecente) seguimos a chinesa —
 * casos documentados nos comentários de EXCLUDES.
 *
 * Mãos irregulares suportadas: Sete Pares, Treze Órfãos, 全不靠 (Lesser
 * Honors & Knitted), 七星不靠 (Greater Honors & Knitted) e 組合龍 (Knitted
 * Straight). Todas exigem mão fechada.
 *
 * Flores/estações: 1 fan por peça (#81 oficial, nunca conta no mínimo de 8)
 * + BÔNUS POR POSIÇÃO (house rule configurável, padrão ligado): peça de
 * flor/estação cujo número bate com o vento do lugar dá +1 fan extra.
 *
 * Pagamentos (oficial MCR): tsumo — cada adversário paga fan+8;
 * ron — descartador paga fan+8, demais pagam 8. Cap de 88 fan.
 * ========================================================================== */

export interface MCRConfig {
  handsPerMatch: number;
  renchan: boolean;
  minFan: number;
  /** house rule: flower/season matching the seat wind scores +1 extra fan */
  flowerPositionBonus: boolean;
}

export const MCR_DEFAULTS: MCRConfig = {
  handsPerMatch: 4,
  renchan: false,
  minFan: 8,
  flowerPositionBonus: true,
};

/** one row of the official 81-element table */
export interface FanDef {
  n: number;
  value: number;
  en: string;
  pt: string;
  cn: string;
}

/** the complete official MCR scoring table (Green Book 3.8.1) */
export const MCR_FAN_TABLE: FanDef[] = [
  { n: 1, value: 88, en: 'Big Four Winds', pt: 'Grandes Quatro Ventos', cn: '大四喜' },
  { n: 2, value: 88, en: 'Big Three Dragons', pt: 'Três Grandes Dragões', cn: '大三元' },
  { n: 3, value: 88, en: 'All Green', pt: 'Tudo Verde', cn: '绿一色' },
  { n: 4, value: 88, en: 'Nine Gates', pt: 'Nove Portões', cn: '九莲宝灯' },
  { n: 5, value: 88, en: 'Four Kongs', pt: 'Quatro Kongs', cn: '四杠' },
  { n: 6, value: 88, en: 'Seven Shifted Pairs', pt: 'Sete Pares em Escada', cn: '连七对' },
  { n: 7, value: 88, en: 'Thirteen Orphans', pt: 'Treze Órfãos', cn: '十三幺' },
  { n: 8, value: 64, en: 'All Terminals', pt: 'Terminais Puros', cn: '清幺九' },
  { n: 9, value: 64, en: 'Little Four Winds', pt: 'Quatro Pequenos Ventos', cn: '小四喜' },
  { n: 10, value: 64, en: 'Little Three Dragons', pt: 'Três Pequenos Dragões', cn: '小三元' },
  { n: 11, value: 64, en: 'All Honors', pt: 'Todas Honras', cn: '字一色' },
  { n: 12, value: 64, en: 'Four Concealed Pungs', pt: 'Quatro Trincas Fechadas', cn: '四暗刻' },
  { n: 13, value: 64, en: 'Pure Terminal Chows', pt: 'Terminais Duplos de Um Naipe', cn: '一色双龙会' },
  { n: 14, value: 48, en: 'Quadruple Chow', pt: 'Sequência Quádrupla', cn: '一色四同顺' },
  { n: 15, value: 48, en: 'Four Pure Shifted Pungs', pt: 'Quatro Trincas em Escada', cn: '一色四节高' },
  { n: 16, value: 32, en: 'Four Pure Shifted Chows', pt: 'Quatro Sequências em Escada', cn: '一色四步高' },
  { n: 17, value: 32, en: 'Three Kongs', pt: 'Três Kongs', cn: '三杠' },
  { n: 18, value: 32, en: 'All Terminals and Honors', pt: 'Terminais e Honras', cn: '混幺九' },
  { n: 19, value: 24, en: 'Seven Pairs', pt: 'Sete Pares', cn: '七对' },
  { n: 20, value: 24, en: 'Greater Honors and Knitted', pt: 'Sete Honras Tricotadas', cn: '七星不靠' },
  { n: 21, value: 24, en: 'All Even Pungs', pt: 'Trincas Todas Pares', cn: '全双刻' },
  { n: 22, value: 24, en: 'Full Flush', pt: 'Cor Pura', cn: '清一色' },
  { n: 23, value: 24, en: 'Pure Triple Chow', pt: 'Sequência Tripla Pura', cn: '一色三同顺' },
  { n: 24, value: 24, en: 'Pure Shifted Pungs', pt: 'Trincas em Escada Puras', cn: '一色三节高' },
  { n: 25, value: 24, en: 'Upper Tiles', pt: 'Peças Superiores (789)', cn: '全大' },
  { n: 26, value: 24, en: 'Middle Tiles', pt: 'Peças do Meio (456)', cn: '全中' },
  { n: 27, value: 24, en: 'Lower Tiles', pt: 'Peças Inferiores (123)', cn: '全小' },
  { n: 28, value: 16, en: 'Pure Straight', pt: 'Sequência Pura 1-9', cn: '清龙' },
  { n: 29, value: 16, en: 'Three-Suited Terminal Chows', pt: 'Terminais em Três Naipes', cn: '三色双龙会' },
  { n: 30, value: 16, en: 'Pure Shifted Chows', pt: 'Sequências em Escada Puras', cn: '一色三步高' },
  { n: 31, value: 16, en: 'All Fives', pt: 'Todos Cincos', cn: '全带五' },
  { n: 32, value: 16, en: 'Triple Pung', pt: 'Trinca Tripla', cn: '三同刻' },
  { n: 33, value: 16, en: 'Three Concealed Pungs', pt: 'Três Trincas Fechadas', cn: '三暗刻' },
  { n: 34, value: 12, en: 'Lesser Honors and Knitted', pt: 'Honras e Tricotadas', cn: '全不靠' },
  { n: 35, value: 12, en: 'Knitted Straight', pt: 'Sequência Tricotada', cn: '组合龙' },
  { n: 36, value: 12, en: 'Upper Four', pt: 'Maiores que Cinco (6-9)', cn: '大于五' },
  { n: 37, value: 12, en: 'Lower Four', pt: 'Menores que Cinco (1-4)', cn: '小于五' },
  { n: 38, value: 12, en: 'Big Three Winds', pt: 'Três Grandes Ventos', cn: '三风刻' },
  { n: 39, value: 8, en: 'Mixed Straight', pt: 'Sequência Mista 123/456/789', cn: '花龙' },
  { n: 40, value: 8, en: 'Reversible Tiles', pt: 'Peças Reversíveis', cn: '推不倒' },
  { n: 41, value: 8, en: 'Mixed Triple Chow', pt: 'Sequência Tripla Mista', cn: '三色三同顺' },
  { n: 42, value: 8, en: 'Mixed Shifted Pungs', pt: 'Trincas em Escada Mistas', cn: '三色三节高' },
  { n: 43, value: 8, en: 'Chicken Hand', pt: 'Mão sem Fan', cn: '无番和' },
  { n: 44, value: 8, en: 'Last Tile Draw', pt: 'Última Peça do Muro (Tsumo)', cn: '妙手回春' },
  { n: 45, value: 8, en: 'Last Tile Claim', pt: 'Último Descarte da Mão', cn: '海底捞月' },
  { n: 46, value: 8, en: 'Out with Replacement Tile', pt: 'Vitória na Peça de Substituição', cn: '杠上开花' },
  { n: 47, value: 8, en: 'Robbing the Kong', pt: 'Roubo do Kong', cn: '抢杠和' },
  { n: 48, value: 8, en: 'Two Concealed Kongs', pt: 'Dois Kongs Fechados', cn: '双暗杠' },
  { n: 49, value: 6, en: 'All Pungs', pt: 'Todas Trincas', cn: '碰碰和' },
  { n: 50, value: 6, en: 'Half Flush', pt: 'Meia Cor', cn: '混一色' },
  { n: 51, value: 6, en: 'Mixed Shifted Chows', pt: 'Sequências em Escada Mistas', cn: '三色三步高' },
  { n: 52, value: 6, en: 'All Types', pt: 'Cinco Tipos', cn: '五门齐' },
  { n: 53, value: 6, en: 'Melded Hand', pt: 'Mão Toda Aberta', cn: '全求人' },
  { n: 54, value: 6, en: 'Two Dragon Pungs', pt: 'Dois Dragões', cn: '双箭刻' },
  { n: 55, value: 4, en: 'Outside Hand', pt: 'Mão Externa', cn: '全带幺' },
  { n: 56, value: 4, en: 'Fully Concealed Hand', pt: 'Fechada e Comprada', cn: '不求人' },
  { n: 57, value: 4, en: 'Two Melded Kongs', pt: 'Dois Kongs Abertos', cn: '双明杠' },
  { n: 58, value: 4, en: 'Last Tile', pt: 'Última de Seu Tipo', cn: '绝张' },
  { n: 59, value: 2, en: 'Dragon Pung', pt: 'Trinca de Dragão', cn: '箭刻' },
  { n: 60, value: 2, en: 'Prevalent Wind', pt: 'Vento Dominante', cn: '圈风刻' },
  { n: 61, value: 2, en: 'Seat Wind', pt: 'Vento do Lugar', cn: '门风刻' },
  { n: 62, value: 2, en: 'Concealed Hand', pt: 'Mão Fechada (Ron)', cn: '门前清' },
  { n: 63, value: 2, en: 'All Chows', pt: 'Todas Sequências', cn: '平和' },
  { n: 64, value: 2, en: 'Tile Hog', pt: 'Quatro de Uma Peça', cn: '四归一' },
  { n: 65, value: 2, en: 'Double Pung', pt: 'Trincas do Mesmo Número', cn: '双同刻' },
  { n: 66, value: 2, en: 'Two Concealed Pungs', pt: 'Duas Trincas Fechadas', cn: '双暗刻' },
  { n: 67, value: 2, en: 'Concealed Kong', pt: 'Kong Fechado', cn: '暗杠' },
  { n: 68, value: 2, en: 'All Simples', pt: 'Tudo Simples', cn: '断幺' },
  { n: 69, value: 1, en: 'Pure Double Chow', pt: 'Sequência Dupla Pura', cn: '一般高' },
  { n: 70, value: 1, en: 'Mixed Double Chow', pt: 'Sequência Dupla Mista', cn: '喜相逢' },
  { n: 71, value: 1, en: 'Short Straight', pt: 'Sequência Curta (6 peças)', cn: '连六' },
  { n: 72, value: 1, en: 'Two Terminal Chows', pt: '123 + 789 do Mesmo Naipe', cn: '老少副' },
  { n: 73, value: 1, en: 'Pung of Terminals or Honors', pt: 'Trinca de Terminal/Vento', cn: '幺九刻' },
  { n: 74, value: 1, en: 'Melded Kong', pt: 'Kong Aberto', cn: '明杠' },
  { n: 75, value: 1, en: 'One Voided Suit', pt: 'Um Naipe Ausente', cn: '缺一门' },
  { n: 76, value: 1, en: 'No Honors', pt: 'Sem Honras', cn: '无字' },
  { n: 77, value: 1, en: 'Edge Wait', pt: 'Espera de Borda', cn: '边张' },
  { n: 78, value: 1, en: 'Closed Wait', pt: 'Espera Central', cn: '嵌张' },
  { n: 79, value: 1, en: 'Single Wait', pt: 'Espera Única', cn: '单钓将' },
  { n: 80, value: 1, en: 'Self-Drawn', pt: 'Compra (Zimo)', cn: '自摸' },
  { n: 81, value: 1, en: 'Flower Tiles', pt: 'Flores/Estações', cn: '花牌' },
];

/**
 * Official exclusion table: fan n → fan numbers it excludes.
 * Sources: Green Book Appendix 1 "Does not combine with" notes plus the
 * implied exclusions of the Chinese edition (preface: the Chinese text
 * prevails over the English translation). Notable Chinese-prevails cases:
 *  - 9  Little Four Winds excludes Prevalent/Seat Wind (the English note
 *    "Combines with Prevalent Wind and Seat Wind" is a translation error);
 *  - 28 Pure Straight excludes Short Straight / Two Terminal Chows;
 *  - 22 Full Flush excludes One Voided Suit and No Honors;
 *  - 38 Big Three Winds excludes Prevalent/Seat Wind.
 */
export const MCR_EXCLUDES: Record<number, number[]> = {
  1: [38, 49, 60, 61, 73],
  2: [54, 59],
  4: [22, 62, 73],
  5: [17, 48, 49, 57, 67, 74, 79],
  6: [19, 22, 62, 79],
  7: [52, 62, 79],
  8: [18, 49, 55, 73, 76],
  9: [38, 49, 60, 61, 73],
  10: [54, 59],
  11: [49, 55, 73],
  12: [33, 49, 66],
  13: [19, 22, 63, 69, 72],
  14: [23, 64, 69],
  15: [24, 49],
  16: [30, 71, 72],
  17: [48, 57, 67, 74],
  18: [49, 73],
  19: [62, 79],
  20: [34, 52, 62],
  21: [49, 68],
  22: [75, 76],
  23: [69],
  24: [23],
  25: [76],
  26: [68, 76],
  27: [76],
  28: [71, 72],
  29: [63, 72, 76],
  31: [68],
  34: [52, 62],
  36: [76],
  37: [76],
  38: [60, 61],
  40: [75],
  41: [70],
  44: [80],
  47: [58],
  48: [67],
  53: [79],
  56: [62, 80],
  57: [74],
  63: [76],
};

/* --------------------------------- helpers -------------------------------- */

const WIND_E = 27;
const suitOf = (f: number) => (f < 27 ? Math.floor(f / 9) : -1);
const rankOf = (f: number) => f % 9;
const isTerm = (f: number) => f < 27 && (f % 9 === 0 || f % 9 === 8);
const isTermOrHonor = (f: number) => f >= WIND_E || isTerm(f);
const isDragon = (f: number) => f >= 31;
const isWind = (f: number) => f >= 27 && f <= 30;
/** vertically symmetric tiles (推不倒): 1234589 dots, 245689 bams, white */
const REVERSIBLE = new Set([0, 1, 2, 3, 4, 7, 8, 10, 12, 13, 14, 16, 17, 33]);
/** knitted group of a 0-based rank: 147→0, 258→1, 369→2 */
const knitGroup = (r: number) => r % 3;

interface SetInfo {
  kind: 'chow' | 'pung' | 'kong' | 'ankan';
  face: number; // pung/kong face, or chow start face
  concealed: boolean;
}

interface Model {
  type:
    | 'standard'
    | 'sevenPairs'
    | 'shiftedPairs'
    | 'orphans'
    | 'knittedLesser'
    | 'knittedGreater'
    | 'knittedStraight';
  sets: SetInfo[];
  pair: number;
  /** knitted straight: the extra set beyond the knitted groups (sets[0]) */
}

/** enumerate every valid 4-sets+pair decomposition of the concealed counts */
function decomposeAll(c: Counts): { pungs: number[]; chows: number[]; pair: number }[] {
  const out: { pungs: number[]; chows: number[]; pair: number }[] = [];
  const MAX = 512;
  const walk = (f: number, cc: Counts, pair: number, pungs: number[], chows: number[]) => {
    if (out.length >= MAX) return;
    while (f < 34 && (cc[f] ?? 0) === 0) f++;
    if (f >= 34) {
      if (pair >= 0) out.push({ pungs: [...pungs], chows: [...chows], pair });
      return;
    }
    if (pair < 0 && (cc[f] ?? 0) >= 2) {
      cc[f] -= 2;
      walk(f, cc, f, pungs, chows);
      cc[f] += 2;
    }
    if ((cc[f] ?? 0) >= 3) {
      cc[f] -= 3;
      pungs.push(f);
      walk(f, cc, pair, pungs, chows);
      pungs.pop();
      cc[f] += 3;
    }
    if (f < 27 && rankOf(f) <= 6 && (cc[f + 1] ?? 0) > 0 && (cc[f + 2] ?? 0) > 0) {
      cc[f]--;
      cc[f + 1]--;
      cc[f + 2]--;
      chows.push(f);
      walk(f, cc, pair, pungs, chows);
      chows.pop();
      cc[f]++;
      cc[f + 1]++;
      cc[f + 2]++;
    }
  };
  walk(0, [...c], -1, [], []);
  return out;
}

/** does `counts` form a knitted hand? returns knitted type or null */
function knittedType(counts: Counts): 'lesser' | 'greater' | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== 14) return null;
  let honors = 0;
  const groups: (number | null)[] = [null, null, null];
  for (let f = 0; f < 34; f++) {
    const n = counts[f] ?? 0;
    if (n === 0) continue;
    if (n > 1) return null; // every tile single
    if (f >= WIND_E) {
      honors++;
      continue;
    }
    const s = suitOf(f);
    const g = knitGroup(rankOf(f));
    if (groups[s] === null) groups[s] = g;
    else if (groups[s] !== g) return null;
  }
  const used = groups.filter((g) => g !== null) as number[];
  if (used.length !== 3 || new Set(used).size !== 3) return null;
  if (honors > 7) return null;
  return honors === 7 ? 'greater' : 'lesser';
}

/**
 * 組合龍 Knitted Straight: reserve one of each of 1-4-7/2-5-8/3-6-9 (one
 * suit per group); the remaining 5 tiles must form one set + pair.
 * Returns the reserved knitted faces plus the decomposition of the rest.
 */
function knittedStraight(counts: Counts): { rest: { pungs: number[]; chows: number[]; pair: number } } | null {
  const groups = [
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
  ];
  const perm = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const p of perm) {
    const cc = [...counts] as Counts;
    let ok = true;
    for (let g = 0; g < 3 && ok; g++) {
      const suit = p[g];
      for (const r of groups[g]) {
        const f = suit * 9 + r;
        if ((cc[f] ?? 0) < 1) {
          ok = false;
          break;
        }
        cc[f]--;
      }
    }
    if (!ok) continue;
    const rest = decomposeAll(cc).find((d) => d.pungs.length + d.chows.length === 1 && d.pair >= 0);
    if (rest) return { rest };
  }
  return null;
}

/* -------------------------------- evaluator ------------------------------- */

interface EvalCtx {
  ctx: WinContext;
  cfg: MCRConfig;
  allFaces: number[];
  faceCount: number[]; // copies of each face in the whole hand
}

function evalModel(m: Model, e: EvalCtx): number[] {
  const hits: number[] = [];
  const add = (n: number) => hits.push(n);
  const { ctx } = e;
  const suits = new Set(e.allFaces.filter((f) => f < 27).map(suitOf));
  const hasHonors = e.allFaces.some((f) => f >= WIND_E);

  const pungs = m.sets.filter((s) => s.kind !== 'chow');
  const chows = m.sets.filter((s) => s.kind === 'chow');
  const pungFaces = pungs.map((s) => s.face);
  const chowStarts = chows.map((s) => s.face);
  const concealedPungs = pungs.filter((s) => s.concealed);
  const meldedKongs = m.sets.filter((s) => s.kind === 'kong').length;
  const concealedKongs = m.sets.filter((s) => s.kind === 'ankan').length;
  const noMelds = ctx.melds.length === 0;

  if (m.type === 'orphans') {
    add(7);
  } else if (m.type === 'sevenPairs' || m.type === 'shiftedPairs') {
    if (m.type === 'shiftedPairs') add(6);
    else add(19);
    // element-based fans where the "elements" are the seven pairs
    if (e.allFaces.every((f) => f >= WIND_E)) add(11);
    if (e.allFaces.every((f) => isTermOrHonor(f))) add(18);
    if (e.allFaces.every(isTerm)) add(8);
    if (suits.size === 1 && !hasHonors) add(22);
    else if (suits.size === 1 && hasHonors) add(50);
    const ranks = e.allFaces.filter((f) => f < 27).map(rankOf);
    if (ranks.length && ranks.every((r) => r >= 6)) add(25);
    if (ranks.length && ranks.every((r) => r >= 3 && r <= 5)) add(26);
    if (ranks.length && ranks.every((r) => r <= 2)) add(27);
    if (ranks.length && ranks.every((r) => r >= 5)) add(36);
    if (ranks.length && ranks.every((r) => r <= 3)) add(37);
    if (e.allFaces.every((f) => REVERSIBLE.has(f))) add(40);
    if (!hasHonors && e.allFaces.every((f) => rankOf(f) >= 1 && rankOf(f) <= 7)) add(68);
    if (suits.size === 2) add(75);
    if (!hasHonors) add(76);
  } else if (m.type === 'knittedLesser' || m.type === 'knittedGreater') {
    add(m.type === 'knittedGreater' ? 20 : 34);
  } else if (m.type === 'knittedStraight') {
    add(35);
    // the extra set + pair may carry its own pung fans
    const s = m.sets[0];
    if (s && s.kind !== 'chow') {
      if (isDragon(s.face)) add(59);
      else if (isWind(s.face)) {
        if (s.face === WIND_E + ctx.seatWind - 1) add(61);
        if (s.face === WIND_E + ctx.roundWind - 1) add(60);
        add(73);
      } else if (isTerm(s.face)) add(73);
    }
    if (!e.allFaces.some((f) => f >= WIND_E)) add(76);
    // All Types: knitted groups cover the 3 suits; set/pair may add winds+dragons
    if (hasAllTypes(e.allFaces)) add(52);
  } else {
    /* ------------------------------ standard ------------------------------ */
    const windPungs = pungFaces.filter(isWind);
    const dragonPungs = pungFaces.filter(isDragon);

    // 88 band
    if (windPungs.length === 4) add(1);
    if (dragonPungs.length === 3) add(2);
    if (e.allFaces.every((f) => f === 32 || (suitOf(f) === 1 && [1, 2, 3, 5, 7].includes(rankOf(f))))) add(3);
    if (meldedKongs + concealedKongs === 4) add(5);

    // 64 band
    if (pungs.length === 4 && e.allFaces.every(isTerm) && isTerm(m.pair)) add(8);
    if (windPungs.length === 3 && isWind(m.pair)) add(9);
    if (dragonPungs.length === 2 && isDragon(m.pair)) add(10);
    if (e.allFaces.every((f) => f >= WIND_E)) add(11);
    if (concealedPungs.length === 4) add(12);
    if (
      chows.length === 4 &&
      suits.size === 1 &&
      !hasHonors &&
      chowStarts.filter((c) => rankOf(c) === 0).length === 2 &&
      chowStarts.filter((c) => rankOf(c) === 6).length === 2 &&
      rankOf(m.pair) === 4
    )
      add(13);

    // 48 band
    const keyCount = new Map<number, number>();
    for (const c of chowStarts) keyCount.set(c, (keyCount.get(c) ?? 0) + 1);
    if ([...keyCount.values()].some((v) => v === 4)) add(14);
    {
      const bySuit = [0, 1, 2].map((s) =>
        pungFaces.filter((f) => suitOf(f) === s).map(rankOf).sort((a, b) => a - b)
      );
      for (const rs of bySuit) {
        if (rs.length === 4 && rs[3] - rs[0] === 3 && new Set(rs).size === 4) add(15);
      }
    }

    // 32 band
    if (meldedKongs + concealedKongs >= 3) add(17);
    if (pungs.length === 4 && e.allFaces.every(isTermOrHonor) && isTermOrHonor(m.pair)) add(18);

    // 24 band
    {
      const bySuit = [0, 1, 2].map((s) =>
        pungFaces.filter((f) => suitOf(f) === s).map(rankOf).sort((a, b) => a - b)
      );
      for (const rs of bySuit) {
        if (rs.length >= 3 && new Set(rs).size === rs.length) {
          for (let i = 0; i + 2 < rs.length; i++) {
            if (rs[i + 2] - rs[i] === 2) add(24);
          }
        }
      }
      if (
        pungs.length === 4 &&
        e.allFaces.every((f) => f < 27 && rankOf(f) % 2 === 1) &&
        m.pair < 27 &&
        rankOf(m.pair) % 2 === 1
      )
        add(21);
    }
    if (suits.size === 1 && !hasHonors) add(22);
    if ([...keyCount.values()].some((v) => v === 3)) add(23);
    {
      const ranks = e.allFaces.filter((f) => f < 27).map(rankOf);
      if (ranks.length && ranks.every((r) => r >= 6)) add(25);
      if (ranks.length && ranks.every((r) => r >= 3 && r <= 5)) add(26);
      if (ranks.length && ranks.every((r) => r <= 2)) add(27);
    }

    // 16 band
    for (let s = 0; s < 3; s++) {
      const starts = chowStarts.filter((c) => suitOf(c) === s).map(rankOf);
      if (starts.includes(0) && starts.includes(3) && starts.includes(6)) add(28);
      const sorted = [...new Set(chowStarts.filter((c) => suitOf(c) === s).map(rankOf))].sort((a, b) => a - b);
      for (let i = 0; i + 2 < sorted.length; i++) {
        const d1 = sorted[i + 1] - sorted[i];
        const d2 = sorted[i + 2] - sorted[i + 1];
        if ((d1 === 1 && d2 === 1) || (d1 === 2 && d2 === 2)) add(30);
      }
    }
    {
      // 29: r0+r6 in two suits, pair = 5 of the third
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) {
          if (a === b) continue;
          const c3 = 3 - a - b;
          if (
            chowStarts.includes(a * 9) &&
            chowStarts.includes(a * 9 + 6) &&
            chowStarts.includes(b * 9) &&
            chowStarts.includes(b * 9 + 6) &&
            chows.length === 4 &&
            suitOf(m.pair) === c3 &&
            rankOf(m.pair) === 4
          )
            add(29);
        }
    }
    if (m.sets.every((s) => s.kind === 'chow' || s.kind === 'pung' || s.kind === 'kong' || s.kind === 'ankan')) {
      const fiveSet = (s: SetInfo) =>
        s.kind === 'chow'
          ? rankOf(s.face) <= 4 && rankOf(s.face) + 2 >= 4
          : rankOf(s.face) === 4;
      if (m.sets.length === 4 && m.sets.every(fiveSet) && m.pair < 27 && rankOf(m.pair) === 4) add(31);
    }
    for (let r = 0; r < 9; r++) {
      const triple = [0, 1, 2].every((s) => pungFaces.includes(s * 9 + r));
      if (triple) add(32);
    }
    if (concealedPungs.length >= 3) add(33);

    // 12 band
    {
      const ranks = e.allFaces.filter((f) => f < 27).map(rankOf);
      if (ranks.length && ranks.every((r) => r >= 5)) add(36);
      if (ranks.length && ranks.every((r) => r <= 3)) add(37);
    }
    if (windPungs.length >= 3) add(38);

    // 8 band
    {
      const s123 = new Set(chowStarts.filter((c) => rankOf(c) === 0).map(suitOf));
      const s456 = new Set(chowStarts.filter((c) => rankOf(c) === 3).map(suitOf));
      const s789 = new Set(chowStarts.filter((c) => rankOf(c) === 6).map(suitOf));
      if ([...s123].some((a) => [...s456].some((b) => b !== a && s789.has(3 - a - b)))) add(39);
    }
    if (e.allFaces.every((f) => REVERSIBLE.has(f))) add(40);
    for (let r = 0; r <= 6; r++) {
      if ([0, 1, 2].every((s) => chowStarts.includes(s * 9 + r))) add(41);
    }
    {
      const bySuitRanks = [0, 1, 2].map((s) => new Set(pungFaces.filter((f) => suitOf(f) === s).map(rankOf)));
      for (let r = 0; r <= 7; r++) {
        if ([0, 1, 2].every((s) => bySuitRanks[s].has(r))) add(42);
        if ([0, 1, 2].every((s) => bySuitRanks[s].has(r + 1))) {
          /* shift-2 variant handled by the r loop too (r and r+1 both hit → deduped later) */
        }
      }
      for (let r = 0; r <= 5; r++) {
        if ([0, 1, 2].every((s) => bySuitRanks[s].has(r + 2))) add(42);
      }
    }

    // 6 band
    if (pungs.length === 4) add(49);
    if (suits.size === 1 && hasHonors) add(50);
    {
      const bySuitRanks = [0, 1, 2].map((s) => new Set(chowStarts.filter((c) => suitOf(c) === s).map(rankOf)));
      for (let r = 0; r <= 6; r++) if ([0, 1, 2].every((s) => bySuitRanks[s].has(r + 1))) add(51);
      for (let r = 0; r <= 4; r++) if ([0, 1, 2].every((s) => bySuitRanks[s].has(r + 2))) add(51);
    }
    if (hasAllTypes(e.allFaces)) add(52);
    if (
      ctx.melds.length === 4 &&
      !ctx.selfDrawn &&
      m.pair === ctx.winFace &&
      e.ctx.concealedCounts[ctx.winFace] === 2
    )
      add(53);
    if (dragonPungs.length >= 2) add(54);

    // 4 band
    const elems: number[][] = [
      ...pungs.map((s) => [s.face]),
      ...chows.map((s) => [s.face, s.face + 1, s.face + 2]),
    ];
    if (elems.length === 4 && elems.every((g) => g.some(isTermOrHonor)) && isTermOrHonor(m.pair)) add(55);
    if (concealedKongs >= 2) add(48);
    else if (meldedKongs + concealedKongs >= 2) add(57);

    // 2 band
    for (let i = 0; i < dragonPungs.length; i++) add(59);
    const seatFace = WIND_E + ctx.seatWind - 1;
    const roundFace = WIND_E + ctx.roundWind - 1;
    if (pungFaces.includes(roundFace)) add(60);
    if (pungFaces.includes(seatFace)) add(61);
    if (chows.length === 4 && m.pair < WIND_E) add(63);
    for (let f = 0; f < 27; f++) {
      const inKong = m.sets.some((s) => (s.kind === 'kong' || s.kind === 'ankan') && s.face === f);
      if ((e.faceCount[f] ?? 0) === 4 && !inKong) add(64);
    }
    {
      const byRank = new Map<number, number>();
      for (const f of new Set(pungFaces)) {
        if (f < 27) byRank.set(rankOf(f), (byRank.get(rankOf(f)) ?? 0) + 1);
      }
      if ([...byRank.values()].some((v) => v >= 2)) add(65);
    }
    if (concealedPungs.length >= 2) add(66);
    for (let i = 0; i < concealedKongs; i++) add(67);
    if (e.allFaces.every((f) => f < 27 && rankOf(f) >= 1 && rankOf(f) <= 7)) add(68);

    // 1 band
    if ([...keyCount.values()].some((v) => v >= 2)) add(69);
    {
      const byRank = new Map<number, Set<number>>();
      for (const c of chowStarts) {
        const r = rankOf(c);
        if (!byRank.has(r)) byRank.set(r, new Set());
        byRank.get(r)!.add(suitOf(c));
      }
      if ([...byRank.values()].some((s) => s.size >= 2)) add(70);
    }
    {
      const bySuit = [0, 1, 2].map((s) => new Set(chowStarts.filter((c) => suitOf(c) === s).map(rankOf)));
      for (const rs of bySuit) {
        for (const r of rs) if (rs.has(r + 3)) add(71);
        if (rs.has(0) && rs.has(6)) add(72);
      }
    }
    for (const f of pungFaces) {
      if (isTerm(f) || isWind(f)) add(73); // dragons score 59 instead
    }
    for (let i = 0; i < meldedKongs; i++) add(74);
    if (suits.size === 2) add(75);
    if (!hasHonors) add(76);

    // wait fan — from the role of the winning tile in THIS decomposition
    const w = ctx.winFace;
    if (m.pair === w) add(79);
    else if (pungFaces.includes(w)) {
      /* shanpon: no wait fan */
    } else {
      const chow = chowStarts.find((c) => w >= c && w <= c + 2);
      if (chow !== undefined) {
        const off = w - chow;
        if (off === 1) add(78);
        else if ((off === 0 && rankOf(w) === 6) || (off === 2 && rankOf(w) === 2)) add(77);
      }
    }
  }

  /* ------------------------- situational (all models) ---------------------- */
  if (ctx.lastTile && ctx.selfDrawn) add(44);
  if (ctx.lastTile && !ctx.selfDrawn) add(45);
  if (ctx.winOnKong) add(46);
  if (ctx.robbedKong) add(47);
  if (ctx.winTileVisible === 3) add(58);
  if (noMelds && ctx.selfDrawn) add(56);
  else if (noMelds && !ctx.selfDrawn && (m.type === 'standard' || m.type === 'knittedStraight')) add(62);
  // (seven pairs / knitted honors / orphans exclude Concealed Hand officially)
  if (ctx.selfDrawn) add(80);

  /* ------------------------------- exclusions ------------------------------ */
  const present = new Set(hits);
  for (const n of [...present].sort((a, b) => b - a)) {
    if (!present.has(n)) continue;
    for (const x of MCR_EXCLUDES[n] ?? []) present.delete(x);
  }
  // keep multiplicity (59/67/74/73/64 score once per instance)
  return hits.filter((n) => present.has(n));
}

function hasAllTypes(allFaces: number[]): boolean {
  return (
    allFaces.some((f) => suitOf(f) === 0) &&
    allFaces.some((f) => suitOf(f) === 1) &&
    allFaces.some((f) => suitOf(f) === 2) &&
    allFaces.some(isWind) &&
    allFaces.some(isDragon)
  );
}

/** seven shifted pairs: same suit, ranks consecutive */
function isShiftedPairs(counts: Counts): boolean {
  if (!isSevenPairs(counts)) return false;
  const faces: number[] = [];
  for (let f = 0; f < 34; f++) if ((counts[f] ?? 0) === 2) faces.push(f);
  if (faces.length !== 7) return false;
  if (new Set(faces.map(suitOf)).size !== 1) return false;
  const ranks = faces.map(rankOf).sort((a, b) => a - b);
  return ranks[6] - ranks[0] === 6 && new Set(ranks).size === 7;
}

/** nine gates: concealed, one suit, pre-win = 1112345678999 */
function isNineGates(ctx: WinContext): boolean {
  if (ctx.melds.length > 0) return false;
  const w = ctx.winFace;
  const s = suitOf(w);
  if (s < 0) return false;
  for (let f = 0; f < 34; f++) {
    if (suitOf(f) !== s && (ctx.concealedCounts[f] ?? 0) !== 0) return false;
  }
  const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  const pre = [...ctx.concealedCounts];
  pre[w] = Math.max(0, pre[w] - 1);
  for (let r = 0; r < 9; r++) if ((pre[s * 9 + r] ?? 0) !== need[r]) return false;
  return true;
}

/* --------------------------------- ruleset -------------------------------- */

export function mcrRuleset(cfg: MCRConfig = MCR_DEFAULTS): Ruleset {
  const fanName = (n: number) => {
    const d = MCR_FAN_TABLE.find((t) => t.n === n)!;
    return `${String(n).padStart(2, '0')}. ${d.pt} (${d.cn})`;
  };

  return {
    id: 'mcr',
    name: 'MCR (Competição)',
    includeBonus: true,
    handsPerMatch: cfg.handsPerMatch,
    renchan: cfg.renchan,
    allowsRiichi: false,

    canWin(concealedCounts, meldsCount) {
      if (
        isCompleteHand(concealedCounts, meldsCount, false) ||
        (meldsCount === 0 && isSevenPairs(concealedCounts)) ||
        (meldsCount === 0 && isThirteenOrphans(concealedCounts))
      )
        return true;
      if (meldsCount === 0) {
        if (knittedType(concealedCounts) !== null) return true;
        if (knittedStraight(concealedCounts) !== null) return true;
      }
      return false;
    },

    score(ctx: WinContext): ScoringResult {
      const faceCount: number[] = new Array(34).fill(0);
      for (let f = 0; f < 34; f++) faceCount[f] = ctx.concealedCounts[f] ?? 0;
      for (const m of ctx.melds) for (const f of m.faces) if (f !== undefined) faceCount[f]++;
      const allFaces: number[] = [];
      for (let f = 0; f < 34; f++) for (let k = 0; k < faceCount[f]; k++) allFaces.push(f);
      const e: EvalCtx = { ctx, cfg, allFaces, faceCount };

      const meldSets: SetInfo[] = ctx.melds.map((m: MeldLike) => ({
        kind: m.kind === 'chi' ? 'chow' : m.kind === 'pon' ? 'pung' : m.kind === 'kan' ? 'kong' : 'ankan',
        face: m.kind === 'chi' ? Math.min(...m.faces.filter((f) => f !== undefined)) : m.faces[0] ?? 0,
        concealed: m.kind === 'ankan', // concealed kongs stay concealed
      }));

      const models: Model[] = [];
      const closed = ctx.melds.length === 0;

      if (closed && isThirteenOrphans(ctx.concealedCounts)) {
        models.push({ type: 'orphans', sets: [], pair: -1 });
      }
      if (closed && isSevenPairs(ctx.concealedCounts)) {
        models.push({ type: isShiftedPairs(ctx.concealedCounts) ? 'shiftedPairs' : 'sevenPairs', sets: [], pair: -1 });
      }
      if (closed) {
        const kt = knittedType(ctx.concealedCounts);
        if (kt) models.push({ type: kt === 'greater' ? 'knittedGreater' : 'knittedLesser', sets: [], pair: -1 });
        const ks = knittedStraight(ctx.concealedCounts);
        if (ks) {
          const s = ks.rest;
          const set: SetInfo =
            s.pungs.length === 1
              ? {
                  kind: 'pung',
                  face: s.pungs[0],
                  // a pung completed by ron is not concealed
                  concealed: !(!ctx.selfDrawn && s.pungs[0] === ctx.winFace),
                }
              : { kind: 'chow', face: s.chows[0], concealed: true };
          models.push({ type: 'knittedStraight', sets: [set], pair: s.pair });
        }
      }
      // standard decompositions (all of them — pick the best-scoring)
      for (const d of decomposeAll(ctx.concealedCounts)) {
        const sets: SetInfo[] = [...meldSets];
        for (const p of d.pungs) {
          sets.push({
            kind: 'pung',
            face: p,
            concealed: !(!ctx.selfDrawn && p === ctx.winFace),
          });
        }
        for (const c of d.chows) sets.push({ kind: 'chow', face: c, concealed: true });
        if (sets.length === 4) models.push({ type: 'standard', sets, pair: d.pair });
      }
      let bestHits: number[] = [];
      let bestTotal = -1;
      for (const m of models) {
        const hits = evalModel(m, e);
        const withNine = isNineGates(ctx) && m.type === 'standard' ? [4, ...hits] : hits;
        const total = withNine.reduce((s, n) => s + (MCR_FAN_TABLE[n - 1]?.value ?? 0), 0);
        if (total > bestTotal) {
          bestTotal = total;
          bestHits = withNine;
        }
      }
      // apply exclusions once more with nine gates present
      if (isNineGates(ctx)) {
        const hitSet = new Set(bestHits);
        for (const n of [...hitSet].sort((a, b) => b - a)) {
          if (!hitSet.has(n)) continue;
          for (const x of MCR_EXCLUDES[n] ?? []) hitSet.delete(x);
        }
        bestHits = [...hitSet];
      }

      // chicken hand: 0 qualifying fan otherwise (flowers excluded)
      if (bestHits.length === 0) bestHits = [43]; // chicken hand: 0 fan otherwise

      const items: FanItem[] = bestHits
        .sort((a, b) => a - b)
        .map((n) => ({ name: fanName(n), fan: MCR_FAN_TABLE[n - 1]!.value, qualifies: true }));

      // flowers & seasons — 1 fan each (+position bonus); never qualify
      const flowerFan = ctx.flowers + ctx.seasons;
      if (flowerFan > 0) items.push({ name: fanName(81), fan: flowerFan, qualifies: false });
      let bonus = 0;
      if (cfg.flowerPositionBonus) {
        const ranks = [...(ctx.flowerRanks ?? []), ...(ctx.seasonRanks ?? [])];
        bonus = ranks.filter((r) => r === ctx.seatWind).length;
        if (bonus > 0)
          items.push({
            name: `Bônus de posição (flor/estação nº ${ctx.seatWind})`,
            fan: bonus,
            qualifies: false,
          });
      }

      const total = items.reduce((s, i) => s + i.fan, 0);
      const qualifying = total - flowerFan - bonus;
      const meetsMinimum = qualifying >= cfg.minFan;
      const points = meetsMinimum ? Math.min(total, 88) : 0;

      return {
        items,
        totalFan: total,
        qualifyingFan: qualifying,
        capped: total >= 88,
        points,
        meetsMinimum,
      };
    },

    payments(points, selfDrawn, discardSeat, winnerSeat, _dealerSeat) {
      const pays = [0, 0, 0, 0];
      if (points <= 0) return pays;
      for (let s = 0; s < 4; s++) {
        if (s === winnerSeat) continue;
        if (selfDrawn) pays[s] = points + 8;
        else pays[s] = s === discardSeat ? points + 8 : 8;
      }
      return pays;
    },

    summary() {
      return [
        'Regras de Competição (MCR 1998): pontuação por fan (pontos)',
        `Tabela oficial completa: ${MCR_FAN_TABLE.length} elementos (88/64/48/32/24/16/12/8/6/4/2/1 fan) + exclusões oficiais`,
        `Mínimo de ${cfg.minFan} fan (flores/estações não contam para o mínimo; cap de 88 fan)`,
        'Mãos especiais: 7 pares · 7 pares em escada · 13 órfãos · 全不靠 · 七星不靠 · 組合龍 · 九蓮宝燈',
        `Flores/estações: 1 fan por peça${cfg.flowerPositionBonus ? ' + 1 fan extra quando o número bate com o vento do lugar' : ''}`,
        'Pagamento: tsumo — todos pagam fan+8; ron — descartador fan+8, demais 8',
        'Sem dora/riichi; chi apenas do jogador à esquerda',
        `Partida: ${cfg.handsPerMatch} mãos${cfg.renchan ? ', dealer repete ao vencer' : ''}`,
      ];
    },
  };
}
