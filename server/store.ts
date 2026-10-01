import { createHash, randomBytes } from 'node:crypto';
import { runMigrations } from './migrate';
import { seasonKey } from './elo';
import pg from 'pg';
import type { ReplayAction } from '../src/game-engine/traditional/engine';

/**
 * Persistence for online rooms (item 4).
 *
 * A room is stored COMPACTLY and deterministically: its seed + action log
 * (see replayMatch) plus lobby metadata. Rebuilding a room = replaying the
 * log, so snapshots are tiny and always consistent.
 *
 * Two implementations:
 *  - MemoryStore : default, no external dependencies (state lives in the
 *                  server process; documented limitation).
 *  - PostgresStore: used when a database URL is configured (env
 *                  UMO_DATABASE_URL). Rooms survive server restarts and can
 *                  be rejoined from another device via seat tokens or
 *                  optional accounts.
 *
 * Secrets: account tokens are stored HASHED (sha256) — the plaintext token
 * only ever travels to the client that created it.
 */

export type RulesConfigId = 'classic' | 'chicken' | 'riichi' | 'mcr';

export interface SeatRecord {
  name: string;
  token: string;
  accountId: number | null;
}

export interface RoomRecord {
  code: string;
  rulesConfig: RulesConfigId;
  /** ranked rooms record results on the linked accounts at match end */
  ranked?: boolean;
  /** salas privadas (item 7.2): hash sha256 da senha */
  passwordHash?: string;
  seed: number;
  actions: ReplayAction[];
  seats: (SeatRecord | null)[];
  hostSeat: number;
  started: boolean;
  rngTick: number;
  updatedAt: number;
}

export interface AccountRecord {
  id: number;
  username: string;
  /** ranked-play stats (item 4b) */
  rankedPlayed?: number;
  rankedWins?: number;
  rankedPoints?: number;
  /** Elo rating for ranked play (item 6) */
  elo?: number;
  /** temporada ranqueada corrente e anterior (item 8.1) */
  season?: string | null;
  prevSeason?: string | null;
  prevElo?: number | null;
}

export interface HistoryRow {
  playedAt: number;
  win: boolean;
  points: number;
  eloBefore: number;
  eloAfter: number;
  roomCode: string;
  /** temporada (YYYY-MM) em que a partida valeu (item 8.1) */
  season?: string;
  /** log determinístico p/ revisão (item 8.3) */
  replay?: ReplayPayload;
  /** apenas flag nas listagens: há replay disponível? */
  hasReplay?: boolean;
}

/** conteúdo de replay: regras + seed + inputs externos (item 8.3) */
export interface ReplayPayload {
  rulesetId: string;
  seed: number;
  actions: unknown[];
}

export interface LeaderRow {
  username: string;
  elo: number;
  rankedPlayed: number;
  rankedWins: number;
  rankedPoints: number;
  prevSeason?: string | null;
  prevElo?: number | null;
}

export interface RoomStore {
  init(): Promise<void>;
  saveRoom(room: RoomRecord): Promise<void>;
  loadRoom(code: string): Promise<RoomRecord | null>;
  deleteRoom(code: string): Promise<void>;
  loadAllRooms(): Promise<RoomRecord[]>;
  createAccount(username: string): Promise<{ account: AccountRecord; accountToken: string }>;
  accountByToken(accountToken: string): Promise<AccountRecord | null>;
  accountById(accountId: number): Promise<AccountRecord | null>;
  roomsOfAccount(accountId: number): Promise<string[]>;
  linkSeat(code: string, seat: number, accountId: number): Promise<void>;
  recordRankedResult(accountId: number, win: boolean, pointsDelta: number, newElo?: number, season?: string): Promise<void>;
  recordHistory(accountId: number, row: HistoryRow): Promise<void>;
  history(accountId: number, limit?: number): Promise<HistoryRow[]>;
  /** busca o replay de uma partida do histórico (item 8.3) */
  historyReplay(accountId: number, playedAt: number): Promise<HistoryRow | null>;
  /** replays compartilháveis por código (item 9.2) */
  saveReplay(code: string, payload: ReplayPayload): Promise<void>;
  getReplay(code: string): Promise<ReplayPayload | null>;
  leaderboard(limit?: number): Promise<LeaderRow[]>;
  close(): Promise<void>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function newToken(): string {
  return randomBytes(18).toString('base64url');
}

/* ------------------------------------------------------------------ */
/* MemoryStore                                                         */
/* ------------------------------------------------------------------ */

export class MemoryStore implements RoomStore {
  private rooms = new Map<string, RoomRecord>();
  private accounts = new Map<
    number,
    {
      username: string; tokenHash: string; rankedPlayed: number; rankedWins: number; rankedPoints: number; elo: number;
      season: string | null; prevSeason: string | null; prevElo: number | null;
    }
  >();
  private nextId = 1;

  async init(): Promise<void> {}
  async saveRoom(room: RoomRecord): Promise<void> {
    this.rooms.set(room.code, room);
  }
  async loadRoom(code: string): Promise<RoomRecord | null> {
    return this.rooms.get(code) ?? null;
  }
  async deleteRoom(code: string): Promise<void> {
    this.rooms.delete(code);
  }
  async loadAllRooms(): Promise<RoomRecord[]> {
    return [...this.rooms.values()];
  }
  async createAccount(username: string): Promise<{ account: AccountRecord; accountToken: string }> {
    for (const [id, a] of this.accounts) {
      if (a.username === username) {
        // idempotent-ish: rotate the token, same account
        const t = newToken();
        a.tokenHash = sha(t);
        return { account: { id, username }, accountToken: t };
      }
    }
    const id = this.nextId++;
    const t = newToken();
    this.accounts.set(id, { username, tokenHash: sha(t), rankedPlayed: 0, rankedWins: 0, rankedPoints: 0, elo: 1500, season: null, prevSeason: null, prevElo: null });
    return { account: { id, username }, accountToken: t };
  }
  async accountByToken(accountToken: string): Promise<AccountRecord | null> {
    const h = sha(accountToken);
    for (const [id, a] of this.accounts)
      if (a.tokenHash === h)
        return { id, username: a.username, rankedPlayed: a.rankedPlayed, rankedWins: a.rankedWins, rankedPoints: a.rankedPoints, elo: a.elo, season: a.season, prevSeason: a.prevSeason, prevElo: a.prevElo };
    return null;
  }
  async accountById(accountId: number): Promise<AccountRecord | null> {
    const a = this.accounts.get(accountId);
    return a ? { id: accountId, username: a.username, rankedPlayed: a.rankedPlayed, rankedWins: a.rankedWins, rankedPoints: a.rankedPoints, elo: a.elo, season: a.season, prevSeason: a.prevSeason, prevElo: a.prevElo } : null;
  }
  async roomsOfAccount(accountId: number): Promise<string[]> {
    return [...this.rooms.values()]
      .filter((r) => r.seats.some((s) => s?.accountId === accountId))
      .map((r) => r.code);
  }
  async linkSeat(code: string, seat: number, accountId: number): Promise<void> {
    const r = this.rooms.get(code);
    if (r?.seats[seat]) r.seats[seat] = { ...r.seats[seat]!, accountId };
  }
  async recordRankedResult(accountId: number, win: boolean, pointsDelta: number, newElo?: number, season?: string): Promise<void> {
    const a = this.accounts.get(accountId);
    if (!a) return;
    // virada de temporada (item 8.1): arquiva o Elo anterior e volta a 1500
    const seas = season ?? seasonKey();
    if (a.season && a.season !== seas) {
      a.prevSeason = a.season;
      a.prevElo = a.elo;
      a.elo = 1500;
    }
    a.season = seas;
    a.rankedPlayed++;
    if (win) a.rankedWins++;
    a.rankedPoints += pointsDelta;
    if (newElo !== undefined) a.elo = newElo;
  }
  private historyRows = new Map<number, HistoryRow[]>();
  async recordHistory(accountId: number, row: HistoryRow): Promise<void> {
    const list = this.historyRows.get(accountId) ?? [];
    list.push(row);
    this.historyRows.set(accountId, list);
  }
  async history(accountId: number, limit = 20): Promise<HistoryRow[]> {
    // listagem não carrega o log inteiro, só a flag (item 8.3)
    return [...(this.historyRows.get(accountId) ?? [])]
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, limit)
      .map((r) => ({ ...r, hasReplay: !!r.replay, replay: undefined }));
  }
  async historyReplay(accountId: number, playedAt: number): Promise<HistoryRow | null> {
    return (this.historyRows.get(accountId) ?? []).find((r) => r.playedAt === playedAt) ?? null;
  }
  private replays = new Map<string, ReplayPayload>();
  async saveReplay(code: string, payload: ReplayPayload): Promise<void> {
    this.replays.set(code, payload);
  }
  async getReplay(code: string): Promise<ReplayPayload | null> {
    return this.replays.get(code) ?? null;
  }
  async leaderboard(limit = 20): Promise<LeaderRow[]> {
    return [...this.accounts.values()]
      .map((a) => ({ username: a.username, elo: a.elo, rankedPlayed: a.rankedPlayed, rankedWins: a.rankedWins, rankedPoints: a.rankedPoints, prevSeason: a.prevSeason, prevElo: a.prevElo }))
      .sort((x, y) => y.elo - x.elo || y.rankedPlayed - x.rankedPlayed)
      .slice(0, limit);
  }
  async close(): Promise<void> {}
}

/* ------------------------------------------------------------------ */
/* PostgresStore                                                       */
/* ------------------------------------------------------------------ */

export class PostgresStore implements RoomStore {
  private pool: pg.Pool;
  private url: string;

  constructor(databaseUrl: string) {
    this.url = databaseUrl;
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  }

  async init(): Promise<void> {
    // versioned migrations (server/migrations/*.sql) — idempotent
    await runMigrations(this.url);
  }

  async saveRoom(room: RoomRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO rooms (code, data, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [room.code, JSON.stringify(room), room.updatedAt]
    );
  }

  async loadRoom(code: string): Promise<RoomRecord | null> {
    const res = await this.pool.query('SELECT data FROM rooms WHERE code = $1', [code]);
    return res.rows[0] ? (res.rows[0].data as RoomRecord) : null;
  }

  async deleteRoom(code: string): Promise<void> {
    await this.pool.query('DELETE FROM rooms WHERE code = $1', [code]);
    await this.pool.query('DELETE FROM room_seats WHERE code = $1', [code]);
  }

  async loadAllRooms(): Promise<RoomRecord[]> {
    const res = await this.pool.query('SELECT data FROM rooms ORDER BY updated_at ASC');
    return res.rows.map((r) => r.data as RoomRecord);
  }

  async createAccount(username: string): Promise<{ account: AccountRecord; accountToken: string }> {
    const t = newToken();
    const hash = sha(t);
    const existing = await this.pool.query('SELECT id FROM accounts WHERE username = $1', [username]);
    if (existing.rows[0]) {
      const id = existing.rows[0].id as number;
      await this.pool.query('UPDATE accounts SET token_hash = $1 WHERE id = $2', [hash, id]);
      return { account: { id, username }, accountToken: t };
    }
    const ins = await this.pool.query(
      'INSERT INTO accounts (username, token_hash) VALUES ($1, $2) RETURNING id',
      [username, hash]
    );
    return { account: { id: ins.rows[0].id as number, username }, accountToken: t };
  }

  private rowToAccount(r: Record<string, unknown>): AccountRecord {
    return {
      id: r.id as number,
      username: r.username as string,
      rankedPlayed: r.ranked_played as number,
      rankedWins: r.ranked_wins as number,
      rankedPoints: r.ranked_points as number,
      elo: r.elo as number,
      season: (r.season as string | null) ?? null,
      prevSeason: (r.prev_season as string | null) ?? null,
      prevElo: (r.prev_elo as number | null) ?? null,
    };
  }

  async accountByToken(accountToken: string): Promise<AccountRecord | null> {
    const res = await this.pool.query(
      'SELECT id, username, ranked_played, ranked_wins, ranked_points, elo, season, prev_season, prev_elo FROM accounts WHERE token_hash = $1',
      [sha(accountToken)]
    );
    return res.rows[0] ? this.rowToAccount(res.rows[0]) : null;
  }

  async accountById(accountId: number): Promise<AccountRecord | null> {
    const res = await this.pool.query(
      'SELECT id, username, ranked_played, ranked_wins, ranked_points, elo, season, prev_season, prev_elo FROM accounts WHERE id = $1',
      [accountId]
    );
    return res.rows[0] ? this.rowToAccount(res.rows[0]) : null;
  }

  async roomsOfAccount(accountId: number): Promise<string[]> {
    const res = await this.pool.query(
      'SELECT r.code FROM rooms r JOIN room_seats s ON s.code = r.code WHERE s.account_id = $1 ORDER BY r.updated_at DESC',
      [accountId]
    );
    return res.rows.map((r) => r.code as string);
  }

  async linkSeat(code: string, seat: number, accountId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO room_seats (code, seat, account_id) VALUES ($1, $2, $3)
       ON CONFLICT (code, seat) DO UPDATE SET account_id = EXCLUDED.account_id`,
      [code, seat, accountId]
    );
  }

  async recordRankedResult(accountId: number, win: boolean, pointsDelta: number, newElo?: number, season?: string): Promise<void> {
    const seas = season ?? seasonKey();
    // virada de temporada (item 8.1): arquiva Elo e reinicia em 1500
    await this.pool.query(
      `UPDATE accounts SET
         prev_season = CASE WHEN season IS NOT NULL AND season <> $5 THEN season ELSE prev_season END,
         prev_elo    = CASE WHEN season IS NOT NULL AND season <> $5 THEN elo ELSE prev_elo END,
         elo         = CASE WHEN season IS NOT NULL AND season <> $5 THEN COALESCE($4, 1500) ELSE COALESCE($4, elo) END,
         season      = $5,
         ranked_played = ranked_played + 1,
         ranked_wins = ranked_wins + $2,
         ranked_points = ranked_points + $3
       WHERE id = $1`,
      [accountId, win ? 1 : 0, pointsDelta, newElo ?? null, seas]
    );
  }

  async recordHistory(accountId: number, row: HistoryRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO match_history (account_id, played_at, win, points, elo_before, elo_after, room_code, season, replay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        accountId, row.playedAt, row.win, row.points, row.eloBefore, row.eloAfter, row.roomCode,
        row.season ?? seasonKey(),
        row.replay ? JSON.stringify(row.replay) : null,
      ]
    );
  }

  async history(accountId: number, limit = 20): Promise<HistoryRow[]> {
    const res = await this.pool.query(
      `SELECT played_at, win, points, elo_before, elo_after, room_code, season, (replay IS NOT NULL) AS has_replay
       FROM match_history WHERE account_id = $1 ORDER BY played_at DESC, id DESC LIMIT $2`,
      [accountId, limit]
    );
    return res.rows.map((r) => ({
      playedAt: Number(r.played_at),
      win: r.win as boolean,
      points: r.points as number,
      eloBefore: r.elo_before as number,
      eloAfter: r.elo_after as number,
      roomCode: r.room_code as string,
      season: (r.season as string | null) ?? undefined,
      hasReplay: r.has_replay === true,
    }));
  }

  async historyReplay(accountId: number, playedAt: number): Promise<HistoryRow | null> {
    const res = await this.pool.query(
      `SELECT played_at, win, points, elo_before, elo_after, room_code, season, replay
       FROM match_history WHERE account_id = $1 AND played_at = $2 ORDER BY id DESC LIMIT 1`,
      [accountId, playedAt]
    );
    const r = res.rows[0];
    if (!r) return null;
    const replay =
      typeof r.replay === 'string'
        ? (JSON.parse(r.replay) as ReplayPayload)
        : ((r.replay as ReplayPayload | null) ?? undefined);
    return {
      playedAt: Number(r.played_at),
      win: r.win as boolean,
      points: r.points as number,
      eloBefore: r.elo_before as number,
      eloAfter: r.elo_after as number,
      roomCode: r.room_code as string,
      season: (r.season as string | null) ?? undefined,
      replay,
    };
  }

  async saveReplay(code: string, payload: ReplayPayload): Promise<void> {
    await this.pool.query(
      `INSERT INTO replays (code, payload, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [code, JSON.stringify(payload), Date.now()]
    );
  }

  async getReplay(code: string): Promise<ReplayPayload | null> {
    const res = await this.pool.query(`SELECT payload FROM replays WHERE code = $1`, [code]);
    const r = res.rows[0];
    if (!r) return null;
    return typeof r.payload === 'string' ? (JSON.parse(r.payload) as ReplayPayload) : (r.payload as ReplayPayload);
  }

  async leaderboard(limit = 20): Promise<LeaderRow[]> {
    const res = await this.pool.query(
      `SELECT username, elo, ranked_played, ranked_wins, ranked_points, prev_season, prev_elo
       FROM accounts ORDER BY elo DESC, ranked_played DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      username: r.username as string,
      elo: r.elo as number,
      rankedPlayed: r.ranked_played as number,
      rankedWins: r.ranked_wins as number,
      rankedPoints: r.ranked_points as number,
      prevSeason: (r.prev_season as string | null) ?? null,
      prevElo: (r.prev_elo as number | null) ?? null,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
