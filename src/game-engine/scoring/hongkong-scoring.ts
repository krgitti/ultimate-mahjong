import type { HKRules } from '../rules/hongkong';
import { effectiveMinFan } from '../rules/hongkong';
import type { Counts } from '../traditional/hand';
import { isTerminalOrHonor, indexToFace } from '../tiles/tiles';

/**
 * Hong Kong fan (番) computation for a completed hand.
 */

export interface MeldLike {
  kind: 'chi' | 'pon' | 'kan' | 'ankan';
  faces: [number, number, number, number?]; // face indices (kan: 4 equal)
}

export interface ScoringInput {
  /** concealed part of the hand INCLUDING the winning tile (face indices) */
  concealedCounts: Counts;
  melds: MeldLike[];
  winFace: number; // face index of the winning tile
  selfDrawn: boolean;
  seatWind: number; // 1=E 2=S 3=W 4=N
  roundWind: number;
  /** bonus tiles exposed by the winner (face indices 34.. not needed; we pass suits) */
  flowers: number; // count of flower tiles
  seasons: number; // count of season tiles
  winOnKong: boolean;
  robbedKong: boolean;
  lastTile: boolean;
  rules: HKRules;
}

export interface FanItem {
  name: string;
  fan: number;
  /** counts toward the minimum-fan qualification? */
  qualifies: boolean;
}

export interface ScoringResult {
  items: FanItem[];
  totalFan: number;
  qualifyingFan: number;
  capped: boolean;
  points: number;
  meetsMinimum: boolean;
}

const WIND_E = 27;
const DRAGON_R = 31;

export function computeScoring(input: ScoringInput): ScoringResult {
  const r = input.rules;
  const f = r.fan;
  const items: FanItem[] = [];
  const add = (name: string, fan: number, qualifies = true) => {
    if (fan > 0) items.push({ name, fan, qualifies });
  };

  const melds = input.melds;
  const openMelds = melds.filter((m) => m.kind === 'chi' || m.kind === 'pon' || m.kind === 'kan');
  const concealedOnly = openMelds.length === 0;

  // --- hand-shape analysis (melds + concealed) ---
  const allFaces: number[] = [];
  for (let i = 0; i < 34; i++)
    for (let k = 0; k < input.concealedCounts[i]; k++) allFaces.push(i);
  for (const m of melds) for (const x of m.faces) if (x !== undefined) allFaces.push(x);

  const pungs: number[] = [];
  for (const m of melds) if (m.kind !== 'chi') pungs.push(m.faces[0]);
  // concealed pungs/pair: decompose the concealed part
  const dec = decomposeConcealed(input.concealedCounts);
  for (const p of dec.pungs) pungs.push(p);

  const hasChi = melds.some((m) => m.kind === 'chi') || dec.sequences > 0;
  const allPungs = !hasChi;

  const suitsUsed = new Set(allFaces.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
  const honorsUsed = allFaces.some((i) => i >= 27);
  const fullFlush = suitsUsed.size === 1 && !honorsUsed;
  const halfFlush = suitsUsed.size === 1 && honorsUsed;
  const allHonors = suitsUsed.size === 0 && honorsUsed;
  const allSimples = allFaces.every((i) => !isTerminalOrHonor(indexToFace(i)));

  // --- fan items ---
  if (input.selfDrawn) add('Tsumo (compra vencedora)', f.selfDraw);
  if (concealedOnly) add('Mão fechada', f.concealed);
  if (allSimples) add('Simples (sem terminais/honras)', f.allSimples);
  for (const p of pungs) {
    if (p >= DRAGON_R) add(`Trinca de dragão (${['Vermelho', 'Verde', 'Branco'][p - DRAGON_R]})`, f.dragonPung);
  }
  const seatFace = WIND_E + (input.seatWind - 1);
  const roundFace = WIND_E + (input.roundWind - 1);
  if (pungs.includes(seatFace)) add('Trinca do vento do lugar', f.seatWind);
  if (pungs.includes(roundFace)) add('Trinca do vento dominante', f.roundWind);
  // note: when seat wind == round wind both fans apply (+2), as in classic HK
  if (allPungs) add('Mão de trincas (toi-toi)', f.allPungs);
  if (allHonors) add('Todas as honras', f.allHonors);
  else if (fullFlush) add('Flush completo (chinitsu)', f.fullFlush);
  else if (halfFlush) add('Meio flush (honitsu)', f.halfFlush);
  if (input.winOnKong) add('Vitória após compra de kong', f.winOnKong);
  if (input.robbedKong) add('Roubo do kong', f.robTheKong);
  if (input.lastTile) add('Última peça', f.lastTile);
  // bonus tiles (non-qualifying)
  add(`Flores/estações (${input.flowers + input.seasons})`, (input.flowers + input.seasons) * f.bonusTile, false);
  if (input.flowers === 4) add('Conjunto completo de flores', f.flowerSet, false);
  if (input.seasons === 4) add('Conjunto completo de estações', f.seasonSet, false);

  const totalFan = items.reduce((s, i) => s + i.fan, 0);
  const qualifyingFan = items.filter((i) => i.qualifies).reduce((s, i) => s + i.fan, 0);
  const min = effectiveMinFan(r);
  const meetsMinimum = qualifyingFan >= min;
  const capped = totalFan > r.cap;
  const points = meetsMinimum ? r.basePoint * Math.pow(2, Math.min(totalFan, r.cap)) : 0;

  return { items, totalFan, qualifyingFan, capped, points, meetsMinimum };
}

interface Decomposition {
  pungs: number[];
  sequences: number;
  pair: number | null;
}

/** Decompose a COMPLETE concealed remainder (3n+2 tiles) into pungs/sequences/pair. */
function decomposeConcealed(counts: Counts): Decomposition {
  const c = [...counts];
  // try each possible pair
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const pungs: number[] = [];
    let sequences = 0;
    if (extract(c, pungs, () => sequences++, true)) {
      c[p] += 2;
      return { pungs, sequences, pair: p };
    }
    c[p] += 2;
  }
  return { pungs: [], sequences: 0, pair: null };
}

function extract(c: Counts, pungs: number[], onSeq: () => void, inc: boolean): boolean {
  let i = 0;
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    if (extract(c, pungs, onSeq, inc)) { if (inc) pungs.push(i); return true; }
    c[i] += 3;
  }
  if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && Math.floor(i / 9) === Math.floor((i + 2) / 9)) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    if (extract(c, pungs, onSeq, inc)) { onSeq(); return true; }
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  return false;
}

/** Payment split. Returns amount each seat pays to the winner (index = seat). */
export function computePayments(
  rules: HKRules,
  points: number,
  selfDrawn: boolean,
  discardSeat: number | null,
  winnerSeat: number
): number[] {
  const pays = [0, 0, 0, 0];
  if (points <= 0) return pays;
  for (let s = 0; s < 4; s++) {
    if (s === winnerSeat) continue;
    if (selfDrawn) pays[s] = points;
    else if (s === discardSeat) pays[s] = rules.doubleDiscard ? points * 2 : points;
    else pays[s] = points;
  }
  return pays;
}
