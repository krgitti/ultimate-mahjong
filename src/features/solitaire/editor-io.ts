/**
 * Layout import/export (JSON) for the Solitaire layout editor.
 * Coordinates are engine half-tile units: x in [0,35], y in [0,23], layer in [0,4].
 */

export type RawTile = [number, number, number]; // [layer, x, y] in half units

export const EDIT_LIMITS = { x: 35, y: 23, layer: 4 };

export function serializeLayout(name: string, tiles: RawTile[]): string {
  return JSON.stringify({ v: 1, name, tiles }, null, 2);
}

export interface ParsedLayout {
  name: string;
  tiles: RawTile[];
}

export function parseLayout(text: string): { ok: true; layout: ParsedLayout } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON inválido.' };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'Estrutura inválida.' };
  const obj = data as { name?: unknown; tiles?: unknown };
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Importado';
  if (!Array.isArray(obj.tiles)) return { ok: false, error: 'Campo "tiles" ausente ou não é lista.' };
  const tiles: RawTile[] = [];
  const seen = new Set<string>();
  for (const row of obj.tiles) {
    if (!Array.isArray(row) || row.length !== 3 || row.some((n) => typeof n !== 'number' || !Number.isInteger(n)))
      return { ok: false, error: 'Cada peça deve ser [camada, x, y] inteiros.' };
    const [l, x, y] = row as number[];
    if (l < 0 || l > EDIT_LIMITS.layer || x < 0 || x > EDIT_LIMITS.x || y < 0 || y > EDIT_LIMITS.y)
      return { ok: false, error: `Peça fora dos limites (camada 0-${EDIT_LIMITS.layer}, x 0-${EDIT_LIMITS.x}, y 0-${EDIT_LIMITS.y}).` };
    const k = `${l}|${x}|${y}`;
    if (seen.has(k)) return { ok: false, error: 'Posições duplicadas no layout.' };
    seen.add(k);
    tiles.push([l, x, y]);
  }
  if (tiles.length === 0) return { ok: false, error: 'Layout vazio.' };
  if (tiles.length % 2 !== 0) return { ok: false, error: 'O número de peças precisa ser par.' };
  return { ok: true, layout: { name, tiles } };
}
