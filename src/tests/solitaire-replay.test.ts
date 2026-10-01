import { describe, it, expect } from 'vitest';
import { createRng } from '../game-engine/tiles/rng';
import { createSolitaire, attemptPair, legalPairs, remainingCount } from '../game-engine/solitaire/engine';
import { dealSolvable } from '../game-engine/solitaire/generator';
import { layoutPositions } from '../game-engine/layouts';
import {
  exportSolitaireReplay,
  parseSolitaireReplay,
  replayAt,
  replayInitial,
  type SolitaireReplay,
} from '../features/solitaire/replay';

function playSomeMoves(seed: number, nMoves: number) {
  const positions = layoutPositions('turtle');
  const deal = dealSolvable(positions, createRng(seed));
  const st = createSolitaire({ layoutId: 'turtle', seed, faces: deal.faces, positions, matchMode: 'classic' });
  const moves: [number, number][] = [];
  for (let i = 0; i < nMoves; i++) {
    const pair = legalPairs(st)[0];
    if (!pair) break;
    const r = attemptPair(st, pair.a.id, pair.b.id);
    expect(r.ok).toBe(true);
    moves.push([pair.a.id, pair.b.id]);
  }
  const rec: SolitaireReplay = {
    layoutId: 'turtle',
    seed,
    matchMode: 'classic',
    faces: st.tiles.map((t) => [t.face.suit, t.face.rank] as [string, number]),
    moves,
  };
  return { st, rec, total: positions.length };
}

describe('item 10.2 — replay de solitaire', () => {
  it('exporta, faz parse e reconstrói o estado final idêntico', () => {
    const { st, rec } = playSomeMoves(12, 12);
    const json = exportSolitaireReplay(rec);
    const parsed = parseSolitaireReplay(json);
    expect(parsed).not.toBeNull();
    const rebuilt = replayAt(parsed!, parsed!.moves.length);
    expect(rebuilt).not.toBeNull();
    expect(remainingCount(rebuilt!)).toBe(remainingCount(st));
    expect(rebuilt!.tiles.filter((x) => x.removed).map((x) => x.id)).toEqual(
      st.tiles.filter((x) => x.removed).map((x) => x.id)
    );
    expect(rebuilt!.score).toBe(st.score);
  });

  it('replayAt(k) reproduz o estado intermediário (k pares removidos)', () => {
    const { rec, total } = playSomeMoves(7, 8);
    const mid = replayAt(rec, 3);
    expect(mid).not.toBeNull();
    expect(mid!.tiles.filter((x) => x.removed)).toHaveLength(6);
    expect(remainingCount(mid!)).toBe(total - 6);
  });

  it('rejeita JSON inválido: formato, suit e jogada ilegal', () => {
    const { rec } = playSomeMoves(99, 5);
    // formato errado
    expect(parseSolitaireReplay(JSON.stringify({ format: 'x', ...rec }))).toBeNull();
    // suit inválido
    const badSuit = { ...rec, faces: rec.faces.map((f, i) => (i === 0 ? (['nope', 1] as [string, number]) : f)) };
    expect(parseSolitaireReplay(exportSolitaireReplay(badSuit))).toBeNull();
    // jogada ilegal (duas peças que não formam par livre) invalida o rebuild
    const tampered: SolitaireReplay = { ...rec, moves: [[0, 1], ...rec.moves] };
    expect(replayAt(tampered, tampered.moves.length)).toBeNull();
    // layout desconhecido
    expect(replayInitial({ ...rec, layoutId: 'nao-existe' })).toBeNull();
  });

  it('replay vazio (sem jogadas) reconstrói o tabuleiro inicial', () => {
    const { rec, total } = playSomeMoves(5, 3);
    const fresh = replayAt({ ...rec, moves: [] }, 0);
    expect(fresh).not.toBeNull();
    expect(remainingCount(fresh!)).toBe(total);
  });
});
