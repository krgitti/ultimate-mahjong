/**
 * Elo rating for 4-player ranked tables (item 6, pedido 6 — passo 1).
 *
 * Round-robin Elo: every player is compared against every other; the
 * expected score of i vs j is the logistic curve on the rating gap, and
 * the actual score is 1 (higher final score), 0.5 (tie) or 0 (lower).
 * Deltas are zero-sum (rounding drift is absorbed by the largest delta).
 */
export const ELO_BASE = 1500;
export const ELO_K = 32;

export function eloDeltas(elos: number[], scores: number[], k: number = ELO_K): number[] {
  const n = elos.length;
  if (n < 2) return new Array(n).fill(0);
  const raw = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const expected = 1 / (1 + Math.pow(10, (elos[j] - elos[i]) / 400));
      const actual = scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0;
      raw[i] += actual - expected;
    }
  }
  const deltas = raw.map((r) => Math.round((k * r) / (n - 1)));
  // keep it exactly zero-sum after rounding
  const drift = deltas.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    let mi = 0;
    for (let i = 1; i < n; i++) if (Math.abs(deltas[i]) > Math.abs(deltas[mi])) mi = i;
    deltas[mi] -= drift;
  }
  return deltas;
}
