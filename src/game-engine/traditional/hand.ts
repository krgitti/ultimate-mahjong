import { BASIC_FACES, faceIndex, type TileFace } from '../tiles/tiles';

/**
 * Hand analysis for the standard 4-melds + 1-pair winning form.
 * All functions work on a 34-entry count array indexed by face index
 * (0-8 man, 9-17 pin, 18-26 sou, 27-30 winds E/S/W/N, 31-33 dragons R/G/W).
 *
 * Note (documented rule choice): seven pairs and thirteen orphans are NOT
 * winning forms in this Hong Kong variant (they exist as house rules; the
 * architecture allows adding them later without touching the engine core).
 */

export type Counts = number[]; // length 34

export function emptyCounts(): Counts {
  return new Array(34).fill(0);
}

export function countsFromFaces(faces: TileFace[]): Counts {
  const c = emptyCounts();
  for (const f of faces) {
    const i = faceIndex(f);
    if (i >= 0) c[i]++;
  }
  return c;
}

const inSameSuit = (i: number, k: number) => Math.floor(i / 9) === Math.floor(k / 9);

/** Can the remaining counts be decomposed entirely into `need` melds? */
export function canFormMelds(counts: Counts, need: number): boolean {
  if (need === 0) return counts.every((n) => n === 0);
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i >= 34) return false;
  // triplet
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canFormMelds(counts, need - 1)) { counts[i] += 3; return true; }
    counts[i] += 3;
  }
  // sequence (i, i+1, i+2) within the same suit
  if (i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0 && inSameSuit(i, i + 2)) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    if (canFormMelds(counts, need - 1)) { counts[i]++; counts[i + 1]++; counts[i + 2]++; return true; }
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
  return false;
}

/**
 * Is the concealed count array (3n+2 tiles) a complete hand given
 * `fixedMelds` already declared melds? 4 melds + 1 pair total.
 */
export function isCompleteHand(counts: Counts, fixedMelds: number): boolean {
  const need = 4 - fixedMelds;
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== need * 3 + 2) return false;
  const c = [...counts];
  for (let i = 0; i < 34; i++) {
    if (c[i] >= 2) {
      c[i] -= 2;
      const ok = canFormMelds(c, need);
      c[i] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/**
 * Normal-form shanten. Returns -1 when complete, 0 when tenpai, etc.
 * `fixedMelds` = declared chi/pon/kan melds.
 */
export function normalShanten(counts: Counts, fixedMelds: number): number {
  const need = 4 - fixedMelds;
  let best = need * 2; // worst case: no sets, no partials, no pair
  const c = [...counts];

  const rec = (idx: number, sets: number, partials: number, hasPair: boolean): void => {
    const capPartials = Math.min(partials, need - sets);
    const sh = (need - sets) * 2 - capPartials - (hasPair ? 1 : 0);
    if (sh < best) best = sh;
    if (best === -1) return;

    let i = idx;
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) return;

    // use tile i as part of a set
    if (sets < need) {
      if (c[i] >= 3) {
        c[i] -= 3;
        rec(i, sets + 1, partials, hasPair);
        c[i] += 3;
        if (best === -1) return;
      }
      if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && inSameSuit(i, i + 2)) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        rec(i, sets + 1, partials, hasPair);
        c[i]++; c[i + 1]++; c[i + 2]++;
        if (best === -1) return;
      }
    }
    // pair head
    if (!hasPair && c[i] >= 2) {
      c[i] -= 2;
      rec(i, sets, partials, true);
      c[i] += 2;
      if (best === -1) return;
    }
    // partial sets
    if (sets + partials < need) {
      if (c[i] >= 2) {
        c[i] -= 2;
        rec(i, sets, partials + 1, hasPair);
        c[i] += 2;
        if (best === -1) return;
      }
      if (i % 9 <= 7 && c[i + 1] > 0 && inSameSuit(i, i + 1)) {
        c[i]--; c[i + 1]--;
        rec(i, sets, partials + 1, hasPair);
        c[i]++; c[i + 1]++;
        if (best === -1) return;
      }
      if (i % 9 <= 6 && c[i + 2] > 0 && inSameSuit(i, i + 2)) {
        c[i]--; c[i + 2]--;
        rec(i, sets, partials + 1, hasPair);
        c[i]++; c[i + 2]++;
        if (best === -1) return;
      }
    }
    // skip this face entirely
    const save = c[i];
    c[i] = 0;
    rec(i + 1, sets, partials, hasPair);
    c[i] = save;
  };

  rec(0, 0, 0, false);
  return best;
}

/** Which faces (indices) complete a 3n+1-tile hand (tenpai waits)? */
export function winningWaits(counts: Counts, fixedMelds: number): number[] {
  const waits: number[] = [];
  const c = [...counts];
  for (let i = 0; i < 34; i++) {
    if (c[i] >= 4) continue;
    c[i]++;
    if (isCompleteHand(c, fixedMelds)) waits.push(i);
    c[i]--;
  }
  return waits;
}

/** Acceptance count: how many physical tiles (of the remaining pool) improve shanten. */
export function acceptanceCount(
  counts: Counts,
  fixedMelds: number,
  usedCounts: Counts
): number {
  const base = normalShanten(counts, fixedMelds);
  let total = 0;
  const c = [...counts];
  for (let i = 0; i < 34; i++) {
    const remaining = 4 - usedCounts[i];
    if (remaining <= 0) continue;
    c[i]++;
    if (normalShanten(c, fixedMelds) < base) total += remaining;
    c[i]--;
  }
  return total;
}

/** Convenience: shanten of a hand given as faces + number of declared melds. */
export function shantenOfFaces(faces: TileFace[], fixedMelds: number): number {
  return normalShanten(countsFromFaces(faces), fixedMelds);
}

export { BASIC_FACES };
