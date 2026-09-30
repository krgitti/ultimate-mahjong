/**
 * Deterministic PRNG (mulberry32). The whole state is a single uint32,
 * which makes games fully serializable/reproducible from a seed.
 */
export interface Rng {
  next(): number; // [0,1)
  nextInt(n: number): number; // [0,n)
  state(): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (n) => Math.floor(next() * n),
    state: () => a >>> 0,
  };
}

export function rngFromState(state: number): Rng {
  return createRng(state);
}

/** Fisher-Yates shuffle (in place), deterministic given rng. */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick k distinct indices from [0,n) */
export function pickIndices(n: number, k: number, rng: Rng): number[] {
  const pool = Array.from({ length: n }, (_, i) => i);
  shuffle(pool, rng);
  return pool.slice(0, k);
}
