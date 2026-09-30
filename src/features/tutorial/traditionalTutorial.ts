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
    title: 'Os naipes',
    coach:
      'Sua mão tem 3 naipes numerados — Caracteres (萬), Círculos (筒) e Bambus (索) — além de ventos e dragões. ' +
      'Clique em uma peça de cada naipe numerado para conhecê-los (3 cliques).',
    done: (_s, ctx) => ctx.suitsClicked.size >= 3,
  },
  {
    id: 'discard',
    title: 'Compra e descarte',
    coach:
      'Você é o dealer: começou com 14 peças (a peça com borda tracejada é a sua compra). ' +
      'Sempre termine o turno descartando UMA peça. O 1 de Caracteres não ajuda em nada — descarte-o (clique duas vezes ou use o botão).',
    done: (s) => humanDiscarded(s, f('man', 1)),
  },
  {
    id: 'call',
    title: 'Chamadas: Chow (e Ron!)',
    coach:
      'O Bot Norte descartou 6 de Círculos — e ele é o jogador imediatamente antes de você. Você tem 7-8 de Círculos: ' +
      'pode chamar CHOW (sequência), permitido apenas do jogador que joga logo antes do seu turno. ' +
      'Repare: essa peça também completa sua mão — você poderia declarar RON (vitória) agora! Escolha: CHOW para continuar a lição, ou RON para vencer já.',
    done: (s) => handEnded(s) || s.players[0].melds.some((m) => m.kind === 'chi'),
  },
  {
    id: 'discard2',
    title: 'Descarte após a chamada',
    coach:
      'Após uma chamada você deve descartar. Conjuntos chamados ficam expostos na mesa. Descarte o 5 de Bambus solitário.',
    done: (s) => handEnded(s) || humanDiscarded(s, f('sou', 5)),
  },
  {
    id: 'watch',
    title: 'Vez dos oponentes',
    coach:
      'O turno gira no sentido anti-horário. Cada bot compra e descarta; quando alguém descarta, os outros podem chamar (Ron > Pon/Kong > Chow) — ' +
      'ou passar. Aguarde: seus oponentes vão passar e a vez volta para você.',
    done: (s) => handEnded(s) || (s.current === 0 && (s.phase === 'draw' || s.phase === 'discard')),
  },
  {
    id: 'tsumo',
    title: 'Vitória: TSUMO!',
    coach:
      'Você comprou o 5 de Bambus — sua mão fechou: 4 conjuntos + 1 par! Quando a peça vencedora vem da SUA compra, é TSUMO (todos pagam). ' +
      'Clique em TSUMO para vencer.',
    done: (s) => handEnded(s),
  },
  {
    id: 'score',
    title: 'Pontuação (fan)',
    coach:
      'Em Hong Kong a mão vale FAN (番): cada padrão soma fan e o pagamento dobra por fan. ' +
      'Sua mão: Simples (sem terminais/honras) +1 e Tsumo +1 = 2 fan = 4 pontos de cada jogador. ' +
      'Bônus (flores/estações) somam fan mas não contam para o mínimo.',
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
