import type { Counts } from '../traditional/hand';

/**
 * Real (public-info) defence: per-opponent wait counting.
 *
 * For a candidate discard tile we count how many of the opponent's possible
 * waits it would feed, pruning with classic visibility techniques:
 *  - GENBUTSU: the opponent already discarded the tile -> cannot feed a ron (0).
 *  - KABE    : 4 copies visible -> nobody can hold it, no wait at all (0);
 *              3 visible -> only a single-tile (tanki) wait remains.
 *  - SUJI    : if the opponent discarded the "other end" of a two-sided wait,
 *              that two-sided proto-sequence is pruned (they would be furiten on it).
 * The result is a small integer: 0 = safe, higher = more possible waits fed.
 *
 * This module powers the hard bot's pressure model (see ai/bot.ts): the
 * per-tile risk feeds a three-mode decision — betaori (full fold vs riichi
 * when far from tenpai), pressur (push when tenpai/close with no riichi) and
 * a balanced mode in between.
 *
 * Limitations (documented): no kanchan-suji (nakasuji) pruning, no turn-order
 * weighting beyond the threat multiplier, no deal-in probability estimates.
 */

export interface OppInfo {
  seat: number;
  /** face indices, discard order */
  discards: number[];
  meldCount: number;
  riichi: boolean;
}

const suitOf = (t: number) => Math.floor(t / 9);
const rankOf = (t: number) => t % 9;
const sameSuit = (a: number, b: number) => a < 27 && b < 27 && suitOf(a) === suitOf(b);

/** consistency of one proto-sequence that waits on `tile` */
function protoDanger(
  proto: [number, number],
  otherWait: number | null,
  opp: OppInfo,
  visible: Counts
): number {
  const [a, b] = proto;
  if (a < 0 || b > 33 || a >= 27 || !sameSuit(a, b)) return 0;
  // opponent must be able to hold both proto tiles
  if (visible[a] >= 4 || visible[b] >= 4) return 0;
  // suji prune: the other two-sided end already in their pond -> furiten-ish prune
  if (otherWait !== null && otherWait >= 0 && otherWait < 34 && opp.discards.includes(otherWait)) return 0;
  // penchan detection: proto at the wall edge has only one wait (= tile itself);
  // in that case genbutssu/suji of the other end does not apply, but kabe does.
  return 1;
}

/** How many of this opponent's plausible waits does `tile` feed? 0 = safe. */
export function dangerScore(tile: number, opp: OppInfo, visible: Counts): number {
  if (tile < 0 || tile >= 34) return 0;
  if (opp.discards.includes(tile)) return 0; // genbutsu
  const vis = visible[tile];
  if (vis >= 4) return 0; // kabe: nobody holds it

  let d = 0;
  if (tile < 27) {
    const r = rankOf(tile);
    // two-sided / penchan protos that wait on `tile`:
    //  proto (t-2,t-1) waits t & t-3 ; proto (t+1,t+2) waits t & t+3
    if (r >= 2) d += protoDanger([tile - 2, tile - 1], tile - 3, opp, visible);
    if (r <= 5) d += protoDanger([tile + 1, tile + 2], tile + 3, opp, visible);
    // kanchan proto (t-1,t+1) waits t
    if (r >= 1 && r <= 7) {
      if (visible[tile - 1] < 4 && visible[tile + 1] < 4) d += 1;
    }
    // penchan protos: (t-2,t-1) with t = rank2 edge already counted above when r==2?
    // explicit penchan: proto (1,2) waits 3 ; proto (7,8) waits 7-in-suit
    if (r === 2 && visible[tile - 2] < 4 && visible[tile - 1] < 4) d += 0; // covered by two-sided branch
  } else {
    // honors: only shanpon/tanki possible
    d += 1;
  }
  // shanpon (pair in their hand) / tanki
  if (vis <= 2) d += 1; // they may hold a pair
  else if (vis === 3) d += 0; // only tanki of a single leftover — negligible but count 0 (v1)
  return d;
}

/** How threatening is this opponent right now (multiplier for danger). */
export function threatLevel(opp: OppInfo): number {
  if (opp.riichi) return 3;
  if (opp.meldCount >= 2) return 2;
  if (opp.meldCount === 1) return 1.5;
  if (opp.discards.length >= 13) return 1;
  return 0.5;
}

/** Σ danger × threat over all opponents. 0 = completely safe discard. */
export function totalRisk(tile: number, opponents: OppInfo[], visible: Counts): number {
  let total = 0;
  for (const opp of opponents) total += dangerScore(tile, opp, visible) * threatLevel(opp);
  return total;
}
