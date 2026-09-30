import type { Counts } from '../traditional/hand';
import { isCompleteHand, isSevenPairs, isThirteenOrphans } from '../traditional/hand';
import type { MeldLike, FanItem } from '../scoring/hongkong-scoring';
import type { Ruleset } from './ruleset';
import { indexToFace, isTerminalOrHonor } from '../tiles/tiles';

/**
 * RIICHI MAHJONG — second pluggable ruleset (v1, simplified but coherent).
 *
 * DOCUMENTED SCOPE (v1):
 *  - Wall: 136 tiles (no flowers/seasons).
 *  - Winning forms: standard 4 melds + pair, SEVEN PAIRS (chiitoitsu) and
 *    THIRTEEN ORPHANS (kokushi musou) — alternatives require a concealed hand.
 *  - Yaku (han) implemented: riichi, menzen tsumo, pinfu (simplified ryanmen
 *    check), tanyao, yakuhai (dragons / seat wind / round wind pungs),
 *    chiitoitsu, toi-toi, honitsu, chinitsu, kokushi. Ippatsu, dora, haitei,
 *    sanankou, ittsu etc. are OUT of v1 scope (documented limitation).
 *  - A hand with 0 han CANNOT win (no yaku, no win).
 *  - Fu: fixed 30 (chiitoitsu 25) — full fu counting is out of v1 scope.
 *  - Base points B = roundUp100(fu * 2^(2+han)), capped:
 *      han >= 13 yakuman 8000 · >= 11 sanbaiman 6000 · >= 8 haneman 4000 ·
 *      >= 6 baiman 3000 · >= 5 or B > 2000 mangan 2000.
 *  - Payments: ron — discarder pays 4B (6B if winner is dealer), others 0.
 *    Tsumo — non-dealer winner: dealer pays 2B, others B; dealer winner:
 *    everyone pays 2B.
 *  - Riichi declaration: concealed tenpai hand, before any open meld; after
 *    declaring, the player's discards are locked to the drawn tile.
 */
export interface RiichiConfig {
  handsPerMatch: number;
  renchan: boolean;
}

const WIND_E = 27;
const DRAGON_R = 31;

const roundUp100 = (n: number) => Math.ceil(n / 100) * 100;

interface SeqDecomp {
  pair: number;
  sequences: [number, number, number][];
}

/** Decompose a complete concealed hand into 1 pair + all sequences, or null. */
function allSequencesDecomp(counts: Counts): SeqDecomp | null {
  const c = [...counts];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const seqs: [number, number, number][] = [];
    let ok = true;
    let i = 0;
    while (true) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) break;
      if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && Math.floor(i / 9) === Math.floor((i + 2) / 9)) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        seqs.push([i, i + 1, i + 2]);
      } else {
        ok = false;
        break;
      }
    }
    c[p] += 2;
    if (ok) return { pair: p, sequences: seqs };
  }
  return null;
}

function basePoints(han: number, fu: number): number {
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  const raw = fu * Math.pow(2, 2 + han);
  if (han >= 5 || raw > 2000) return 2000;
  return roundUp100(raw);
}

export function riichiRuleset(cfg: RiichiConfig = { handsPerMatch: 4, renchan: true }): Ruleset {
  return {
    id: 'riichi',
    name: 'Riichi (Japonês)',
    includeBonus: false,
    handsPerMatch: cfg.handsPerMatch,
    renchan: cfg.renchan,
    allowsRiichi: true,

    canWin(counts, meldsCount) {
      return isCompleteHand(counts, meldsCount, true);
    },

    score(ctx) {
      const items: FanItem[] = [];
      const add = (name: string, fan: number) => {
        if (fan > 0) items.push({ name, fan, qualifies: true });
      };

      const openMelds = ctx.melds.filter((m) => m.kind !== 'ankan');
      const concealed = openMelds.length === 0;

      const allFaces: number[] = [];
      for (let i = 0; i < 34; i++) for (let k = 0; k < ctx.concealedCounts[i]; k++) allFaces.push(i);
      for (const m of ctx.melds) for (const x of m.faces) if (x !== undefined) allFaces.push(x);

      const isChiitoi = ctx.melds.length === 0 && isSevenPairs(ctx.concealedCounts);
      const isKokushi = ctx.melds.length === 0 && isThirteenOrphans(ctx.concealedCounts);

      if (isKokushi) {
        add('Kokushi Musou (treze órfãos)', 13);
      } else if (isChiitoi) {
        add('Chiitoitsu (sete pares)', 2);
      }

      if (ctx.riichi) add('Riichi', 1);
      if (ctx.selfDrawn && concealed) add('Tsumo (menzen)', 1);

      const suitsUsed = new Set(allFaces.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
      const honorsUsed = allFaces.some((i) => i >= 27);
      const fullFlush = suitsUsed.size === 1 && !honorsUsed;
      const halfFlush = suitsUsed.size === 1 && honorsUsed;
      const allSimples = allFaces.every((i) => !isTerminalOrHonor(indexToFace(i)));
      if (allSimples) add('Tanyao (só simples)', 1);
      if (halfFlush) add(concealed ? 'Honitsu (fechado)' : 'Honitsu (aberto)', concealed ? 3 : 2);
      if (fullFlush) add(concealed ? 'Chinitsu (fechado)' : 'Chinitsu (aberto)', concealed ? 6 : 5);

      // pungs from melds + concealed decomposition
      const pungs: number[] = [];
      for (const m of ctx.melds) if (m.kind !== 'chi') pungs.push(m.faces[0]);
      let seqCount = 0;
      if (!isChiitoi && !isKokushi) {
        const dec = decomposeForYaku(ctx.concealedCounts);
        pungs.push(...dec.pungs);
        seqCount = dec.sequences;
      }
      for (const p of pungs) {
        if (p >= DRAGON_R) add(`Yakuhai: dragão ${['Vermelho', 'Verde', 'Branco'][p - DRAGON_R]}`, 1);
      }
      const seatFace = WIND_E + (ctx.seatWind - 1);
      const roundFace = WIND_E + (ctx.roundWind - 1);
      if (pungs.includes(seatFace)) add('Yakuhai: vento do lugar', 1);
      if (pungs.includes(roundFace)) add('Yakuhai: vento dominante', 1);
      const hasChi = ctx.melds.some((m) => m.kind === 'chi') || seqCount > 0;
      if (!isChiitoi && !isKokushi && !hasChi) add('Toi-toi (mão de trincas)', 2);

      // pinfu (simplified): concealed, all sequences, non-yakuhai pair, ryanmen wait
      if (!isChiitoi && !isKokushi && concealed && ctx.melds.length === 0) {
        const dec = allSequencesDecomp(ctx.concealedCounts);
        if (dec && dec.pair !== seatFace && dec.pair !== roundFace && dec.pair < DRAGON_R) {
          const winSeq = dec.sequences.find((s) => s.includes(ctx.winFace));
          if (winSeq) {
            const [a, , c2] = winSeq;
            const suitStart = Math.floor(ctx.winFace / 9) * 9;
            const ryanmen =
              (ctx.winFace === a && c2 + 1 <= suitStart + 8) ||
              (ctx.winFace === c2 && a - 1 >= suitStart);
            if (ryanmen) add('Pinfu', 1);
          }
        }
      }

      const han = items.reduce((s, i) => s + i.fan, 0);
      const meetsMinimum = han >= 1; // yaku requirement
      const fu = isChiitoi ? 25 : 30;
      const points = meetsMinimum ? basePoints(han, fu) : 0;

      return {
        items,
        totalFan: han,
        qualifyingFan: han,
        capped: han >= 5,
        points,
        meetsMinimum,
      };
    },

    payments(points, selfDrawn, discardSeat, winnerSeat, dealerSeat) {
      const pays = [0, 0, 0, 0];
      if (points <= 0) return pays;
      const winnerIsDealer = winnerSeat === dealerSeat;
      for (let s = 0; s < 4; s++) {
        if (s === winnerSeat) continue;
        if (selfDrawn) {
          pays[s] = winnerIsDealer ? points * 2 : s === dealerSeat ? points * 2 : points;
        } else if (s === discardSeat) {
          pays[s] = winnerIsDealer ? points * 6 : points * 4;
        }
      }
      return pays;
    },

    summary() {
      return [
        'Vitória: 4 conjuntos + par, sete pares ou treze órfãos (alternativas fechadas)',
        'Exige yaku (mínimo 1 han); bônus de flores fora desta variante',
        'Riichi: declarável com mão fechada em tenpai; descarte travado na compra',
        'Pontos: fu fixo 30 (25 chiitoi) × 2^(2+han), limites mangan→yakuman',
        'Ron: descartador paga 4B (6B se dealer); tsumo: rateio com dealer em dobro',
        `Partida: ${cfg.handsPerMatch} mãos${cfg.renchan ? ', dealer repete ao vencer' : ''}`,
      ];
    },
  };
}

interface YakuDecomp {
  pungs: number[];
  sequences: number;
  pair: number;
}

/** Decompose concealed remainder preferring pungs info for yaku detection. */
function decomposeForYaku(counts: Counts): YakuDecomp {
  const c = [...counts];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const pungs: number[] = [];
    let sequences = 0;
    if (extractAll(c, pungs, () => sequences++)) {
      c[p] += 2;
      return { pungs, sequences, pair: p };
    }
    c[p] += 2;
  }
  return { pungs: [], sequences: 0, pair: -1 };
}

function extractAll(c: Counts, pungs: number[], onSeq: () => void): boolean {
  let i = 0;
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    if (extractAll(c, pungs, onSeq)) {
      pungs.push(i);
      c[i] += 3;
      return true;
    }
    c[i] += 3;
  }
  if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && Math.floor(i / 9) === Math.floor((i + 2) / 9)) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    if (extractAll(c, pungs, onSeq)) {
      onSeq();
      c[i]++; c[i + 1]++; c[i + 2]++;
      return true;
    }
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  return false;
}

export type { MeldLike };
