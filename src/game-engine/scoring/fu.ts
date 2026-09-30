import type { Counts } from '../traditional/hand';

/**
 * Full fu (符) counting for the Riichi ruleset.
 *
 *   base 20
 *   + concealed hand & ron ........ +10
 *   + tsumo (except pinfu) ........ +2
 *   + pair: dragon +2; seat wind +2; round wind +2 (stacks)
 *   + pungs: 2 open / 4 concealed; terminals & honors ×2; kans ×4 (8/16)
 *   + wait: kanchan / penchan / tanki +2
 *   Pinfu overrides: tsumo = 20 fu, concealed ron = 30 fu.
 *   Chiitoitsu fixed 25; kokushi fixed 30 (documented v1 choice).
 *   Final value rounded UP to the next 10.
 *
 * The pung completed by the ron tile counts as OPEN for fu (standard).
 */

export interface FuMeld {
  kind: 'chi' | 'pon' | 'kan' | 'ankan';
  face: number; // face index of the pung/kan
}

export interface FuInput {
  concealedCounts: Counts; // includes the winning tile
  /** hand BEFORE the win (13 tiles) — used to classify the wait (v1 documented) */
  preWin?: Counts;
  melds: FuMeld[];
  winFace: number;
  selfDrawn: boolean;
  seatWind: number; // 1..4
  roundWind: number;
  isChiitoi: boolean;
  isKokushi: boolean;
  pinfu: boolean;
}

const isTermOrHonor = (f: number) => f >= 27 || f % 9 === 0 || f % 9 === 8;

interface Decomp {
  pair: number;
  pungs: number[];
  sequences: [number, number, number][];
}

function decompose(counts: Counts): Decomp | null {
  for (let p = 0; p < 34; p++) {
    if (counts[p] < 2) continue;
    const c = [...counts]; // fresh copy per attempt — failed attempts must not leak mutations
    c[p] -= 2;
    const pungs: number[] = [];
    const sequences: [number, number, number][] = [];
    let ok = true;
    let i = 0;
    while (true) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) break;
      if (c[i] >= 3) {
        c[i] -= 3;
        pungs.push(i);
      } else if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && Math.floor(i / 9) === Math.floor((i + 2) / 9)) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        sequences.push([i, i + 1, i + 2]);
      } else {
        ok = false;
        break;
      }
    }
    if (ok) return { pair: p, pungs, sequences };
  }
  return null;
}

export function computeFu(input: FuInput): number {
  if (input.isChiitoi) return 25;
  if (input.isKokushi) return 30;
  if (input.pinfu) return input.selfDrawn ? 20 : 30;

  const openMelds = input.melds.filter((m) => m.kind === 'pon' || m.kind === 'kan');
  const menzen = openMelds.length === 0;
  const dec = decompose(input.concealedCounts);

  let fu = 20;
  if (menzen && !input.selfDrawn) fu += 10;
  if (input.selfDrawn) fu += 2;

  if (!dec) return Math.ceil(fu / 10) * 10;

  // pair value
  const pair = dec.pair;
  if (pair >= 31) fu += 2; // dragons
  if (pair === 27 + (input.seatWind - 1)) fu += 2;
  if (pair === 27 + (input.roundWind - 1)) fu += 2;

  // pungs from melds; a concealed pung whose 3rd tile is the ron tile counts open
  const concealedPungs = [...dec.pungs];
  const ronCompletedPung = !input.selfDrawn
    ? concealedPungs.find((f) => f === input.winFace && (input.concealedCounts[f] ?? 0) === 3)
    : undefined;

  const pungFu = (face: number, concealed: boolean) => {
    let v = concealed ? 4 : 2;
    if (isTermOrHonor(face)) v *= 2;
    return v;
  };

  for (const m of input.melds) {
    if (m.kind === 'chi') continue;
    if (m.kind === 'kan') fu += isTermOrHonor(m.face) ? 16 : 8;
    else if (m.kind === 'ankan') fu += isTermOrHonor(m.face) ? 32 : 16;
    else fu += pungFu(m.face, false); // open pon
  }
  for (const f of concealedPungs) {
    const concealed = f !== ronCompletedPung;
    fu += pungFu(f, concealed);
  }

  // wait kind — classified from the pre-win hand when available (the true wait),
  // otherwise from the decomposition (fallback).
  const w = input.winFace;
  const pre = input.preWin;
  if (pre) {
    const num = w < 27;
    const r = w % 9;
    const inSuit = (o: number) => num && w + o >= 0 && w + o < 34 && Math.floor((w + o) / 9) === Math.floor(w / 9);
    const kanchan = num && inSuit(-1) && inSuit(1) && pre[w - 1] > 0 && pre[w + 1] > 0;
    const penchan =
      num &&
      ((r === 2 && pre[w - 2] > 0 && pre[w - 1] > 0) || // 1-2 waiting 3
        (r === 6 && pre[w + 1] > 0 && pre[w + 2] > 0)); // 8-9 waiting 7
    const ryanmen =
      num &&
      ((inSuit(1) && inSuit(2) && pre[w + 1] > 0 && pre[w + 2] > 0) ||
        (inSuit(-1) && inSuit(-2) && pre[w - 1] > 0 && pre[w - 2] > 0));
    const tankiOrShanpon = pre[w] === 1;
    // v1 documented: when counts allow both readings, the closed-wait
    // interpretation (higher fu) wins over ryanmen.
    if (kanchan || penchan || (tankiOrShanpon && !ryanmen)) fu += 2;
  } else {
    const winSeq = dec.sequences.find((sq) => sq.includes(w));
    if (!winSeq) {
      if (dec.pair === w) fu += 2; // tanki
    } else if (w === winSeq[1]) fu += 2; // kanchan
    else {
      const [a, b, c] = winSeq;
      const penchan =
        (w === c && a % 9 === 0 && b % 9 === 1) ||
        (w === a && b % 9 === 7 && c % 9 === 8);
      if (penchan) fu += 2;
    }
  }

  return Math.ceil(fu / 10) * 10;
}
