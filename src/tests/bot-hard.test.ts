import { describe, it, expect } from 'vitest';
import { chooseDiscard, shouldDeclareRiichi, mcrValueBonus, type BotView } from '../game-engine/ai/bot';
import { totalRisk } from '../game-engine/ai/defense';
import { countsFromFaces, faceIndexFor, type TileFace } from './botTestUtils';
import { createRng } from '../game-engine/tiles/rng';

const f = (suit: TileFace['suit'], rank: number): TileFace => ({ suit, rank });

const baseView = (hand: TileFace[]): BotView => ({
  seat: 0,
  seatWind: 1,
  roundWind: 1,
  hand,
  melds: [],
  bonusFaces: [],
  visibleDiscards: [],
  otherMeldFaces: [],
  wallCount: 70,
  turnNumber: 5,
});

describe('item 9e — bot hard: betaori total, valor no riichi e MCR', () => {
  it('betaori total: com genbutsu disponível, descarta 100% seguro (mesmo perdendo shanten)', () => {
    // mão ruim (shanten >= 2) com um 5-man que o declarante de riichi já descartou
    const hand: TileFace[] = [
      f('man', 1), f('man', 3), f('man', 5), f('man', 7), f('man', 9),
      f('pin', 2), f('pin', 4), f('pin', 6), f('pin', 8),
      f('sou', 2), f('sou', 4), f('sou', 6), f('sou', 8), f('pin', 1),
    ];
    const view = baseView(hand);
    view.opponents = [
      { seat: 1, discards: [faceIndexFor(f('man', 5)), faceIndexFor(f('wind', 1))], meldCount: 1, riichi: true },
      { seat: 2, discards: [faceIndexFor(f('wind', 2))], meldCount: 0, riichi: false },
    ];
    const idx = chooseDiscard(view, 'hard', createRng(42));
    expect(hand[idx]).toEqual(f('man', 5)); // genbutsu obrigatório
  });

  it('betaori sem genbutsu: escolhe a peça de menor risco', () => {
    const hand: TileFace[] = [
      f('man', 2), f('man', 4), f('man', 6), f('man', 8),
      f('pin', 1), f('pin', 3), f('pin', 5), f('pin', 7), f('pin', 9),
      f('sou', 1), f('sou', 3), f('sou', 5), f('sou', 7), f('sou', 9),
    ];
    const view = baseView(hand);
    // declarante descartou peças que tornam man perigoso (suji/visíveis), sem genbutsu da mão
    view.visibleDiscards = [f('man', 1), f('man', 1), f('man', 9), f('pin', 5), f('sou', 5)];
    view.opponents = [
      { seat: 1, discards: [faceIndexFor(f('man', 1)), faceIndexFor(f('man', 9))], meldCount: 2, riichi: true },
    ];
    const idx = chooseDiscard(view, 'hard', createRng(7));
    // o risco da peça escolhida é o mínimo da mão (critério do betaori)
    const used = countsFromFaces([...view.visibleDiscards, ...view.otherMeldFaces, ...view.bonusFaces]);
    const opps = view.opponents!;
    const riskOf = (t: TileFace) => totalRisk(faceIndexFor(t), opps, used);
    const minRisk = Math.min(...hand.map(riskOf));
    expect(riskOf(hand[idx])).toBe(minRisk);
  });

  it('shouldDeclareRiichi: espera boa declara; espera ruim aguarda; fim de jogo e dragões declaram', () => {
    // tenpai de 3 esperas (1/4/7-man) + peça extra → declara
    const good = baseView([
      f('man', 2), f('man', 3), f('man', 4), f('man', 5), f('man', 6),
      f('pin', 5), f('pin', 6), f('pin', 7),
      f('sou', 5), f('sou', 6), f('sou', 7),
      f('pin', 1), f('pin', 1), f('pin', 9),
    ]);
    expect(shouldDeclareRiichi(good)).toBe(true);

    // penchan (só 3-man) cedo, sem valor → NÃO declara
    const bad = baseView([
      f('man', 1), f('man', 2), f('man', 4), f('man', 5), f('man', 6),
      f('man', 7), f('man', 8), f('man', 9),
      f('pin', 5), f('pin', 6), f('pin', 7),
      f('sou', 9), f('sou', 9), f('sou', 9),
    ]);
    expect(shouldDeclareRiichi(bad)).toBe(false);

    // mesma mão no fim de jogo (muro curto) → declara
    const late = { ...bad, wallCount: 30 };
    expect(shouldDeclareRiichi(late)).toBe(true);

    // espera ruim mas com trinca de dragões (valor próprio) → declara
    const dragons = baseView([
      f('man', 1), f('man', 2), f('man', 4), f('man', 5), f('man', 6),
      f('man', 7), f('man', 8), f('man', 9),
      f('pin', 5), f('pin', 6), f('pin', 7),
      f('dragon', 1), f('dragon', 1), f('dragon', 1),
    ]);
    expect(shouldDeclareRiichi(dragons)).toBe(true);

    // mão aberta nunca declara
    const open = { ...good, melds: [{ kind: 'chi' as const, faces: [f('man', 2), f('man', 3), f('man', 4)] }] };
    expect(shouldDeclareRiichi(open)).toBe(false);
  });

  it('MCR: mcrValueBonus premia flush e dragões; bot preserva dragões', () => {
    const pins8 = [f('pin', 1), f('pin', 2), f('pin', 3), f('pin', 4), f('pin', 5), f('pin', 6), f('pin', 7), f('pin', 8)];
    expect(mcrValueBonus(pins8)).toBe(10);
    expect(mcrValueBonus(pins8.slice(0, 6))).toBe(4);
    expect(mcrValueBonus(pins8.slice(0, 5))).toBe(0);
    expect(mcrValueBonus([f('man', 1), f('sou', 5), f('pin', 9)])).toBe(0);
    expect(mcrValueBonus([f('dragon', 1), f('dragon', 1), f('dragon', 1), f('man', 2)])).toBe(4.5);

    // efeito no descarte: com alternativas equivalentes, o bot MCR preserva
    // o dragão (bônus) e descarta o isolado comum
    const hand: TileFace[] = [
      f('man', 2), f('man', 3), f('man', 4),
      f('pin', 5), f('pin', 6), f('pin', 7),
      f('sou', 2), f('sou', 3), f('sou', 4),
      f('man', 8), f('man', 8),
      f('dragon', 2), f('wind', 3), f('wind', 4),
    ];
    const idxDragon = hand.findIndex((t) => t.suit === 'dragon');
    const idxMkr = (rulesetId?: string) => chooseDiscard({ ...baseView(hand), rulesetId }, 'hard', createRng(11));
    // a estratégia muda com o ruleset: o clássico descarta o dragão isolado,
    // o MCR o preserva (bônus de valor — dragões valem fan em MCR)
    expect(idxMkr(undefined)).toBe(idxDragon);
    expect(idxMkr('mcr')).not.toBe(idxDragon);
  });

});
