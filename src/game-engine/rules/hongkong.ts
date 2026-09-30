/**
 * HONG KONG MAHJONG — rule set implemented by the traditional engine.
 *
 * DOCUMENTED CHOICES (v1):
 *  - Winning form: 4 melds (chi/pon/kan) + 1 pair ONLY.
 *    Seven pairs / thirteen orphans / flower hand are NOT included
 *    (house rules elsewhere; can be added as alternative rule modules).
 *  - Flowers & seasons: in play. Bonus tiles are exposed immediately when
 *    drawn/dealt and replaced from the dead wall. Each bonus tile is worth
 *    +1 fan; a complete flower set (梅蘭菊竹) or season set (春夏秋冬)
 *    grants +2 extra fan. Bonus fan does NOT count toward the minimum.
 *  - Minimum fan: 3 by default (classic HK). Bonus fan excluded from the
 *    minimum. `allowChickenHand: true` lowers the minimum to 1 fan.
 *  - Cap: 13 fan (limit hand).
 *  - Payment: doubling — points = basePoint * 2^min(fan, cap).
 *    Self-draw: every player pays. Discard: discarder pays double
 *    (configurable via doubleDiscard), others pay single.
 *  - Chi: only from the player to the left (previous seat).
 *  - Robbing a kong: allowed for ADDED kongs only (classic restriction).
 *  - Kan replacement tiles come from the dead wall (14 tiles reserved).
 *  - Exhaustive draw when the live wall runs out -> draw hand, no payment.
 *  - Dealer (East) retains dealership after winning (renchan); otherwise
 *    the deal passes to the next seat. Round wind advances every 4 hands
 *    (East -> South -> West -> North), capped at North.
 *  - Match length: configurable number of hands (4 = one East round,
 *    8 = East+South, 16 = full game).
 */
export interface HKRules {
  minFan: number; // 3 classic; 1 with chicken hands
  allowChickenHand: boolean;
  cap: number; // 13
  basePoint: number;
  doubleDiscard: boolean; // discarder pays double
  handsPerMatch: number; // 4 | 8 | 16
  renchan: boolean; // dealer keeps deal on win
  // fan values
  fan: {
    selfDraw: number;
    concealed: number;
    allSimples: number;
    dragonPung: number;
    seatWind: number;
    roundWind: number;
    allPungs: number;
    halfFlush: number;
    fullFlush: number;
    allHonors: number;
    winOnKong: number;
    robTheKong: number;
    lastTile: number;
    bonusTile: number;
    flowerSet: number;
    seasonSet: number;
  };
}

export const HK_DEFAULTS: HKRules = {
  minFan: 3,
  allowChickenHand: false,
  cap: 13,
  basePoint: 1,
  doubleDiscard: true,
  handsPerMatch: 4,
  renchan: true,
  fan: {
    selfDraw: 1,
    concealed: 1,
    allSimples: 1,
    dragonPung: 1,
    seatWind: 1,
    roundWind: 1,
    allPungs: 3,
    halfFlush: 3,
    fullFlush: 6,
    allHonors: 8,
    winOnKong: 1,
    robTheKong: 1,
    lastTile: 1,
    bonusTile: 1,
    flowerSet: 2,
    seasonSet: 2,
  },
};

export const HK_CHICKEN: HKRules = {
  ...HK_DEFAULTS,
  minFan: 1,
  allowChickenHand: true,
};

export function effectiveMinFan(r: HKRules): number {
  return r.allowChickenHand ? Math.min(r.minFan, 1) : r.minFan;
}

export function rulesSummary(r: HKRules): string[] {
  return [
    `Vitória: 4 conjuntos + 1 par (sem pares especiais)`,
    `Fan mínimo: ${effectiveMinFan(r)} (bônus não conta para o mínimo)`,
    `Limite: ${r.cap} fan — pagamento dobra por fan (base ${r.basePoint})`,
    r.doubleDiscard ? 'Descartador paga em dobro no ron' : 'Pagamento igual no ron',
    `Flores/estações em jogo: +${r.fan.bonusTile} fan cada, conjuntos completos +${r.fan.flowerSet}`,
    `Partida: ${r.handsPerMatch} mãos${r.renchan ? ', dealer repete ao vencer' : ''}`,
  ];
}
