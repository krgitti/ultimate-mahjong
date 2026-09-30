import { createHash, randomBytes } from 'node:crypto';
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
  private accounts = new Map<number, { username: string; tokenHash: string }>();
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
    this.accounts.set(id, { username, tokenHash: sha(t) });
    return { account: { id, username }, accountToken: t };
  }
  async accountByToken(accountToken: string): Promise<AccountRecord | null> {
    const h = sha(accountToken);
    for (const [id, a] of this.accounts) if (a.tokenHash === h) return { id, username: a.username };
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
  async close(): Promise<void> {}
}

/* ------------------------------------------------------------------ */
/* PostgresStore                                                       */
/* ------------------------------------------------------------------ */

export class PostgresStore implements RoomStore {
  private pool: import('pg').Pool;

  constructor(databaseUrl: string) {
    // lazy require so `pg` is only needed when a database is configured
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg') as typeof import('pg');
    this.pool = new Pool({ connectionString: databaseUrl, max: 4 });
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
    const res = await this.pool.query('SELECT id, username FROM accounts WHERE token_hash = $1', [sha(accountToken)]);
    return res.rows[0] ? { id: res.rows[0].id, username: res.rows[0].username } : null;
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
