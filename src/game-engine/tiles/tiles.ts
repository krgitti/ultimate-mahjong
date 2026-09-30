/**
 * Tile model shared by both game modes.
 *
 * A standard Mahjong set has 144 tiles:
 *  - 3 suits (man/pin/sou) x ranks 1-9 x 4 copies = 108
 *  - 4 winds x 4 = 16, 3 dragons x 4 = 12  (honors = 28)
 *  - 4 flowers + 4 seasons = 8 bonus tiles
 */
export type Suit = 'man' | 'pin' | 'sou' | 'wind' | 'dragon' | 'flower' | 'season';

export interface TileFace {
  suit: Suit;
  rank: number; // man/pin/sou: 1-9; wind: 1=E 2=S 3=W 4=N; dragon: 1=red 2=green 3=white; flower/season: 1-4
}

export const SUITS: Suit[] = ['man', 'pin', 'sou', 'wind', 'dragon', 'flower', 'season'];

export function faceKey(f: TileFace): string {
  return `${f.suit}-${f.rank}`;
}

export function sameFace(a: TileFace, b: TileFace): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function isHonor(f: TileFace): boolean {
  return f.suit === 'wind' || f.suit === 'dragon';
}

export function isTerminal(f: TileFace): boolean {
  return (f.suit === 'man' || f.suit === 'pin' || f.suit === 'sou') && (f.rank === 1 || f.rank === 9);
}

export function isTerminalOrHonor(f: TileFace): boolean {
  return isHonor(f) || isTerminal(f);
}

export function isBonus(f: TileFace): boolean {
  return f.suit === 'flower' || f.suit === 'season';
}

export function isNumberSuit(f: TileFace): boolean {
  return f.suit === 'man' || f.suit === 'pin' || f.suit === 'sou';
}

/** All 34 basic (non-bonus) faces, in stable order. Index 0..33 is used as tile index by the traditional engine. */
export const BASIC_FACES: TileFace[] = (() => {
  const out: TileFace[] = [];
  for (const suit of ['man', 'pin', 'sou'] as const)
    for (let r = 1; r <= 9; r++) out.push({ suit, rank: r });
  for (let r = 1; r <= 4; r++) out.push({ suit: 'wind', rank: r });
  for (let r = 1; r <= 3; r++) out.push({ suit: 'dragon', rank: r });
  return out;
})();

export const BONUS_FACES: TileFace[] = (() => {
  const out: TileFace[] = [];
  for (let r = 1; r <= 4; r++) out.push({ suit: 'flower', rank: r });
  for (let r = 1; r <= 4; r++) out.push({ suit: 'season', rank: r });
  return out;
})();

export const ALL_FACES: TileFace[] = [...BASIC_FACES, ...BONUS_FACES];

export function faceIndex(f: TileFace): number {
  return BASIC_FACES.findIndex((b) => sameFace(b, f)); // -1 for bonus
}

export function indexToFace(i: number): TileFace {
  return BASIC_FACES[i];
}

/** Physical tile = face + unique id */
export interface Tile {
  id: number;
  face: TileFace;
}

/** Build the full tile set. ids deterministic. 144 with bonus, 136 without. */
export function buildFullSet(includeBonus = true): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;
  for (const f of BASIC_FACES) for (let c = 0; c < 4; c++) tiles.push({ id: id++, face: f });
  if (includeBonus) for (const f of BONUS_FACES) tiles.push({ id: id++, face: f });
  return tiles;
}

/* ---------- Solitaire matching rules ---------- */

export type MatchMode = 'classic' | 'strict';

/**
 * classic: identical faces match; any flower matches any flower; any season matches any season.
 * strict : only identical faces match (flowers need the exact same flower).
 */
export function facesMatch(a: TileFace, b: TileFace, mode: MatchMode = 'classic'): boolean {
  if (sameFace(a, b)) return true;
  if (mode === 'classic') {
    if (a.suit === 'flower' && b.suit === 'flower') return true;
    if (a.suit === 'season' && b.suit === 'season') return true;
  }
  return false;
}

/* ---------- Names (pt-BR) ---------- */

const WINDS = ['Leste', 'Sul', 'Oeste', 'Norte'];
const DRAGONS = ['Vermelho', 'Verde', 'Branco'];
const FLOWERS = ['Ameixa', 'Orquídea', 'Crisântemo', 'Bambu'];
const SEASONS = ['Primavera', 'Verão', 'Outono', 'Inverno'];
const SUIT_NAMES: Record<string, string> = { man: 'Caracteres', pin: 'Círculos', sou: 'Bambus' };

export function faceName(f: TileFace): string {
  switch (f.suit) {
    case 'wind': return `Vento ${WINDS[f.rank - 1]}`;
    case 'dragon': return `Dragão ${DRAGONS[f.rank - 1]}`;
    case 'flower': return `Flor ${FLOWERS[f.rank - 1]}`;
    case 'season': return `Estação ${SEASONS[f.rank - 1]}`;
    default: return `${f.rank} de ${SUIT_NAMES[f.suit]}`;
  }
}
