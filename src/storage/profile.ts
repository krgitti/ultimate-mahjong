import { store, KEYS } from './storage';
import type { MatchMode } from '../game-engine/tiles/tiles';
import type { Difficulty } from '../game-engine/ai/bot';

/* ---------------- Settings ---------------- */

export interface Settings {
  sound: boolean;
  uiScale: number; // 0.8 .. 1.3
  highContrast: boolean;
  showTimer: boolean;
  solitaire: {
    matchMode: MatchMode;
  };
  traditional: {
    rules: 'classic' | 'chicken' | 'riichi';
    hands: 4 | 8 | 16;
    botDifficulty: Difficulty;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  uiScale: 1,
  highContrast: false,
  showTimer: true,
  solitaire: { matchMode: 'classic' },
  traditional: { rules: 'classic', hands: 4, botDifficulty: 'medium' },
};

export function loadSettings(): Settings {
  const s = store.read<Partial<Settings>>(KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    solitaire: { ...DEFAULT_SETTINGS.solitaire, ...(s.solitaire ?? {}) },
    traditional: { ...DEFAULT_SETTINGS.traditional, ...(s.traditional ?? {}) },
  };
}

export function saveSettings(s: Settings): void {
  store.write(KEYS.settings, s);
}

/* ---------------- Stats ---------------- */

export interface Stats {
  solitaire: {
    gamesPlayed: number;
    gamesWon: number;
    deadlocks: number;
    bestScore: number;
    fastestWinMs: number | null;
    totalPairs: number;
    totalMs: number;
    hintsUsed: number;
    shufflesUsed: number;
  };
  traditional: {
    handsPlayed: number;
    handsWon: number;
    matchesPlayed: number;
    matchesWon: number;
    bestFan: number;
    bestPoints: number;
    ronWins: number;
    tsumoWins: number;
    totalPoints: number;
  };
}

export const DEFAULT_STATS: Stats = {
  solitaire: {
    gamesPlayed: 0,
    gamesWon: 0,
    deadlocks: 0,
    bestScore: 0,
    fastestWinMs: null,
    totalPairs: 0,
    totalMs: 0,
    hintsUsed: 0,
    shufflesUsed: 0,
  },
  traditional: {
    handsPlayed: 0,
    handsWon: 0,
    matchesPlayed: 0,
    matchesWon: 0,
    bestFan: 0,
    bestPoints: 0,
    ronWins: 0,
    tsumoWins: 0,
    totalPoints: 0,
  },
};

export function loadStats(): Stats {
  const s = store.read<Partial<Stats>>(KEYS.stats, {});
  return {
    solitaire: { ...DEFAULT_STATS.solitaire, ...(s.solitaire ?? {}) },
    traditional: { ...DEFAULT_STATS.traditional, ...(s.traditional ?? {}) },
  };
}

export function saveStats(st: Stats): void {
  store.write(KEYS.stats, st);
}

export function recordSolitaireResult(r: {
  won: boolean;
  score: number;
  pairs: number;
  ms: number;
  hints: number;
  shuffles: number;
}): Stats {
  const st = loadStats();
  const s = st.solitaire;
  s.gamesPlayed += 1;
  s.totalPairs += r.pairs;
  s.totalMs += r.ms;
  s.hintsUsed += r.hints;
  s.shufflesUsed += r.shuffles;
  if (r.won) {
    s.gamesWon += 1;
    s.bestScore = Math.max(s.bestScore, r.score);
    s.fastestWinMs = s.fastestWinMs === null ? r.ms : Math.min(s.fastestWinMs, r.ms);
  } else {
    s.deadlocks += 1;
  }
  saveStats(st);
  return st;
}

export function recordTraditionalHand(r: {
  humanWon: boolean;
  selfDrawn: boolean;
  fan: number;
  points: number;
}): Stats {
  const st = loadStats();
  const t = st.traditional;
  t.handsPlayed += 1;
  if (r.humanWon) {
    t.handsWon += 1;
    t.bestFan = Math.max(t.bestFan, r.fan);
    t.bestPoints = Math.max(t.bestPoints, r.points);
    t.totalPoints += r.points;
    if (r.selfDrawn) t.tsumoWins += 1;
    else t.ronWins += 1;
  }
  saveStats(st);
  return st;
}

export function recordTraditionalMatch(won: boolean): Stats {
  const st = loadStats();
  st.traditional.matchesPlayed += 1;
  if (won) st.traditional.matchesWon += 1;
  saveStats(st);
  return st;
}

/* ---------------- Campaign ---------------- */

export interface CampaignLevel {
  id: number;
  name: string;
  layoutId: string;
  /** constraints */
  timeLimitMs: number | null;
  maxHints: number | null; // null = unlimited
  maxShuffles: number | null;
  targetMs: number; // for 2 stars
}

export const CAMPAIGN: CampaignLevel[] = [
  { id: 1, name: 'Primeiros passos', layoutId: 'pyramid', timeLimitMs: null, maxHints: null, maxShuffles: null, targetMs: 300_000 },
  { id: 2, name: 'Asas', layoutId: 'butterfly', timeLimitMs: null, maxHints: null, maxShuffles: null, targetMs: 360_000 },
  { id: 3, name: 'Muralhas', layoutId: 'fortress', timeLimitMs: null, maxHints: 5, maxShuffles: null, targetMs: 420_000 },
  { id: 4, name: 'Casco antigo', layoutId: 'turtle', timeLimitMs: null, maxHints: 3, maxShuffles: 2, targetMs: 480_000 },
  { id: 5, name: 'O dragão', layoutId: 'dragon', timeLimitMs: 900_000, maxHints: 3, maxShuffles: 1, targetMs: 600_000 },
  { id: 6, name: 'Jardim', layoutId: 'garden', timeLimitMs: 900_000, maxHints: 2, maxShuffles: 1, targetMs: 540_000 },
  { id: 7, name: 'Templo', layoutId: 'temple', timeLimitMs: 720_000, maxHints: 2, maxShuffles: 1, targetMs: 480_000 },
  { id: 8, name: 'Colunas', layoutId: 'columns', timeLimitMs: 600_000, maxHints: 1, maxShuffles: 0, targetMs: 420_000 },
  { id: 9, name: 'Redemoinho', layoutId: 'swirl', timeLimitMs: 600_000, maxHints: 1, maxShuffles: 0, targetMs: 420_000 },
  { id: 10, name: 'Galáxia', layoutId: 'galaxy', timeLimitMs: 480_000, maxHints: 0, maxShuffles: 0, targetMs: 360_000 },
];

export interface CampaignProgress {
  [levelId: number]: { stars: number; bestMs: number | null };
}

export function loadCampaign(): CampaignProgress {
  return store.read<CampaignProgress>(KEYS.campaign, {});
}

export function saveCampaignProgress(levelId: number, stars: number, ms: number): CampaignProgress {
  const p = loadCampaign();
  const prev = p[levelId];
  p[levelId] = {
    stars: Math.max(prev?.stars ?? 0, stars),
    bestMs: prev?.bestMs == null ? ms : Math.min(prev.bestMs, ms),
  };
  store.write(KEYS.campaign, p);
  return p;
}

/* ---------------- Challenges (deterministic) ---------------- */

export interface ChallengeDef {
  id: string;
  name: string;
  description: string;
  layoutId: string;
  seed: number;
  timeLimitMs: number | null;
  maxHints: number;
  maxShuffles: number;
}

export const CHALLENGES: ChallengeDef[] = [
  { id: 'ch-turtle-42', name: 'Tartaruga 42', description: 'Semente 42, sem dicas, 10 minutos.', layoutId: 'turtle', seed: 42, timeLimitMs: 600_000, maxHints: 0, maxShuffles: 1 },
  { id: 'ch-dragon-7', name: 'Dragão 7', description: 'Semente 7, 1 dica, 12 minutos.', layoutId: 'dragon', seed: 7, timeLimitMs: 720_000, maxHints: 1, maxShuffles: 1 },
  { id: 'ch-fortress-99', name: 'Fortaleza 99', description: 'Semente 99, sem embaralhar, 15 minutos.', layoutId: 'fortress', seed: 99, timeLimitMs: 900_000, maxHints: 2, maxShuffles: 0 },
  { id: 'ch-pyramid-1', name: 'Pirâmide 1', description: 'Semente 1, sem dicas, sem embaralhar.', layoutId: 'pyramid', seed: 1, timeLimitMs: null, maxHints: 0, maxShuffles: 0 },
  { id: 'ch-butterfly-123', name: 'Borboleta 123', description: 'Semente 123, 3 dicas, 8 minutos.', layoutId: 'butterfly', seed: 123, timeLimitMs: 480_000, maxHints: 3, maxShuffles: 1 },
  { id: 'ch-castle-5', name: 'Castelo 5', description: 'Semente 5, contrarrelógio de 12 minutos.', layoutId: 'castle', seed: 5, timeLimitMs: 720_000, maxHints: 2, maxShuffles: 2 },
];

export interface ChallengeResults {
  [id: string]: { completed: boolean; bestMs: number | null; bestScore: number };
}

export function loadChallengeResults(): ChallengeResults {
  return store.read<ChallengeResults>(KEYS.challenges, {});
}

export function saveChallengeResult(id: string, ms: number, score: number): ChallengeResults {
  const r = loadChallengeResults();
  const prev = r[id];
  r[id] = {
    completed: true,
    bestMs: prev?.bestMs == null ? ms : Math.min(prev.bestMs, ms),
    bestScore: Math.max(prev?.bestScore ?? 0, score),
  };
  store.write(KEYS.challenges, r);
  return r;
}

/* ---------------- Custom layouts (editor) ---------------- */

export interface CustomLayoutEntry {
  id: string;
  name: string;
  tiles: [number, number, number][];
}

export function loadCustomLayouts(): CustomLayoutEntry[] {
  return store.read<CustomLayoutEntry[]>(KEYS.customLayouts, []);
}

export function saveCustomLayouts(list: CustomLayoutEntry[]): void {
  store.write(KEYS.customLayouts, list);
}
