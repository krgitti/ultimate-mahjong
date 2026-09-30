import type { RawLayout, RawTiles } from './types';

/**
 * Hand-crafted classic layouts (144 tiles each).
 * Coordinates are half-tile units; a tile spans 2x2 units.
 */

function pyramid(): RawTiles {
  const t: RawTiles = [];
  const cx = 8; // center in half-units (board width 16 tiles = 32 half units -> center 16? see below)
  // Rows widths per layer, centered on x=16 (half-units), full-tile aligned rows.
  const layers: { rows: number; widths: number[]; y0: number; dy: number }[] = [
    { rows: 8, widths: [2, 4, 6, 8, 10, 12, 14, 16], y0: 0, dy: 2 },
    { rows: 6, widths: [2, 4, 6, 8, 10, 12], y0: 2, dy: 2 },
    { rows: 4, widths: [2, 4, 6, 8], y0: 4, dy: 2 },
    { rows: 2, widths: [4, 4], y0: 6, dy: 2 },
  ];
  layers.forEach((L, layer) => {
    for (let r = 0; r < L.rows; r++) {
      const w = L.widths[r];
      const x0 = 16 - w; // centered: spans [16-w, 16+w) half units -> w tiles
      for (let i = 0; i < w; i++) t.push([layer, x0 + i * 2, L.y0 + r * L.dy]);
    }
  });
  // Cap: two tiles half-offset on top
  t.push([4, 16 - 2, 7]);
  t.push([4, 16, 7]);
  void cx;
  return t;
}

function fortress(): RawTiles {
  const t: RawTiles = [];
  const N = 14; // wall is 14x14 tiles
  // Outer wall ring (layer 0)
  for (let i = 0; i < N; i++) {
    t.push([0, i * 2, 0]);
    t.push([0, i * 2, (N - 1) * 2]);
    if (i > 0 && i < N - 1) {
      t.push([0, 0, i * 2]);
      t.push([0, (N - 1) * 2, i * 2]);
    }
  }
  // Inner courtyard 8x8 (rows/cols 3..10) minus the 2x2 center (makes room for tower supports)
  for (let r = 3; r <= 10; r++)
    for (let c = 3; c <= 10; c++) {
      if (r >= 6 && r <= 7 && c >= 6 && c <= 7) continue;
      t.push([0, c * 2, r * 2]);
    }
  // Tower supports at the four inner corners (layer 0).
  // Corner clusters occupy tiles 0-1 & 12-13 (rows/cols); inner corners are tile 1 / 12.
  t.push([0, 2, 2]);
  t.push([0, 24, 2]);
  t.push([0, 2, 24]);
  t.push([0, 24, 24]);
  // Corner towers 2x2 (layer 1) at each corner
  for (const [cr, cc] of [[0, 0], [0, N - 2], [N - 2, 0], [N - 2, N - 2]] as const)
    for (let dr = 0; dr < 2; dr++)
      for (let dc = 0; dc < 2; dc++) t.push([1, (cc + dc) * 2, (cr + dr) * 2]);
  // Side-center watch tiles (layer 1)
  t.push([1, 6 * 2, 0 * 2]);
  t.push([1, 7 * 2, 0 * 2]);
  t.push([1, 6 * 2, (N - 1) * 2]);
  t.push([1, 7 * 2, (N - 1) * 2]);
  t.push([1, 0 * 2, 6 * 2]);
  t.push([1, 0 * 2, 7 * 2]);
  t.push([1, (N - 1) * 2, 6 * 2]);
  t.push([1, (N - 1) * 2, 7 * 2]);
  // Tower tops (layer 2)
  for (const [cr, cc] of [[0, 0], [0, N - 2], [N - 2, 0], [N - 2, N - 2]] as const)
    t.push([2, (cc + 1) * 2, (cr + 1) * 2]);
  return t;
}

function butterfly(): RawTiles {
  const t: RawTiles = [];
  // Body columns 6-7, rows 0-11 (layer 0)
  for (let r = 0; r < 12; r++) {
    t.push([0, 6 * 2, r * 2]);
    t.push([0, 7 * 2, r * 2]);
  }
  // Wings layer 0: widths per row 1..9, left wing ends at col 5, right starts at col 8
  const w0 = [2, 3, 4, 5, 6, 6, 5, 4, 3]; // rows 1..9
  w0.forEach((w, i) => {
    const r = i + 1;
    for (let k = 0; k < w; k++) {
      t.push([0, (5 - w + 1 + k) * 2, r * 2]); // left wing, right-aligned at col 5
      t.push([0, (8 + (w - 1) - k) * 2, r * 2]); // right wing, left-aligned at col 8
    }
  });
  // Body layer 1: rows 2..9
  for (let r = 2; r <= 9; r++) {
    t.push([1, 6 * 2, r * 2]);
    t.push([1, 7 * 2, r * 2]);
  }
  // Wings layer 1: rows 3..7
  const w1 = [2, 3, 4, 3, 2];
  w1.forEach((w, i) => {
    const r = i + 3;
    for (let k = 0; k < w; k++) {
      t.push([1, (5 - w + 1 + k) * 2, r * 2]);
      t.push([1, (8 + (w - 1) - k) * 2, r * 2]);
    }
  });
  return t;
}

export const HANDCRAFTED_LAYOUTS: RawLayout[] = [
  { id: 'pyramid', name: 'Pirâmide', source: 'builtin', tiles: pyramid() },
  { id: 'fortress', name: 'Fortaleza', source: 'builtin', tiles: fortress() },
  { id: 'butterfly', name: 'Borboleta', source: 'builtin', tiles: butterfly() },
];
