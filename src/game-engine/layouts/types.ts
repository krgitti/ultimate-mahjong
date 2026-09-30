/** A position on the board. x/y are in HALF-tile units; a tile spans 2x2 units. */
export interface TilePos {
  layer: number;
  x: number;
  y: number;
}

/** Raw compact layout: [layer, x, y][] */
export type RawTiles = [number, number, number][];

export interface RawLayout {
  id: string;
  name: string;
  source: 'builtin' | 'kmahjongg' | 'custom';
  tiles: RawTiles;
}

export interface LayoutDefinition extends RawLayout {
  /** tile count */
  count: number;
  layers: number;
  /** bounding box in half units */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function expandLayout(raw: RawLayout): LayoutDefinition {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, layers = 0;
  for (const [layer, x, y] of raw.tiles) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 2);
    maxY = Math.max(maxY, y + 2);
    layers = Math.max(layers, layer + 1);
  }
  return {
    ...raw,
    count: raw.tiles.length,
    layers,
    minX, maxX, minY, maxY,
  };
}

export function toPositions(raw: RawLayout): TilePos[] {
  return raw.tiles.map(([layer, x, y]) => ({ layer, x, y }));
}
