import { describe, it, expect } from 'vitest';
import { serializeLayout, parseLayout } from '../features/solitaire/editor-io';

describe('item 5 — layout import/export', () => {
  it('round-trips a layout through JSON', () => {
    const tiles: [number, number, number][] = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 3, 1], // half-offset coordinates survive
      [0, 4, 1],
    ];
    const text = serializeLayout('teste', tiles);
    const res = parseLayout(text);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.layout.name).toBe('teste');
      expect(res.layout.tiles).toEqual(tiles);
    }
  });

  it('rejects odd tile counts', () => {
    const res = parseLayout(JSON.stringify({ name: 'x', tiles: [[0, 0, 0]] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/par/);
  });

  it('rejects out-of-bounds and duplicate positions', () => {
    expect(parseLayout(JSON.stringify({ tiles: [[0, 99, 0], [0, 1, 0]] })).ok).toBe(false);
    expect(parseLayout(JSON.stringify({ tiles: [[5, 0, 0], [0, 1, 0]] })).ok).toBe(false);
    expect(parseLayout(JSON.stringify({ tiles: [[0, 1, 1], [0, 1, 1]] })).ok).toBe(false);
  });

  it('rejects malformed JSON gently', () => {
    const res = parseLayout('{nope');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/JSON/);
    expect(parseLayout('null').ok).toBe(false);
    expect(parseLayout(JSON.stringify({ tiles: 'nope' })).ok).toBe(false);
  });
});
