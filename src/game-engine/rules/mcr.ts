import { isCompleteHand, isSevenPairs, isThirteenOrphans } from '../traditional/hand';
import type { FanItem, ScoringResult } from '../scoring/hongkong-scoring';
import { decompose } from '../scoring/fu';
import type { Ruleset, WinContext } from './ruleset';


/**
 * MCR — MAHJONG COMPETITION RULES (China, 1998) — third pluggable ruleset.
 *
 * DOCUMENTED SCOPE (v1):
 *  - Wall: 144 tiles (flowers/seasons included; each bonus = 1 fan).
 *  - Winning forms: standard 4 melds + pair, SEVEN PAIRS and THIRTEEN
 *    ORPHANS (alternatives require a concealed hand).
 *  - Scoring is by FAN (points), not multipliers: the hand must reach a
 *    minimum of 8 fan EXCLUDING flowers/seasons; the final score equals the
 *    total fan (flowers included).
 *  - Fan implemented (v1 subset of the official 81-item table):
 *      88  Thirteen Orphans · Big Three Dragons
 *      64  All Honors · Little Three Dragons
 *      24  Seven Pairs · Full Flush
 *      16  Pure Straight (1-9 of one suit)
 *       8  Mixed Straight (123/456/789 across the three suits)
 *       6  All Pungs · Half Flush · Mixed Triple Chow
 *       4  Outside Hand
 *       2  All Simples · Fully Concealed · Dragon Pung · Seat Wind ·
 *          Prevalent Wind · All Sequences ("pinfu-like": all sequences,
 *          valueless pair, two-sided wait, ron)
 *       1  Self-Draw · No Honors · Edge Wait · Closed Wait · Single Wait
 *    Big/Little Three Dragons exclude the Dragon Pung fan (official rule).
 *    Everything else from the official table is OUT of v1 scope.
 *  - Payments (official MCR): self-draw — each opponent pays fan+8;
 *    win by discard — discarder pays fan+8, the others pay 8.
 *  - Dora/ippatsu do not exist in MCR (the fields are ignored).
 */
export interface MCRConfig {
  handsPerMatch: number;
  renchan: boolean;
  minFan: number;
}

export const MCR_DEFAULTS: MCRConfig = { handsPerMatch: 4, renchan: false, minFan: 8 };

const WIND_E = 27;
const DRAGON_R = 31;

const isTerm = (f: number) => f >= 27 || f % 9 === 0 || f % 9 === 8;
const suitOf = (f: number) => (f < 27 ? Math.floor(f / 9) : -1); // -1 = honor
const rankOf = (f: number) => f % 9; // 0-based

export function mcrRuleset(cfg: MCRConfig = MCR_DEFAULTS): Ruleset {
  return {
    id: 'mcr',
    name: 'MCR (Competição)',
    includeBonus: true,
    handsPerMatch: cfg.handsPerMatch,
    renchan: cfg.renchan,
    allowsRiichi: false,

    canWin(concealedCounts, meldsCount) {
      return (
        isCompleteHand(concealedCounts, meldsCount, false) ||
        (meldsCount === 0 && isSevenPairs(concealedCounts)) ||
        (meldsCount === 0 && isThirteenOrphans(concealedCounts))
      );
    },

    score(ctx: WinContext): ScoringResult {
      const items: FanItem[] = [];
      const add = (name: string, fan: number) => items.push({ name, fan, qualifies: true });

      const isChiitoi = ctx.melds.length === 0 && isSevenPairs(ctx.concealedCounts);
      const isKokushi = ctx.melds.length === 0 && isThirteenOrphans(ctx.concealedCounts);

      // flowers & seasons: 1 fan each, never count toward the 8-fan minimum
      const flowerFan = ctx.flowers + ctx.seasons;

      if (isKokushi) add('Treze Órfãos', 88);
      else if (isChiitoi) add('Sete Pares', 24);

      // full tile multiset (concealed incl. win tile + melds)
      const allFaces: number[] = [];
      for (let f = 0; f < 34; f++) for (let k = 0; k < (ctx.concealedCounts[f] ?? 0); k++) allFaces.push(f);
      for (const m of ctx.melds) for (const f of m.faces) if (f !== undefined) allFaces.push(f);

      // decomposition of the concealed part
      const dec = decompose(ctx.concealedCounts);
      const pungs = [...(dec?.pungs ?? [])];
      const concealedSeqs: [number, number, number][] = dec?.sequences ?? [];
      const meldSeqs: [number, number, number][] = ctx.melds
        .filter((m) => m.kind === 'chi')
        .map((m) => [...m.faces].sort((a, b) => (a ?? 0) - (b ?? 0)) as [number, number, number]);
      const allSeqs = [...concealedSeqs, ...meldSeqs];
      const pair = dec?.pair ?? -1;
      // meld pungs (pon/kan) count for family fans
      const meldPungFaces = ctx.melds.filter((m) => m.kind !== 'chi').map((m) => m.faces[0] ?? 0);
      const everyPung = [...pungs, ...meldPungFaces];

      const dragons = [31, 32, 33];
      const dragonPungCount = dragons.filter((d) => everyPung.includes(d)).length;
      const dragonPair = pair >= DRAGON_R;

      if (!isKokushi && !isChiitoi) {
        // 88 Big Three Dragons / 64 Little Three Dragons
        if (dragonPungCount === 3) add('Três Grandes Dragões', 88);
        else if (dragonPungCount === 2 && dragonPair) add('Três Pequenos Dragões', 64);

        // 64 All Honors
        if (allFaces.every((f) => f >= WIND_E)) add('Todas Honras', 64);

        // suits present among number tiles
        const suits = new Set(allFaces.filter((f) => f < 27).map(suitOf));
        const hasHonors = allFaces.some((f) => f >= WIND_E);
        // 24 Full Flush / 6 Half Flush
        if (suits.size === 1 && !hasHonors) add('Cor Pura (Chinitsu)', 24);
        else if (suits.size === 1 && hasHonors) add('Meia Cor (Honitsu)', 6);

        // 16 Pure Straight: 123+456+789 of ONE suit
        const seqStarts = allSeqs.map((s) => s[0]);
        const hasPureStraight = [0, 1, 2].some(
          (suit) =>
            seqStarts.includes(suit * 9 + 0) &&
            seqStarts.includes(suit * 9 + 3) &&
            seqStarts.includes(suit * 9 + 6)
        );
        if (hasPureStraight) add('Dragão Verde (Sequência 1-9)', 16);

        // 8 Mixed Straight: 123 of one suit, 456 of another, 789 of the third
        const suitsAt = (off: number) => new Set(seqStarts.filter((st) => st % 9 === off).map((st) => Math.floor(st / 9)));
        const s123 = suitsAt(0);
        const s456 = suitsAt(3);
        const s789 = suitsAt(6);
        const mOk = [...s123].some((a) => [...s456].some((b) => b !== a && [...s789].some((c2) => c2 !== a && c2 !== b)));
        if (mOk) add('Sequência Mista 123/456/789', 8);

        // 6 All Pungs
        if (allSeqs.length === 0 && everyPung.length === 4) add('Todas Trincas (Toitoi)', 6);

        // 6 Mixed Triple Chow: same-rank sequence in the three suits
        if ([0, 1, 2, 3, 4, 5, 6].some((r) => [0, 1, 2].every((s) => seqStarts.includes(s * 9 + r))))
          add('Trincas de Sequência nos 3 Naipes', 6);

        // 4 Outside Hand: every set AND the pair contains a terminal/honor
        const sets = [
          ...everyPung.map((f) => [f]),
          ...allSeqs.map((s) => s as number[]),
        ];
        if (sets.length === 4 && pair >= 0 && sets.every((g) => g.some(isTerm)) && isTerm(pair))
          add('Mão Externa (Chanta)', 4);

        // 2 Dragon Pung (excluded by Big/Little Three Dragons per official rules)
        const bigOrLittleDragons = dragonPungCount === 3 || (dragonPungCount === 2 && dragonPair);
        if (!bigOrLittleDragons) {
          for (const d of dragons) if (everyPung.includes(d)) add('Trinca de Dragão', 2);
        }
        // 2 Seat Wind / Prevalent Wind
        const seatFace = WIND_E + (ctx.seatWind - 1);
        const roundFace = WIND_E + (ctx.roundWind - 1);
        if (everyPung.includes(seatFace)) add('Trinca do Vento do Lugar', 2);
        if (everyPung.includes(roundFace)) add('Trinca do Vento Dominante', 2);

        // 2 Fully Concealed (no melds at all, win by discard)
        if (ctx.melds.length === 0 && !ctx.selfDrawn) add('Mão Totalmente Fechada', 2);

        // 2 All Sequences ("pinfu-like")
        if (everyPung.length === 0 && allSeqs.length === 4 && pair >= 0 && pair < WIND_E) {
          // two-sided wait (fallback reading via pre-win counts below is applied
          // together with the wait fan; here we only require the shape)
          add('Todas Sequências (par sem valor)', 2);
        }
      }

      // 2 All Simples (combines with seven pairs etc.)
      if (!isKokushi && allFaces.every((f) => f < 27 && rankOf(f) >= 1 && rankOf(f) <= 7)) add('Tudo Simples (Tanyao)', 2);

      // 1 No Honors
      if (allFaces.every((f) => f < 27)) add('Sem Honras', 1);

      // wait-based fans (1 each) from the pre-win concealed hand
      const pre = [...ctx.concealedCounts];
      pre[ctx.winFace] = Math.max(0, pre[ctx.winFace] - 1);
      const w = ctx.winFace;
      const num = w < 27;
      const inSuit = (o: number) => num && w + o >= 0 && w + o < 34 && Math.floor((w + o) / 9) === Math.floor(w / 9);
      const kanchan = num && inSuit(-1) && inSuit(1) && pre[w - 1] > 0 && pre[w + 1] > 0;
      const penchan =
        num &&
        ((rankOf(w) === 2 && pre[w - 2] > 0 && pre[w - 1] > 0) ||
          (rankOf(w) === 6 && pre[w + 1] > 0 && pre[w + 2] > 0));
      const ryanmen =
        num &&
        ((inSuit(1) && inSuit(2) && pre[w + 1] > 0 && pre[w + 2] > 0) ||
          (inSuit(-1) && inSuit(-2) && pre[w - 1] > 0 && pre[w - 2] > 0));
      const singleWait = pre[w] === 1;
      // seven pairs always wins on a single wait (each pair completes alone)
      if (isChiitoi) add('Espera Única (Tanki/Shanpon)', 1);
      else if (kanchan) add('Espera Central (Kanchan)', 1);
      else if (penchan) add('Espera de Borda (Penchan)', 1);
      else if (singleWait && !ryanmen) add('Espera Única (Tanki/Shanpon)', 1);

      // "All Sequences" bonus requires the two-sided wait (pinfu-like); drop otherwise
      if (items.some((i) => i.name.startsWith('Todas Sequências')) && !(ryanmen && !ctx.selfDrawn)) {
        const idx = items.findIndex((i) => i.name.startsWith('Todas Sequências'));
        if (idx >= 0) items.splice(idx, 1);
      }

      if (ctx.selfDrawn) add('Compra (Zimo)', 1);
      if (flowerFan > 0) add(`Flores/Estações (${flowerFan})`, flowerFan);

      const total = items.reduce((s, i) => s + i.fan, 0);
      const qualifying = total - flowerFan; // flowers do not count toward the minimum
      const meetsMinimum = qualifying >= cfg.minFan;
      const points = meetsMinimum ? total : 0;

      return {
        items,
        totalFan: total,
        qualifyingFan: qualifying,
        capped: total >= 88,
        points,
        meetsMinimum,
      };
    },

    payments(points, selfDrawn, discardSeat, winnerSeat, _dealerSeat) {
      const pays = [0, 0, 0, 0];
      if (points <= 0) return pays;
      for (let s = 0; s < 4; s++) {
        if (s === winnerSeat) continue;
        if (selfDrawn) pays[s] = points + 8;
        else pays[s] = s === discardSeat ? points + 8 : 8;
      }
      return pays;
    },

    summary() {
      return [
        'Regras de Competição (MCR 1998): pontuação por fan (pontos)',
        `Mínimo de ${cfg.minFan} fan (flores/estações não contam para o mínimo)`,
        'Subconjunto v1 da tabela: 88 órfãos/3 dragões · 64 honras/3 pequenos · 24 sete pares/cor pura · 16 dragão verde · 8 sequência mista · 6 toitoi/meia cor/3 naipes · 4 chanta · 2 simples/fechada/dragão/ventos/sequências · 1 zimo/sem honras/esperas',
        'Pagamento: tsumo — todos pagam fan+8; ron — descartador fan+8, demais 8',
        'Sem dora/riichi; chi apenas do jogador à esquerda',
        `Partida: ${cfg.handsPerMatch} mãos${cfg.renchan ? ', dealer repete ao vencer' : ''}`,
      ];
    },
  };
}
