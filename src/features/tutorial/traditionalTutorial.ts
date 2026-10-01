import { newMatch, type TradState } from '../../game-engine/traditional/engine';
import { HK_CHICKEN } from '../../game-engine/rules/hongkong';
import type { TileFace } from '../../game-engine/tiles/tiles';
import { faceName } from '../../game-engine/tiles/tiles';
import { createRng } from '../../game-engine/tiles/rng';
import { shuffle } from '../../game-engine/tiles/rng';

const f = (suit: TileFace['suit'], rank: number): TileFace => ({ suit, rank });

/**
 * Fully scripted table for the traditional tutorial:
 *  - human (seat 0) is dealer with: 234m 678m 234p 78p 55s + drawn 1-man
 *  - bots hold 13 distinct terminals/honors (can never call)
 *  - wall order: [6-pin (bot1 discard -> CHOW), North, White, Green (safe passes), 5-sou (human TSUMO)]
 */
export function createTutorialMatch(): TradState {
  const s = newMatch(HK_CHICKEN, 777, ['Você', 'Bot Sul', 'Bot Oeste', 'Bot Norte']);

  // collect every tile back into a pool
  const pool: number[] = [];
  for (const p of s.players) {
    pool.push(...p.hand, ...p.bonus, ...p.discards);
    for (const m of p.melds) pool.push(...m.tiles);
    p.hand = [];
    p.bonus = [];
    p.discards = [];
    p.melds = [];
  }
  pool.push(...s.wall, ...s.deadWall);

  const take = (face: TileFace): number => {
    const i = pool.findIndex((id) => {
      const tf = s.tiles[id].face;
      return tf.suit === face.suit && tf.rank === face.rank;
    });
    if (i === -1) throw new Error(`tutorial setup: no tile ${face.suit}${face.rank}`);
    return pool.splice(i, 1)[0];
  };

  // human hand (14, dealer)
  const humanFaces = [
    f('man', 2), f('man', 3), f('man', 4),
    f('man', 6), f('man', 7), f('man', 8),
    f('pin', 2), f('pin', 3), f('pin', 4),
    f('pin', 7), f('pin', 8),
    f('sou', 5), f('sou', 5),
    f('man', 1),
  ];
  s.players[0].hand = humanFaces.map(take).sort((a, b) => a - b);
  s.drawnTile = s.players[0].hand.find((id) => {
    const tf = s.tiles[id].face;
    return tf.suit === 'man' && tf.rank === 1;
  })!;

  // bot hands: 13 distinct terminals/honors each (no pairs, no shapes -> never call)
  const botFaces = [
    f('wind', 1), f('wind', 2), f('wind', 3), f('wind', 4),
    f('dragon', 1), f('dragon', 2), f('dragon', 3),
    f('man', 1), f('man', 9), f('pin', 1), f('pin', 9), f('sou', 1), f('sou', 9),
  ];
  for (let seat = 1; seat <= 3; seat++) {
    s.players[seat].hand = botFaces.map(take).sort((a, b) => a - b);
  }

  // scripted wall. Turn order after the human (seat 0) discards: bot1, bot2, bot3 — and a
  // CHOW may only be claimed from the player who plays RIGHT BEFORE you (bot3 = Bot Norte).
  // Order: bot1 junk, bot2 junk, 6-pin (Bot Norte -> CHOW window), then safe passes, then 5-sou (TSUMO).
  const scripted = [
    f('wind', 3), // bot1 draws/discards West
    f('wind', 4), // bot2 draws/discards North
    f('pin', 6), //  bot3 (Bot Norte) draws/discards 6-pin -> human CHOW
    f('wind', 1), // bot1 East (safe)
    f('dragon', 3), // bot2 White (safe)
    f('dragon', 2), // bot3 Green (safe)
    f('sou', 5), // human draws the winning 5-sou
  ].map(take);
  const rest = shuffle(pool, createRng(4242));
  s.deadWall = rest.splice(rest.length - 14, 14);
  s.wall = [...scripted, ...rest];

  s.current = 0;
  s.phase = 'discard';
  s.lastDiscard = null;
  s.offers = [];
  s.events.length = 0;
  return s;
}

export interface TradTutContext {
  suitsClicked: Set<string>;
}

export interface TradTutStep {
  id: string;
  title: string;
  coach: string;
  done: (s: TradState, ctx: TradTutContext) => boolean;
}

const handEnded = (s: TradState) => s.phase === 'hand-over' || s.phase === 'match-over';
const humanDiscarded = (s: TradState, face: TileFace) =>
  s.players[0].discards.some((id) => {
    const tf = s.tiles[id].face;
    return tf.suit === face.suit && tf.rank === face.rank;
  });

export const TRAD_STEPS: TradTutStep[] = [
  {
    id: 'suits',
    title: 'tut.trad.suits.t',
    coach: 'tut.trad.suits.c',
    done: (_s, ctx) => ctx.suitsClicked.size >= 3,
  },
  {
    id: 'discard',
    title: 'tut.trad.discard.t',
    coach: 'tut.trad.discard.c',
    done: (s) => humanDiscarded(s, f('man', 1)),
  },
  {
    id: 'call',
    title: 'tut.trad.call.t',
    coach: 'tut.trad.call.c',
    done: (s) => handEnded(s) || s.players[0].melds.some((m) => m.kind === 'chi'),
  },
  {
    id: 'discard2',
    title: 'tut.trad.discard2.t',
    coach: 'tut.trad.discard2.c',
    done: (s) => handEnded(s) || humanDiscarded(s, f('sou', 5)),
  },
  {
    id: 'watch',
    title: 'tut.trad.watch.t',
    coach: 'tut.trad.watch.c',
    done: (s) => handEnded(s) || (s.current === 0 && (s.phase === 'draw' || s.phase === 'discard')),
  },
  {
    id: 'tsumo',
    title: 'tut.trad.tsumo.t',
    coach: 'tut.trad.tsumo.c',
    done: (s) => handEnded(s),
  },
  {
    id: 'score',
    title: 'tut.trad.score.t',
    coach: 'tut.trad.score.c',
    done: () => false, // final step, closed by the runner
  },
];

export function tradStepIndex(s: TradState, ctx: TradTutContext): number {
  for (let i = 0; i < TRAD_STEPS.length; i++) {
    if (!TRAD_STEPS[i].done(s, ctx)) return i;
  }
  return TRAD_STEPS.length - 1;
}

export function faceLabel(id: number, s: TradState): string {
  return faceName(s.tiles[id].face);
}
