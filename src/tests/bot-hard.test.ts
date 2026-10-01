import { describe, it, expect } from 'vitest';
import { chooseDiscard, shouldDeclareRiichi, mcrExpectedFan, type BotView } from '../game-engine/ai/bot';
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

  it('MCR: fan esperado (item 10.3) — EV puro e descarte guiado por valor', () => {
    // EV: concentração de naipe vale mais que mão mista
    const pins7 = [f('pin', 2), f('pin', 3), f('pin', 4), f('pin', 5), f('pin', 6), f('pin', 7), f('pin', 9)];
    const mixed = [f('man', 1), f('pin', 9), f('sou', 4), f('wind', 1), f('dragon', 2), f('man', 5), f('pin', 6)];
    expect(mcrExpectedFan(pins7)).toBeGreaterThan(mcrExpectedFan(mixed));
    // EV: trinca de dragão (2 fan) > par > isolado
    const trip = [f('dragon', 1), f('dragon', 1), f('dragon', 1)];
    const pair = [f('dragon', 1), f('dragon', 1), f('man', 5)];
    const lone = [f('dragon', 1), f('man', 5), f('sou', 6)];
    expect(mcrExpectedFan(trip)).toBeGreaterThan(mcrExpectedFan(pair));
    expect(mcrExpectedFan(pair)).toBeGreaterThan(mcrExpectedFan(lone));
    // EV: todas as simples (sem terminais/honras) pontua
    const simples = [f('man', 2), f('man', 3), f('pin', 5), f('pin', 6), f('sou', 7), f('sou', 8)];
    expect(mcrExpectedFan(simples)).toBeGreaterThan(0);
    expect(mcrExpectedFan([...simples.slice(0, 5), f('man', 9)])).toBe(0);

    // comportamento: meia-flush — o clássico solta o pino terminal isolado,
    // o MCR preserva o naipe (7 pinos → meia-flush viável) e solta o man
    const flushHand: TileFace[] = [
      f('pin', 2), f('pin', 3), f('pin', 4), f('pin', 5), f('pin', 6), f('pin', 7), f('pin', 9),
      f('man', 2), f('man', 3), f('man', 4),
      f('sou', 2), f('sou', 3),
      f('man', 7), f('wind', 2),
    ];
    const idxPin9 = flushHand.findIndex((x) => x.suit === 'pin' && x.rank === 9);
    const idxMan7 = flushHand.findIndex((x) => x.suit === 'man' && x.rank === 7);
    expect(chooseDiscard({ ...baseView(flushHand), rulesetId: undefined }, 'hard', createRng(5))).toBe(idxPin9);
    expect(chooseDiscard({ ...baseView(flushHand), rulesetId: 'mcr' }, 'hard', createRng(5))).toBe(idxMan7);
  });

});
