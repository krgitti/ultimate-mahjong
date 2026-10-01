import { describe, it, expect } from 'vitest';
import { chooseDiscard, shouldDeclareRiichi, mcrExpectedFan, mcrRolloutEv, rolloutBudget, type BotView } from '../game-engine/ai/bot';
import { dealInEv } from '../game-engine/ai/defense';
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
    expect(chooseDiscard({ ...baseView(flushHand), rulesetId: undefined }, 'hard', createRng(5))).toBe(idxPin9);
    // o MCR jamais quebra o naipe: descarta outra coisa (man solto ou vento),
    // mantendo os 7 pinos — desde o 11.2, às vezes escolhe até melhor (o vento)
    const mcrPick = flushHand[chooseDiscard({ ...baseView(flushHand), rulesetId: 'mcr' }, 'hard', createRng(5))];
    expect(mcrPick.suit).not.toBe('pin');
  });

  it('MCR: EV por amostragem (item 11.2) — tenpai vale mais que lixo, determinístico e barato', () => {
    const tenpai: TileFace[] = [
      f('man', 2), f('man', 3), f('man', 4),
      f('pin', 5), f('pin', 6), f('pin', 7),
      f('sou', 2), f('sou', 3), f('sou', 4),
      f('man', 8), f('man', 8),
      f('dragon', 1), f('dragon', 1),
    ];
    const junk: TileFace[] = [
      f('man', 1), f('man', 4), f('man', 7),
      f('pin', 2), f('pin', 5), f('pin', 9),
      f('sou', 3), f('sou', 6),
      f('wind', 1), f('wind', 2), f('wind', 3),
      f('dragon', 1), f('dragon', 2),
    ];
    const evT = mcrRolloutEv(tenpai, countsFromFaces(tenpai), createRng(3));
    const evJ = mcrRolloutEv(junk, countsFromFaces(junk), createRng(3));
    expect(evT).toBeGreaterThan(evJ);
    expect(evT).toBeGreaterThan(0);
    // determinístico: mesma seed, mesmo valor
    expect(mcrRolloutEv(tenpai, countsFromFaces(tenpai), createRng(3))).toBe(evT);
    // custo controlado: o chooseDiscard MCR completo (com amostragem) roda rápido
    const view: BotView = { ...baseView(tenpai.concat(f('wind', 4))), rulesetId: 'mcr' };
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) chooseDiscard(view, 'hard', createRng(i + 1));
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('item 12.1: orçamento adaptativo do rollout', () => {
    expect(rolloutBudget(3, 70)).toEqual({ samples: 12, horizon: 8 }); // longe, muro cheio
    expect(rolloutBudget(1, 70)).toEqual({ samples: 20, horizon: 10 }); // perto de fechar
    expect(rolloutBudget(3, 30)).toEqual({ samples: 20, horizon: 6 }); // fim de muro
    expect(rolloutBudget(0, 20)).toEqual({ samples: 32, horizon: 6 }); // tenpai no fim
  });

  it('item 12.1: EV de deal-in pondera o valor da mão do oponente', () => {
    // 5 de pinos alimentando uma espera 4-6 contra oponente fechado vs riichi
    const tile = faceIndexFor(f('pin', 5));
    const mk = (riichi: boolean, meldCount: number) => ({
      seat: 1,
      discards: [faceIndexFor(f('man', 1)), faceIndexFor(f('sou', 9))],
      meldCount,
      riichi,
    });
    const used = countsFromFaces([]);
    const evClosed = dealInEv(tile, [mk(false, 0)], used);
    const evOpen = dealInEv(tile, [mk(false, 3)], used);
    const evRiichi = dealInEv(tile, [mk(true, 1)], used);
    expect(evClosed).toBeGreaterThan(0);
    expect(evOpen).toBeGreaterThan(evClosed);
    expect(evRiichi).toBeGreaterThan(evOpen);
    // genbutsu (oponente já descartou a peça) → EV zero
    const genbutsu = { seat: 1, discards: [tile], meldCount: 0, riichi: true };
    expect(dealInEv(tile, [genbutsu], used)).toBe(0);
  });

});
