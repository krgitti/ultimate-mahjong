import type { Counts } from '../traditional/hand';
import { isCompleteHand } from '../traditional/hand';
import type { MeldLike, ScoringResult } from '../scoring/hongkong-scoring';
import { computeScoring, computePayments } from '../scoring/hongkong-scoring';
import type { HKRules } from './hongkong';
import { HK_DEFAULTS, rulesSummary } from './hongkong';

/**
 * Pluggable rule-set interface for the traditional engine.
 *
 * A ruleset owns: the accepted winning forms, the scoring of a completed
 * hand, the payment split and the match parameters. The engine never looks
 * inside a concrete variant — Hong Kong and Riichi are two implementations
 * of this interface (MCR is a planned third module).
 */
export interface WinContext {
  /** concealed part INCLUDING the winning tile (face indices, length 34) */
  concealedCounts: Counts;
  melds: MeldLike[];
  winFace: number;
  selfDrawn: boolean;
  seatWind: number; // 1=E 2=S 3=W 4=N
  roundWind: number;
  flowers: number;
  seasons: number;
  winOnKong: boolean;
  robbedKong: boolean;
  lastTile: boolean;
  /** riichi declaration by the winner (riichi ruleset) */
  riichi: boolean;
  /** riichi: win within one turn cycle, no calls in between */
  ippatsu: boolean;
  /** riichi: dora indicator face indices */
  doraIndicators: number[];
  /** riichi: ura indicators (only populated for riichi winners) */
  uraIndicators: number[];
  /** MCR: copies of the winning tile already visible before the win (Last Tile fan) */
  winTileVisible?: number;
  /** MCR: ranks (1-4) of the winner's flower/season bonus tiles */
  flowerRanks?: number[];
  seasonRanks?: number[];
}

export interface Ruleset {
  id: 'hk' | 'riichi' | string;
  name: string;
  /** whether flower/season tiles are part of the wall */
  includeBonus: boolean;
  handsPerMatch: number;
  renchan: boolean;
  /** riichi declaration available? */
  allowsRiichi: boolean;
  /** does the concealed remainder (with the winning tile) complete a hand? */
  canWin(concealedCounts: Counts, meldsCount: number): boolean;
  score(ctx: WinContext): ScoringResult;
  /** amount each seat pays to the winner (index = seat) */
  payments(
    points: number,
    selfDrawn: boolean,
    discardSeat: number | null,
    winnerSeat: number,
    dealerSeat: number
  ): number[];
  summary(): string[];
}

export function isRuleset(x: unknown): x is Ruleset {
  return !!x && typeof x === 'object' && typeof (x as Ruleset).canWin === 'function';
}

/** Adapter: existing Hong Kong config as a Ruleset. */
export function hkRuleset(rules: HKRules = HK_DEFAULTS): Ruleset {
  return {
    id: 'hk',
    name: 'Hong Kong',
    includeBonus: true,
    handsPerMatch: rules.handsPerMatch,
    renchan: rules.renchan,
    allowsRiichi: false,
    canWin: (counts, melds) => isCompleteHand(counts, melds, false),
    score: (ctx) =>
      computeScoring({
        concealedCounts: ctx.concealedCounts,
        melds: ctx.melds,
        winFace: ctx.winFace,
        selfDrawn: ctx.selfDrawn,
        seatWind: ctx.seatWind,
        roundWind: ctx.roundWind,
        flowers: ctx.flowers,
        seasons: ctx.seasons,
        winOnKong: ctx.winOnKong,
        robbedKong: ctx.robbedKong,
        lastTile: ctx.lastTile,
        rules,
      }),
    payments: (points, selfDrawn, discardSeat, winnerSeat, _dealer) =>
      computePayments(rules, points, selfDrawn, discardSeat, winnerSeat),
    summary: () => rulesSummary(rules),
  };
}
