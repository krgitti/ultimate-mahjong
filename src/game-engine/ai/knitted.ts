/**
 * Shanten de mãos irregulares MCR (item 6.4) — 全不靠/七星不靠 e 組合龍.
 *
 * Usa apenas informação pública (a própria mão). O bot "hard" em regras
 * MCR compara estes valores com o shanten normal e, quando estão na
 * frente, persegue a mão irregular nos descartes (e recusa chamadas,
 * que quebrariam a mão fechada).
 */
import type { Counts } from '../traditional/hand';
import { normalShanten } from '../traditional/hand';

const PERMS: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const GROUPS: number[][] = [
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
];

/**
 * Honras tricotadas (全不靠; com 7 honras distintas vira 七星不靠):
 * 14 peças únicas — por naipe, até 3 peças de UM grupo tricotado
 * (147/258/369, grupos distintos entre naipes) + até 7 honras distintas.
 * Convenção do motor: -1 completa, 0 tenpai.
 */
export function knittedHonorsShanten(counts: Counts): number {
  let bestUseful = 0;
  for (const p of PERMS) {
    let useful = 0;
    for (let s = 0; s < 3; s++) {
      for (const r of GROUPS[p[s]]) if ((counts[s * 9 + r] ?? 0) > 0) useful++;
    }
    let honors = 0;
    for (let f = 27; f < 34; f++) if ((counts[f] ?? 0) > 0) honors++;
    useful += Math.min(7, honors);
    if (useful > bestUseful) bestUseful = useful;
  }
  return 13 - Math.min(14, bestUseful);
}

/**
 * Sequência tricotada (組合龍): 147/258/369 (um grupo por naipe, grupos
 * distintos) + 1 conjunto + 1 par. Exige mão totalmente fechada.
 */
export function knittedStraightShanten(counts: Counts, fixedMelds = 0): number {
  if (fixedMelds > 0) return 99;
  let best = 99;
  for (const p of PERMS) {
    const rest = [...counts] as Counts;
    let matched = 0;
    for (let g = 0; g < 3; g++) {
      for (const r of GROUPS[g]) {
        const f = p[g] * 9 + r;
        if ((rest[f] ?? 0) > 0) {
          rest[f]--;
          matched++;
        }
      }
    }
    const total = 9 - matched + normalShanten(rest, 3);
    if (total < best) best = total;
  }
  return best;
}

/** melhor dos dois shantens irregulares */
export function knittedShanten(counts: Counts, fixedMelds = 0): number {
  return Math.min(knittedHonorsShanten(counts), knittedStraightShanten(counts, fixedMelds));
}
