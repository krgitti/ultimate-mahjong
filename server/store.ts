import { createHash, randomBytes } from 'node:crypto';
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
}

export interface RoomStore {
  init(): Promise<void>;
  saveRoom(room: RoomRecord): Promise<void>;
  loadRoom(code: string): Promise<RoomRecord | null>;
  deleteRoom(code: string): Promise<void>;
  loadAllRooms(): Promise<RoomRecord[]>;
  createAccount(username: string): Promise<{ account: AccountRecord; accountToken: string }>;
  accountByToken(accountToken: string): Promise<AccountRecord | null>;
  roomsOfAccount(accountId: number): Promise<string[]>;
  linkSeat(code: string, seat: number, accountId: number): Promise<void>;
  recordRankedResult(accountId: number, win: boolean, pointsDelta: number): Promise<void>;
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
    { username: string; tokenHash: string; rankedPlayed: number; rankedWins: number; rankedPoints: number }
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
    this.accounts.set(id, { username, tokenHash: sha(t), rankedPlayed: 0, rankedWins: 0, rankedPoints: 0 });
    return { account: { id, username }, accountToken: t };
  }
  async accountByToken(accountToken: string): Promise<AccountRecord | null> {
    const h = sha(accountToken);
    for (const [id, a] of this.accounts)
      if (a.tokenHash === h)
        return { id, username: a.username, rankedPlayed: a.rankedPlayed, rankedWins: a.rankedWins, rankedPoints: a.rankedPoints };
    return null;
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
  async recordRankedResult(accountId: number, win: boolean, pointsDelta: number): Promise<void> {
    const a = this.accounts.get(accountId);
    if (!a) return;
    a.rankedPlayed++;
    if (win) a.rankedWins++;
    a.rankedPoints += pointsDelta;
  }
  async close(): Promise<void> {}
}

/* ------------------------------------------------------------------ */
/* PostgresStore                                                       */
/* ------------------------------------------------------------------ */

export class PostgresStore implements RoomStore {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        token_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_seats (
        code TEXT NOT NULL,
        seat INT NOT NULL,
        account_id INT NOT NULL,
        PRIMARY KEY (code, seat)
      );
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ranked_played INT NOT NULL DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ranked_wins INT NOT NULL DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ranked_points INT NOT NULL DEFAULT 0;
    `);
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

  async accountByToken(accountToken: string): Promise<AccountRecord | null> {
    const res = await this.pool.query(
      'SELECT id, username, ranked_played, ranked_wins, ranked_points FROM accounts WHERE token_hash = $1',
      [sha(accountToken)]
    );
    return res.rows[0]
      ? {
          id: res.rows[0].id,
          username: res.rows[0].username,
          rankedPlayed: res.rows[0].ranked_played,
          rankedWins: res.rows[0].ranked_wins,
          rankedPoints: res.rows[0].ranked_points,
        }
      : null;
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

  async recordRankedResult(accountId: number, win: boolean, pointsDelta: number): Promise<void> {
    await this.pool.query(
      `UPDATE accounts
       SET ranked_played = ranked_played + 1,
           ranked_wins = ranked_wins + $2,
           ranked_points = ranked_points + $3
       WHERE id = $1`,
      [accountId, win ? 1 : 0, pointsDelta]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
