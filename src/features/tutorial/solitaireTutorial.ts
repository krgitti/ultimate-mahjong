import type { TilePos } from '../../game-engine/layouts/types';
import type { TileFace } from '../../game-engine/tiles/tiles';
import type { SolitaireState } from '../../game-engine/solitaire/engine';

/**
 * Scripted mini-board for the solitaire tutorial (12 tiles, 2 layers).
 * The faces are fixed so every step is deterministic.
 */
export const TUT_POSITIONS: TilePos[] = [
  // layer 0: 5x2 grid
  { layer: 0, x: 0, y: 0 }, { layer: 0, x: 2, y: 0 }, { layer: 0, x: 4, y: 0 }, { layer: 0, x: 6, y: 0 }, { layer: 0, x: 8, y: 0 },
  { layer: 0, x: 0, y: 2 }, { layer: 0, x: 2, y: 2 }, { layer: 0, x: 4, y: 2 }, { layer: 0, x: 6, y: 2 }, { layer: 0, x: 8, y: 2 },
  // layer 1: two tiles covering the left/middle blocks
  { layer: 1, x: 1, y: 1 }, { layer: 1, x: 3, y: 1 },
];

const f = (suit: TileFace['suit'], rank: number): TileFace => ({ suit, rank });

export const TUT_FACES: TileFace[] = [
  f('sou', 3), f('sou', 9), f('wind', 1), f('dragon', 1), f('man', 5), // y=0
  f('sou', 3), f('sou', 9), f('wind', 1), f('dragon', 1), f('pin', 7), // y=2
  f('man', 5), f('pin', 7), // layer 1
];

export type TutAction =
  | { type: 'select'; tileId: number }
  | { type: 'pair'; a: number; b: number; ok: boolean };

export interface TutStep {
  id: string;
  title: string;
  coach: string;
  /** highlight these tile ids */
  highlight?: (s: SolitaireState) => number[];
  /** is this action allowed right now? returns error message if not */
  allow?: (action: TutAction, s: SolitaireState) => string | null;
  /** has the step been completed? */
  done: (s: SolitaireState, ctx: TutContext) => boolean;
}

export interface TutContext {
  selectedDistinctSuits: Set<string>;
  pairsRemoved: number;
  lastPair: [number, number] | null;
  blockedMessageSeen: boolean;
}

export function newTutContext(): TutContext {
  return { selectedDistinctSuits: new Set(), pairsRemoved: 0, lastPair: null, blockedMessageSeen: false };
}

const isTopPair = (s: SolitaireState, a: number, b: number) =>
  s.tiles[a].pos.layer === 1 && s.tiles[b].pos.layer === 1;

export const SOLITAIRE_STEPS: TutStep[] = [
  {
    id: 'free',
    title: 'Peças livres',
    coach:
      'Uma peça está LIVRE quando nenhuma peça está em cima dela E pelo menos um dos lados (esquerda ou direita) está vazio. ' +
      'Clique em qualquer peça brilhante para selecioná-la. As peças escuras estão bloqueadas — tente clicar em uma para ver o que acontece.',
    highlight: (s) => s.tiles.filter((t) => !t.removed && t.pos.layer === 1 || (!t.removed && t.pos.x === 8)).map((t) => t.id),
    allow: (action, s) => {
      if (action.type === 'select') {
        const t = s.tiles[action.tileId];
        if (t.pos.layer === 1 || t.pos.x === 8) return null;
        return 'Ainda não — nesta lição, selecione uma peça LIVRE (as destacadas).';
      }
      return 'Primeiro selecione uma peça livre.';
    },
    done: (_s, ctx) => ctx.selectedDistinctSuits.size > 0,
  },
  {
    id: 'match',
    title: 'Pares iguais',
    coach:
      'Peças são removidas em PARES de faces compatíveis. O seu 5 de Caracteres no topo combina com o outro 5 de Caracteres à direita. ' +
      'Clique nele para formar o par.',
    highlight: (s) => s.tiles.filter((t) => !t.removed && t.face.suit === 'man').map((t) => t.id),
    allow: (action, s) => {
      if (action.type === 'select') {
        if (s.tiles[action.tileId].face.suit === 'man') return null;
        return 'Neste passo, forme o par de 5 de Caracteres (as peças destacadas).';
      }
      return null;
    },
    done: (_s, ctx) => ctx.pairsRemoved >= 1,
  },
  {
    id: 'match2',
    title: 'Flores, estações e pares',
    coach:
      'Agora remova o par de 7 de Círculos no topo. Regra especial: qualquer FLOR combina com qualquer flor, e qualquer ESTAÇÃO com outra estação.',
    highlight: (s) => s.tiles.filter((t) => !t.removed && t.face.suit === 'pin').map((t) => t.id),
    allow: (action, s) => {
      if (action.type === 'select') {
        if (s.tiles[action.tileId].face.suit === 'pin') return null;
        return 'Forme o par de 7 de Círculos para continuar.';
      }
      return null;
    },
    done: (_s, ctx) => ctx.pairsRemoved >= 2,
  },
  {
    id: 'layers',
    title: 'Camadas liberam peças',
    coach:
      'As peças do topo saíram — veja como as peças de baixo ficaram livres! Remova o par de 3 de Bambus (canto esquerdo).',
    highlight: (s) => s.tiles.filter((t) => !t.removed && t.face.suit === 'sou' && t.face.rank === 3).map((t) => t.id),
    allow: (action, s) => {
      if (action.type === 'select') {
        const t = s.tiles[action.tileId];
        if (t.face.suit === 'sou' && t.face.rank === 3) return null;
        return 'Agora é a vez do par de 3 de Bambus.';
      }
      return null;
    },
    done: (_s, ctx) => ctx.pairsRemoved >= 3,
  },
  {
    id: 'sides',
    title: 'Lados bloqueados',
    coach:
      'Mesmo sem cobertura, uma peça entre duas vizinhas continua BLOQUEADA. O 9 de Bambus do meio só ficou livre quando uma vizinhança abriu. ' +
      'Remova o par de 9 de Bambus.',
    highlight: (s) => s.tiles.filter((t) => !t.removed && t.face.suit === 'sou' && t.face.rank === 9).map((t) => t.id),
    allow: (action, s) => {
      if (action.type === 'select') {
        const t = s.tiles[action.tileId];
        if (t.face.suit === 'sou' && t.face.rank === 9) return null;
        return 'Remova o par de 9 de Bambus.';
      }
      return null;
    },
    done: (_s, ctx) => ctx.pairsRemoved >= 4,
  },
  {
    id: 'plan',
    title: 'Planejamento',
    coach:
      'Última lição: pense antes! Remover pares que LIBERAM outras peças evita ficar sem movimentos. ' +
      'Termine o tabuleiro: restam os pares de Vento Leste e Dragão Vermelho. Você pode usar 💡 Dica se precisar.',
    done: (s) => s.status === 'won',
  },
];

export function tutorialStepIndex(ctx: TutContext, s: SolitaireState): number {
  for (let i = 0; i < SOLITAIRE_STEPS.length; i++) {
    if (!SOLITAIRE_STEPS[i].done(s, ctx)) return i;
  }
  return SOLITAIRE_STEPS.length; // finished
}

void isTopPair;
