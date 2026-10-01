import type { TileFace } from '../tiles/tiles';
import { faceIndex, isTerminalOrHonor } from '../tiles/tiles';
import { countsFromFaces, normalShanten, acceptanceCount, winningWaits, type Counts } from '../traditional/hand';
import type { MeldKind } from '../traditional/engine';
import type { Rng } from '../tiles/rng';
import { totalRisk, threatLevel, type OppInfo } from './defense';
import { knittedShanten } from './knitted';

/**
 * Bots for the traditional mode.
 *
 * HARD CONSTRAINT: a bot only ever receives a `BotView` — its own hand plus
 * PUBLIC information (discards, exposed melds, bonus counts, wall count).
 * Opponent hands are not part of the type and never passed in.
 *
 * Difficulty levels (documented):
 *  - easy  : discards mostly at random with a mild preference for isolated
 *            honors/terminals; always claims a winning tile; claims
 *            pon/kan ~50% and chi ~25% of the time regardless of value.
 *            Limitation: frequently breaks useful shapes, no defence.
 *  - medium: keeps the hand shape optimal — discards the tile that
 *            minimises shanten (ties broken by acceptance count); claims
 *            only calls that lower shanten or complete the hand.
 *            Limitation: no defensive play, ignores scoring potential.
 *  - hard  : medium's offence plus REAL defence and a pressure model —
 *            per-opponent wait counting (genbutsu/suji/kabe, see ai/defense.ts)
 *            with three modes:
 *              BETAORI  — an opponent declared riichi and we are >= 2 shanten:
 *                         shanten is ignored, every tile ranked by safety
 *                         (genbutsu > visible > low-wait terminals);
 *              PRESSUR  — we are tenpai (vs anyone) or 1-shanten with no
 *                         riichi on the table: full-speed attack, risk weight
 *                         drops to ~0;
 *              BALANCED — otherwise: under threat (riichi / 2+ melds) the
 *                         discard pool widens to best-shanten+1 and safety is
 *                         weighted strongly.
 *            Also avoids chi unless it clearly advances the hand; keeps
 *            concealed hands for the +1 fan when close to ready; declares
 *            riichi when the ruleset allows it and the hand is concealed &
 *            tenpai.
 *            Limitation: pressur is threshold-based (no deal-in% x value EV
 *            computation), no nakasuji pruning, no wait enumeration beyond
 *            suji/kabe.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotView {
  seat: number;
  seatWind: number; // 1..4
  roundWind: number;
  hand: TileFace[]; // own hand only
  melds: { kind: MeldKind; faces: TileFace[] }[]; // own melds
  bonusFaces: TileFace[]; // own bonus
  visibleDiscards: TileFace[]; // every seat's discard pond
  otherMeldFaces: TileFace[]; // every seat's exposed melds
  wallCount: number;
  turnNumber: number;
  /** per-opponent public info for defence (optional; hard difficulty uses it) */
  opponents?: OppInfo[];
  /** regras da mesa (info pública) — o bot hard em MCR persegue mãos irregulares */
  rulesetId?: string;
}

export interface BotCallOptions {
  canRon: boolean;
  canPon: boolean;
  canKan: boolean;
  chiOptions: [TileFace, TileFace][] | null;
  discardFace: TileFace;
}

export type BotCall = 'ron' | 'pon' | 'kan' | 'chi' | 'pass';

function usedCounts(view: BotView, excludeHandIdx = -1): Counts {
  const c = countsFromFaces([
    ...view.visibleDiscards,
    ...view.otherMeldFaces,
    ...view.bonusFaces,
    ...view.melds.flatMap((m) => m.faces),
  ]);
  view.hand.forEach((f, i) => {
    if (i !== excludeHandIdx) {
      const idx = faceIndex(f);
      if (idx >= 0) c[idx]++;
    }
  });
  return c;
}

function handCounts(view: BotView): Counts {
  return countsFromFaces(view.hand);
}

/** shanten if we discard hand index i */
function shantenAfterDiscard(view: BotView, i: number): number {
  const remaining = view.hand.filter((_, k) => k !== i);
  return normalShanten(countsFromFaces(remaining), view.melds.length);
}

export function chooseDiscard(view: BotView, difficulty: Difficulty, rng: Rng): number {
  const n = view.hand.length;
  if (n === 0) return -1;

  if (difficulty === 'easy') {
    // 60% random, 40% "not obviously useful"
    if (rng.next() < 0.6) return rng.nextInt(n);
    const isolated = view.hand
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => isTerminalOrHonor(f))
      .map(({ i }) => i);
    if (isolated.length > 0) return isolated[rng.nextInt(isolated.length)];
    return rng.nextInt(n);
  }

  // medium & hard: minimise shanten; hard adds real per-opponent defence
  const base = normalShanten(handCounts(view), view.melds.length);
  const opps = view.opponents ?? [];
  const maxThreat = opps.length > 0 ? Math.max(...opps.map(threatLevel)) : 0;
  const riichiOpps = opps.filter((o) => o.riichi);

  // HARD pressure model (documented):
  //  - BETAORI (full fold): an opponent declared riichi AND our hand is far
  //    from ready (shanten >= 2) -> shanten is IGNORED; every tile is ranked
  //    purely by safety (genbutsu > visible > low-wait terminals).
  //  - PRESSUR (push): we are tenpai (against anyone) or 1-shanten with no
  //    riichi on the table -> attack at full speed, risk almost ignored.
  //  - otherwise: balanced mode — widen the pool by 1 shanten under threat
  //    and weight safety strongly.
  const fold = difficulty === 'hard' && riichiOpps.length > 0 && base >= 2;
  const push = difficulty === 'hard' && base <= 1 && riichiOpps.length === 0;
  const defensive = difficulty === 'hard' && maxThreat >= 2 && !push;

  // MCR hard (item 6.4): perseguir mãos irregulares. Se o shanten tricotado
  // (全不靠/七星不靠/組合龍) está na frente do normal — ou já está a 1 do
  // tenpai — descarta-se para minimizá-lo. Só informação pública + própria
  // mão; betaori (fold) ainda tem prioridade defensiva.
  if (difficulty === 'hard' && view.rulesetId === 'mcr' && view.melds.length === 0 && !fold) {
    const kn0 = knittedShanten(handCounts(view));
    if (kn0 < base || kn0 <= 1) {
      const knAfter: number[] = [];
      for (let i = 0; i < n; i++) {
        const c = handCounts(view);
        const fi = faceIndex(view.hand[i]);
        c[fi] = Math.max(0, (c[fi] ?? 0) - 1);
        knAfter.push(knittedShanten(c));
      }
      const bestKn = Math.min(...knAfter);
      const usedK = usedCounts(view);
      const options = knAfter.map((sh, idx) => ({ idx, sh })).filter((e) => e.sh === bestKn);
      // desempate: a peça mais "visível" (levemente mais segura)
      options.sort(
        (a, b) => (usedK[faceIndex(view.hand[b.idx])] ?? 0) - (usedK[faceIndex(view.hand[a.idx])] ?? 0)
      );
      return options[0].idx;
    }
  }

  let best = Infinity;
  const bySh: { sh: number; idx: number }[] = [];
  for (let i = 0; i < n; i++) {
    const sh = shantenAfterDiscard(view, i);
    bySh.push({ sh, idx: i });
    if (sh < best) best = sh;
  }

  const used = usedCounts(view);

  if (fold) {
    // betaori TOTAL (item 9.5): se houver GENBUTSU contra todos os
    // declarantes de riichi (peça que eles já descartaram → ron impossível),
    // o descarte sai obrigatoriamente desse subconjunto 100% seguro.
    const genbutsu = view.hand
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => {
        const fi = faceIndex(f);
        return riichiOpps.every((o) => o.discards.includes(fi));
      })
      .map(({ idx }) => idx);
    const poolIdx = genbutsu.length > 0 ? genbutsu : view.hand.map((_, i) => i);
    const scored = poolIdx.map((idx) => {
      const fi = faceIndex(view.hand[idx]);
      const risk = opps.length > 0 ? totalRisk(fi, opps, used) : 0;
      let s = -risk * 100 + (used[fi] ?? 0) * 10; // genbutsu/visible first
      if (isTerminalOrHonor(view.hand[idx])) s += 5; // fewer two-sided waits feed on these
      return { idx, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored[0].idx;
  }

  // defensive mode may sacrifice at most 1 shanten to fold toward safety
  const pool = bySh.filter((e) => e.sh <= best + (defensive ? 1 : 0));

  const scored = pool.map(({ idx }) => {
    const fi = faceIndex(view.hand[idx]);
    const remaining = view.hand.filter((_, k) => k !== idx);
    const acc = acceptanceCount(countsFromFaces(remaining), view.melds.length, used);
    const sh = bySh[idx].sh;
    let score = acc - sh * 50; // offence first
    if (difficulty === 'hard') {
      const visible = used[fi];
      score += visible * 3; // tiles already out are safer to discard
      const late = view.wallCount < 40;
      if (late && isTerminalOrHonor(view.hand[idx]) && visible === 0) score -= 6;
      if (view.hand[idx].suit === 'dragon') score -= 3;
      if (opps.length > 0) {
        const risk = totalRisk(fi, opps, used);
        score -= risk * (push ? 1 : defensive ? 40 : 4); // pressur ~ ignores risk
      }
      // item 10.3: MCR escolhe descarte por fan esperado (não só shanten)
      if (view.rulesetId === 'mcr') score += mcrExpectedFan(remaining);
    }
    return { idx, score };
  });
  scored.sort((a, b) => b.score - a.score);
  void base;
  return scored[0].idx;
}

export function chooseCall(
  view: BotView,
  opts: BotCallOptions,
  difficulty: Difficulty,
  rng: Rng
): { call: BotCall; chiChoice?: number } {
  if (opts.canRon) return { call: 'ron' };

  // MCR hard perseguindo mão irregular: chamadas quebrariam a mão fechada
  if (difficulty === 'hard' && view.rulesetId === 'mcr' && view.melds.length === 0) {
    const c = handCounts(view);
    const kn = knittedShanten(c);
    if (kn < normalShanten(c, 0) || kn <= 1) return { call: 'pass' };
  }

  const curShanten = normalShanten(handCounts(view), view.melds.length);

  const shantenAfterPon = (): number => {
    // remove two copies of the discard face from hand
    const fIdx = faceIndex(opts.discardFace);
    const remaining = [...view.hand];
    let removed = 0;
    for (let i = remaining.length - 1; i >= 0 && removed < 2; i--) {
      if (faceIndex(remaining[i]) === fIdx) { remaining.splice(i, 1); removed++; }
    }
    return normalShanten(countsFromFaces(remaining), view.melds.length + 1);
  };

  if (difficulty === 'easy') {
    if (opts.canKan && rng.next() < 0.5) return { call: 'kan' };
    if (opts.canPon && rng.next() < 0.5) return { call: 'pon' };
    if (opts.chiOptions && rng.next() < 0.25) return { call: 'chi', chiChoice: 0 };
    return { call: 'pass' };
  }

  // medium & hard
  const ponGain = curShanten - shantenAfterPon();
  if (opts.canKan) {
    const kanShanten = shantenAfterPon(); // kan keeps 4th aside similarly for shape
    const gain = curShanten - kanShanten;
    if (gain >= 1 || difficulty === 'medium') return { call: 'kan' };
    if (gain === 0 && view.wallCount > 30) return { call: 'kan' }; // kong fan chance
  }
  if (opts.canPon) {
    if (ponGain >= 1) return { call: 'pon' };
    if (difficulty === 'hard') {
      // value-aware: pon to keep concealed-hand fan only when it wins soon otherwise
      if (ponGain === 0 && curShanten <= 1 && rng.next() < 0.35) return { call: 'pon' };
      return { call: 'pass' };
    }
    if (ponGain === 0 && curShanten <= 1 && rng.next() < 0.5) return { call: 'pon' };
    return { call: 'pass' };
  }
  if (opts.chiOptions) {
    if (difficulty === 'hard') {
      // only chi when it clearly advances the hand
      const fIdx = faceIndex(opts.discardFace);
      for (let ci = 0; ci < opts.chiOptions.length; ci++) {
        const used = new Set<number>();
        const remaining: TileFace[] = [];
        for (const f of view.hand) {
          const need = opts.chiOptions[ci];
          const matchIdx = need.findIndex((nf, k) => !used.has(k) && faceIndex(nf) === faceIndex(f));
          if (matchIdx !== -1) { used.add(matchIdx); continue; }
          remaining.push(f);
        }
        void fIdx;
        if (used.size === 2) {
          const sh = normalShanten(countsFromFaces(remaining), view.melds.length + 1);
          if (curShanten - sh >= 1) return { call: 'chi', chiChoice: ci };
        }
      }
      return { call: 'pass' };
    }
    // medium: chi if it lowers shanten
    const remaining = view.hand.filter((f) => {
      const fIdx = faceIndex(f);
      return !opts.chiOptions![0].some((nf) => faceIndex(nf) === fIdx) || false;
    });
    // simplistic: try first option
    const fIdxs = opts.chiOptions[0].map((f) => faceIndex(f));
    const rem: TileFace[] = [];
    const need = [...fIdxs];
    for (const f of view.hand) {
      const k = need.indexOf(faceIndex(f));
      if (k !== -1) need.splice(k, 1);
      else rem.push(f);
    }
    if (need.length === 0) {
      const sh = normalShanten(countsFromFaces(rem), view.melds.length + 1);
      if (curShanten - sh >= 1) return { call: 'chi', chiChoice: 0 };
    }
    void remaining;
  }
  return { call: 'pass' };
}


/**
 * Noção de valor no riichi (item 9.5): o bot hard só declara riichi quando
 * vale a pena travar a mão — espera boa (3+ faces), OU fim de jogo (muro
 * curto, não dá para melhorar), OU a mão já tem elemento de valor
 * (trinca de dragões). Espera ruim em início/meio de jogo: aguarda melhoria.
 * Usa só a mão própria + informação pública.
 */
export function shouldDeclareRiichi(view: BotView): boolean {
  if (view.melds.some((m) => m.kind !== 'ankan')) return false; // mão aberta não declara
  const counts = countsFromFaces(view.hand);
  // melhor espera entre os descartes legais (mão de 14 → 13)
  let bestWaits = 0;
  const seen = new Set<number>();
  for (const f of view.hand) {
    const fi = faceIndex(f);
    if (seen.has(fi)) continue;
    seen.add(fi);
    const c = counts.slice();
    c[fi] = Math.max(0, (c[fi] ?? 0) - 1);
    const waits = winningWaits(c, view.melds.length).length;
    if (waits > bestWaits) bestWaits = waits;
  }
  if (bestWaits === 0) return false; // nem está tenpai
  if (bestWaits >= 3) return true; // espera boa
  if (view.wallCount <= 45) return true; // fim de jogo: ir até o fim
  return view.hand.filter((f) => f.suit === 'dragon').length >= 3; // valor próprio
}


/**
 * Noção de valor MCR (item 9.5): bônus para mãos que tendem a atingir o fan
 * mínimo da house rule — concentração em um naipe (flush/semi-flush) e
 * dragões (valores fixos em MCR). Informação 100% própria/pública.
 */
/**
 * item 10.3: fan esperado (MCR) — valor heurístico da mão restante,
 * somando os fan que a mão ainda PODE alcançar ponderados pela
 * probabilidade de alcançá-los (proporção das peças-chave já na mão).
 * Não é Monte Carlo: é uma estimativa barata e determinística usada
 * pelo hard para escolher QUAL mão seguir além do shanten.
 */
export function mcrExpectedFan(remaining: TileFace[]): number {
  let ev = 0;

  // Flush (24) / Meia-flush (6): concentração de naipe
  for (const su of ['man', 'pin', 'sou'] as const) {
    const n = remaining.filter((f) => f.suit === su).length;
    if (n >= 11) ev += 24 * 0.6; // pura quase decidida
    else if (n >= 9) ev += 6 * 0.8; // meia-flush muito provável
    else if (n >= 7) ev += 6 * 0.4; // meia-flush ainda viável
  }

  const byFace = new Map<string, number>();
  for (const f of remaining) {
    const k = `${f.suit}${f.rank}`;
    byFace.set(k, (byFace.get(k) ?? 0) + 1);
  }
  let trips = 0;
  let pairs = 0;
  for (const [k, n] of byFace) {
    if (k.startsWith('dragon')) {
      if (n >= 3) ev += 2; // Pung de Dragão (2 fan)
      else if (n === 2) ev += 0.5; // par a caminho
      else ev += 0.3; // dragão isolado ainda vale a pena guardar
    }
    if (n >= 3) trips++;
    else if (n === 2) pairs++;
  }

  // Todos os Trincas (6 fan)
  if (trips >= 3) ev += 6 * 0.6;
  else if (trips === 2 && pairs >= 2) ev += 6 * 0.3;

  // Todas as Simples (2 fan): sem terminais nem honras
  const hasTermOrHonor = remaining.some(
    (f) => f.suit === 'wind' || f.suit === 'dragon' || f.rank === 1 || f.rank === 9
  );
  if (!hasTermOrHonor) ev += 2 * 0.7;

  return ev;
}

