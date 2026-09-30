import type { TileFace } from '../tiles/tiles';
import { faceIndex, isTerminalOrHonor } from '../tiles/tiles';
import { countsFromFaces, normalShanten, acceptanceCount, type Counts } from '../traditional/hand';
import type { MeldKind } from '../traditional/engine';
import type { Rng } from '../tiles/rng';
import { totalRisk, threatLevel, type OppInfo } from './defense';

/**
 * Bots for the traditional mode.
 *
 * HARD CONSTRAINT: a bot only ever receives a `BotView` — its own hand plus
 * PUBLIC information (discards, exposed melds, bonus counts, wall count).
 * Opponent hands are not part of the type and never passed in.
 *
 * Difficulty levels (documented):
 *  - easy  : discards mostly at random with a mild preference for isolated
 *            honors/terminals; always claims a winning tile; claims
 *            pon/kan ~50% and chi ~25% of the time regardless of value.
 *            Limitation: frequently breaks useful shapes, no defence.
 *  - medium: keeps the hand shape optimal — discards the tile that
 *            minimises shanten (ties broken by acceptance count); claims
 *            only calls that lower shanten or complete the hand.
 *            Limitation: no defensive play, ignores scoring potential.
 *  - hard  : medium's offence plus REAL defence and value awareness —
 *            per-opponent wait counting (genbutsu/suji/kabe, see ai/defense.ts):
 *            when an opponent is threatening (riichi / 2+ melds) the discard
 *            pool widens to best-shanten+1 and the safest tile wins; avoids
 *            chi unless it clearly advances the hand; keeps concealed hands
 *            for the +1 fan when close to ready; declares riichi when the
 *            ruleset allows it and the hand is concealed & tenpai.
 *            Limitation: no full betaori fold-or-push EV modelling, no
 *            nakasuji pruning, no opponent-wait enumeration beyond suji/kabe.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotView {
  seat: number;
  seatWind: number; // 1..4
  roundWind: number;
  hand: TileFace[]; // own hand only
  melds: { kind: MeldKind; faces: TileFace[] }[]; // own melds
  bonusFaces: TileFace[]; // own bonus
  visibleDiscards: TileFace[]; // every seat's discard pond
  otherMeldFaces: TileFace[]; // every seat's exposed melds
  wallCount: number;
  turnNumber: number;
  /** per-opponent public info for defence (optional; hard difficulty uses it) */
  opponents?: OppInfo[];
}

export interface BotCallOptions {
  canRon: boolean;
  canPon: boolean;
  canKan: boolean;
  chiOptions: [TileFace, TileFace][] | null;
  discardFace: TileFace;
}

export type BotCall = 'ron' | 'pon' | 'kan' | 'chi' | 'pass';

function usedCounts(view: BotView, excludeHandIdx = -1): Counts {
  const c = countsFromFaces([
    ...view.visibleDiscards,
    ...view.otherMeldFaces,
    ...view.bonusFaces,
    ...view.melds.flatMap((m) => m.faces),
  ]);
  view.hand.forEach((f, i) => {
    if (i !== excludeHandIdx) {
      const idx = faceIndex(f);
      if (idx >= 0) c[idx]++;
    }
  });
  return c;
}

function handCounts(view: BotView): Counts {
  return countsFromFaces(view.hand);
}

/** shanten if we discard hand index i */
function shantenAfterDiscard(view: BotView, i: number): number {
  const remaining = view.hand.filter((_, k) => k !== i);
  return normalShanten(countsFromFaces(remaining), view.melds.length);
}

export function chooseDiscard(view: BotView, difficulty: Difficulty, rng: Rng): number {
  const n = view.hand.length;
  if (n === 0) return -1;

  if (difficulty === 'easy') {
    // 60% random, 40% "not obviously useful"
    if (rng.next() < 0.6) return rng.nextInt(n);
    const isolated = view.hand
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => isTerminalOrHonor(f))
      .map(({ i }) => i);
    if (isolated.length > 0) return isolated[rng.nextInt(isolated.length)];
    return rng.nextInt(n);
  }

  // medium & hard: minimise shanten; hard adds real per-opponent defence
  const base = normalShanten(handCounts(view), view.melds.length);
  const maxThreat = view.opponents && view.opponents.length > 0
    ? Math.max(...view.opponents.map(threatLevel))
    : 0;
  const defensive = difficulty === 'hard' && maxThreat >= 2;

  let best = Infinity;
  const bySh: { sh: number; idx: number }[] = [];
  for (let i = 0; i < n; i++) {
    const sh = shantenAfterDiscard(view, i);
    bySh.push({ sh, idx: i });
    if (sh < best) best = sh;
  }
  // defensive mode may sacrifice at most 1 shanten to fold toward safety
  const pool = bySh.filter((e) => e.sh <= best + (defensive ? 1 : 0));

  const used = usedCounts(view);
  const scored = pool.map(({ idx }) => {
    const fi = faceIndex(view.hand[idx]);
    const remaining = view.hand.filter((_, k) => k !== idx);
    const acc = acceptanceCount(countsFromFaces(remaining), view.melds.length, used);
    const sh = bySh[idx].sh;
    let score = acc - sh * 50; // offence first
    if (difficulty === 'hard') {
      const visible = used[fi];
      score += visible * 3; // tiles already out are safer to discard
      const late = view.wallCount < 40;
      if (late && isTerminalOrHonor(view.hand[idx]) && visible === 0) score -= 6;
      if (view.hand[idx].suit === 'dragon') score -= 3;
      if (view.opponents) {
        const risk = totalRisk(fi, view.opponents, used);
        score -= risk * (defensive ? 40 : 4); // defence: real wait counting
      }
    }
    return { idx, score };
  });
  scored.sort((a, b) => b.score - a.score);
  void base;
  return scored[0].idx;
}

export function chooseCall(
  view: BotView,
  opts: BotCallOptions,
  difficulty: Difficulty,
  rng: Rng
): { call: BotCall; chiChoice?: number } {
  if (opts.canRon) return { call: 'ron' };

  const curShanten = normalShanten(handCounts(view), view.melds.length);

  const shantenAfterPon = (): number => {
    // remove two copies of the discard face from hand
    const fIdx = faceIndex(opts.discardFace);
    const remaining = [...view.hand];
    let removed = 0;
    for (let i = remaining.length - 1; i >= 0 && removed < 2; i--) {
      if (faceIndex(remaining[i]) === fIdx) { remaining.splice(i, 1); removed++; }
    }
    return normalShanten(countsFromFaces(remaining), view.melds.length + 1);
  };

  if (difficulty === 'easy') {
    if (opts.canKan && rng.next() < 0.5) return { call: 'kan' };
    if (opts.canPon && rng.next() < 0.5) return { call: 'pon' };
    if (opts.chiOptions && rng.next() < 0.25) return { call: 'chi', chiChoice: 0 };
    return { call: 'pass' };
  }

  // medium & hard
  const ponGain = curShanten - shantenAfterPon();
  if (opts.canKan) {
    const kanShanten = shantenAfterPon(); // kan keeps 4th aside similarly for shape
    const gain = curShanten - kanShanten;
    if (gain >= 1 || difficulty === 'medium') return { call: 'kan' };
    if (gain === 0 && view.wallCount > 30) return { call: 'kan' }; // kong fan chance
  }
  if (opts.canPon) {
    if (ponGain >= 1) return { call: 'pon' };
    if (difficulty === 'hard') {
      // value-aware: pon to keep concealed-hand fan only when it wins soon otherwise
      if (ponGain === 0 && curShanten <= 1 && rng.next() < 0.35) return { call: 'pon' };
      return { call: 'pass' };
    }
    if (ponGain === 0 && curShanten <= 1 && rng.next() < 0.5) return { call: 'pon' };
    return { call: 'pass' };
  }
  if (opts.chiOptions) {
    if (difficulty === 'hard') {
      // only chi when it clearly advances the hand
      const fIdx = faceIndex(opts.discardFace);
      for (let ci = 0; ci < opts.chiOptions.length; ci++) {
        const used = new Set<number>();
        const remaining: TileFace[] = [];
        for (const f of view.hand) {
          const need = opts.chiOptions[ci];
          const matchIdx = need.findIndex((nf, k) => !used.has(k) && faceIndex(nf) === faceIndex(f));
          if (matchIdx !== -1) { used.add(matchIdx); continue; }
          remaining.push(f);
        }
        void fIdx;
        if (used.size === 2) {
          const sh = normalShanten(countsFromFaces(remaining), view.melds.length + 1);
          if (curShanten - sh >= 1) return { call: 'chi', chiChoice: ci };
        }
      }
      return { call: 'pass' };
    }
    // medium: chi if it lowers shanten
    const remaining = view.hand.filter((f) => {
      const fIdx = faceIndex(f);
      return !opts.chiOptions![0].some((nf) => faceIndex(nf) === fIdx) || false;
    });
    // simplistic: try first option
    const fIdxs = opts.chiOptions[0].map((f) => faceIndex(f));
    const rem: TileFace[] = [];
    const need = [...fIdxs];
    for (const f of view.hand) {
      const k = need.indexOf(faceIndex(f));
      if (k !== -1) need.splice(k, 1);
      else rem.push(f);
    }
    if (need.length === 0) {
      const sh = normalShanten(countsFromFaces(rem), view.melds.length + 1);
      if (curShanten - sh >= 1) return { call: 'chi', chiChoice: 0 };
    }
    void remaining;
  }
  return { call: 'pass' };
}
