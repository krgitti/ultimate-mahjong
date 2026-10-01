import type { TileFace, MatchMode } from '../../game-engine/tiles/tiles';
import {
  createSolitaire,
  attemptPair,
  type SolitaireState,
} from '../../game-engine/solitaire/engine';
import { layoutPositions } from '../../game-engine/layouts';
import { SUITS } from '../../game-engine/tiles/tiles';

/**
 * item 10.2: replay de Solitaire no mesmo envelope versionado dos replays
 * tradicionais (umo-replay-v1, rulesetId 'solitaire'). O tabuleiro não é
 * reconstruível só por seed (as faces vêm do gerador de partidas
 * solúveis), então o replay carrega as faces iniciais + a lista de
 * pares jogados (ids de peça). Cada movimento é revalidado no rebuild:
 * replay com jogada ilegal é rejeitado (null).
 */

export interface SolitaireReplay {
  layoutId: string;
  seed: number;
  matchMode: MatchMode;
  /** faces iniciais, alinhadas com as posições do layout: [suit, rank] */
  faces: [string, number][];
  /** pares jogados, em ordem: [idA, idB] */
  moves: [number, number][];
}

const FORMAT = 'umo-replay-v1';

export function exportSolitaireReplay(rec: SolitaireReplay): string {
  return JSON.stringify({ format: FORMAT, rulesetId: 'solitaire', ...rec });
}

export function parseSolitaireReplay(json: string): SolitaireReplay | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (o.format !== FORMAT || o.rulesetId !== 'solitaire') return null;
    if (typeof o.layoutId !== 'string' || !o.layoutId) return null;
    if (typeof o.seed !== 'number' || !Number.isFinite(o.seed)) return null;
    if (o.matchMode !== 'classic' && o.matchMode !== 'strict') return null;
    if (!Array.isArray(o.faces) || o.faces.length === 0) return null;
    for (const f of o.faces) {
      if (!Array.isArray(f) || f.length !== 2) return null;
      if (typeof f[0] !== 'string' || typeof f[1] !== 'number') return null;
      if (!SUITS.includes(f[0] as (typeof SUITS)[number])) return null;
    }
    if (!Array.isArray(o.moves)) return null;
    for (const m of o.moves) {
      if (!Array.isArray(m) || m.length !== 2) return null;
      if (!Number.isInteger(m[0]) || !Number.isInteger(m[1])) return null;
    }
    return {
      layoutId: o.layoutId,
      seed: o.seed,
      matchMode: o.matchMode,
      faces: o.faces as [string, number][],
      moves: o.moves as [number, number][],
    };
  } catch {
    return null;
  }
}

/** reconstrói o tabuleiro inicial do replay (null se o layout não bater) */
export function replayInitial(rec: SolitaireReplay): SolitaireState | null {
  let positions;
  try {
    positions = layoutPositions(rec.layoutId);
  } catch {
    return null; // layout desconhecido (ex.: custom não registrado nesta sessão)
  }
  if (positions.length !== rec.faces.length) return null;
  const faces: TileFace[] = rec.faces.map(([suit, rank]) => ({ suit, rank } as TileFace));
  return createSolitaire({
    layoutId: rec.layoutId,
    seed: rec.seed,
    faces,
    positions,
    matchMode: rec.matchMode,
  });
}

/**
 * Reconstrói o estado após os primeiros `count` movimentos.
 * Qualquer jogada ilegal invalida o replay inteiro (null).
 */
export function replayAt(rec: SolitaireReplay, count: number): SolitaireState | null {
  const st = replayInitial(rec);
  if (!st) return null;
  const n = Math.max(0, Math.min(count, rec.moves.length));
  for (let i = 0; i < n; i++) {
    const [a, b] = rec.moves[i];
    if (!attemptPair(st, a, b).ok) return null;
  }
  return st;
}
