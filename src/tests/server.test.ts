// @vitest-environment node
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../../server/main';

const PORT = 8899;

interface Snap {
  t: string;
  seat?: number;
  view?: {
    phase: string;
    current: number;
    handNumber?: number;
    wallCount?: number;
    players: { name: string; discards: unknown[]; handCount: number }[];
    myHand?: { tiles: { id: number }[] };
    events: { t: string }[];
    offers: { seat: number; kind: string }[];
  };
  myActions?: { legal: number[] };
  meta?: { code: string; started: boolean; seats: ({ name: string; connected: boolean } | null)[]; spectators?: number };
  code?: string;
  token?: string;
  accountToken?: string;
  reconnected?: boolean;
  spectator?: boolean;
  error?: string;
}

interface TestClient {
  ws: WebSocket;
  next: (pred?: (m: Snap) => boolean, timeout?: number, label?: string) => Promise<Snap>;
}

function client(port: number = PORT): TestClient {
  const queue: Snap[] = [];
  const waiters: { pred: (m: Snap) => boolean; res: (m: Snap) => void; rej: (e: Error) => void }[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Snap;
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) {
      const [w] = waiters.splice(i, 1);
      w.res(m);
    } else queue.push(m);
  });
  const next = (pred: (m: Snap) => boolean = () => true, timeout = 30000, label = 'message') =>
    new Promise<Snap>((res, rej) => {
      const qi = queue.findIndex(pred);
      if (qi >= 0) {
        res(queue.splice(qi, 1)[0]);
        return;
      }
      const to = setTimeout(() => rej(new Error(`timeout waiting for: ${label}`)), timeout);
      waiters.push({
        pred,
        res: (m) => {
          clearTimeout(to);
          res(m);
        },
        rej: (e) => {
          clearTimeout(to);
          rej(e);
        },
      });
    });
  return { ws, next };
}

/**
 * Auto-passes any call offers for `seat` (and declines rob windows) so the
 * server's authoritative call resolution never waits on a silent client.
 */
function autoPass(c: TestClient, seat: number) {
  c.ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Snap;
    if (m.t !== 'snapshot' || !m.view) return;
    if (m.view.phase === 'calls' && m.view.offers.some((o) => o.seat === seat)) {
      c.ws.send(JSON.stringify({ t: 'action', action: { call: 'pass' } }));
    } else if (m.view.phase === 'calls-rob') {
      c.ws.send(JSON.stringify({ t: 'action', action: { yes: false } }));
    }
  });
}

/**
 * Plays `seat` automatically: discards legal[0] whenever it is that seat's
 * turn. Needed because bots may pon/chi and hand the turn BACK to a human —
 * a fixed A-then-B script would stall the authoritative server forever.
 * Deduplicated per (hand, wall) so rebroadcasts do not double-send.
 */
function autoPlay(c: TestClient, seat: number) {
  let lastKey = '';
  c.ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Snap;
    if (m.t !== 'snapshot' || !m.view || !m.myActions) return;
    if (m.view.phase === 'discard' && m.view.current === seat && m.myActions.legal.length > 0) {
      const key = `${m.view.handNumber}:${m.view.wallCount}`;
      if (key !== lastKey) {
        lastKey = key;
        c.ws.send(JSON.stringify({ t: 'action', action: { kind: 'discard', tileId: m.myActions.legal[0] } }));
      }
    }
  });
}

describe('item 5 — spectators (read-only seats)', () => {
  it('a spectator receives public snapshots, leaks no hands, and cannot act', async () => {
    const server = startServer({ port: PORT });
    const A = client();
    autoPass(A, 0);
    autoPlay(A, 0);
    A.ws.on('open', () => A.ws.send(JSON.stringify({ t: 'create', name: 'Ana' })));
    const j = await A.next((m) => m.t === 'joined', 30000, 'A joined');
    const code = j.code!;
    A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));
    await A.next((m) => m.t === 'snapshot' && m.meta!.started, 30000, 'started');

    const S = client();
    S.ws.on('open', () => S.ws.send(JSON.stringify({ t: 'spectate', code, name: 'Spy' })));
    const sj = await S.next((m) => m.t === 'joined', 30000, 'spec joined');
    expect(sj.seat).toBe(-1);
    expect(sj.spectator).toBe(true);

    const snap = await S.next((m) => m.t === 'snapshot', 30000, 'spec snapshot');
    expect(snap.seat).toBe(-1);
    const json = JSON.stringify(snap.view);
    expect(json).not.toContain('"myHand"'); // no private hand for spectators
    expect(snap.myActions).toBeUndefined();

    // spectators cannot act
    S.ws.send(JSON.stringify({ t: 'action', action: { kind: 'discard', tileId: 0 } }));
    const err = await S.next((m) => m.t === 'error', 30000, 'spec blocked');
    expect(err.error).toBeTruthy();

    // players see the spectator count in meta
    const withCount = await A.next((m) => m.t === 'snapshot' && m.meta!.spectators === 1, 30000, 'spectator count');
    expect(withCount.meta!.spectators).toBe(1);

    A.ws.close();
    S.ws.close();
    server.close();
  }, 60000);
});

describe('item 4 — authoritative server + reconnection', () => {
  it('two real clients play a hand; hidden hands never leak; reconnect restores the seat', async () => {
    const server = startServer({ port: PORT });

    const A = client();
    autoPass(A, 0);
    autoPlay(A, 0);
    A.ws.on('open', () => A.ws.send(JSON.stringify({ t: 'create', name: 'Ana' })));
    const joinedA = await A.next((m) => m.t === 'joined', 30000, 'A joined');
    expect(joinedA.code).toMatch(/^[A-Z2-9]{4}$/);
    const code = joinedA.code!;
    const tokenA = joinedA.token!;

    const B = client();
    autoPass(B, 1);
    autoPlay(B, 1);
    B.ws.on('open', () => B.ws.send(JSON.stringify({ t: 'join', code, name: 'Beto' })));
    const joinedB = await B.next((m) => m.t === 'joined', 30000, 'B joined');
    expect(joinedB.seat).toBe(1);

    // lobby snapshots arrive for both
    const lobbyA = await A.next((m) => m.t === 'snapshot' && m.meta!.seats[1] !== null, 30000, 'lobbyA');
    expect(lobbyA.meta!.started).toBe(false);
    expect(lobbyA.meta!.seats[1]!.name).toBeTruthy();

    // host starts with bots filling seats 2/3
    A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));
    const startedSnap = await A.next((m) => m.t === 'snapshot' && m.meta!.started, 30000, 'startedSnap');
    expect(startedSnap.meta!.seats[2]).toBeNull(); // bots are not sessions

    // A is dealer: server hands the turn to seat 0 with legal discards
    const myTurn = await A.next(
      (m) => m.t === 'snapshot' && m.view!.phase === 'discard' && m.view!.current === 0 && !!m.myActions,
      30000,
      'myTurn'
    );
    expect(myTurn.myActions!.legal.length).toBeGreaterThan(0);

    // hidden info check: B's snapshot must NOT contain A's hand faces
    const bSnap = await B.next((m) => m.t === 'snapshot' && !!m.view, 30000, 'bSnap');
    const bJson = JSON.stringify(bSnap.view!.players[0]);
    expect(bJson).not.toContain('"myHand"'); // other seats have no hand payload
    // and A's own snapshot DOES contain own hand
    expect(JSON.stringify(myTurn.view)).toContain('myHand');

    // discards start landing (from A and/or bots — calls may reorder turns)
    const seenByA = await A.next(
      (m) => m.t === 'snapshot' && m.view!.players.some((p) => p.discards.length >= 1),
      30000,
      'first discard'
    );
    expect(seenByA.view!.players.some((p) => p.discards.length >= 1)).toBe(true);

    // authoritative turn control: the server must WAIT for connected human B
    // (it never discards on B's behalf) and hand B legal actions.
    const bTurn = await B.next(
      (m) =>
        m.t === 'snapshot' &&
        m.view!.phase === 'discard' &&
        m.view!.current === 1 &&
        !!m.myActions &&
        m.myActions.legal.length > 0,
      30000,
      'bTurn'
    );
    expect(bTurn.view!.current).toBe(1);

    // game keeps flowing (events grow)
    await A.next((m) => m.t === 'snapshot' && m.view!.events.length >= 6, 30000, 'events6');

    // B disconnects and reconnects with the token
    const tokenB = joinedB.token!;
    B.ws.close();
    const awaySnap = await A.next((m) => m.t === 'snapshot' && m.meta!.seats[1]?.connected === false, 30000, 'awaySnap');
    expect(awaySnap.meta!.seats[1]!.connected).toBe(false);

    const B2 = client();
    autoPass(B2, 1);
    autoPlay(B2, 1);
    B2.ws.on('open', () => B2.ws.send(JSON.stringify({ t: 'join', code, name: 'B', token: tokenB })));
    const re = await B2.next((m) => m.t === 'joined' && !!m.reconnected, 30000, 'B2 rejoined');
    expect(re.seat).toBe(1);
    const backSnap = await B2.next((m) => m.t === 'snapshot', 30000, 'backSnap');
    expect(backSnap.seat).toBe(1);
    expect(backSnap.view!.players[1].handCount).toBeGreaterThan(0);
    void tokenA;

    A.ws.close();
    B2.ws.close();
    server.close();
  }, 60000);
});

describe('item 4b — Postgres snapshots, cross-device rejoin & optional accounts', () => {
  const DB = process.env.UMO_TEST_DATABASE_URL || 'postgres://umo:umo@127.0.0.1:5432/umo';
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function dbAvailable(): Promise<boolean> {
    try {
      const { default: pg } = await import('pg');
      const c = new pg.Client({ connectionString: DB });
      await c.connect();
      await c.end();
      return true;
    } catch {
      return false;
    }
  }

  async function cleanup(codes: string[], usernames: string[]) {
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: DB });
    await c.connect();
    for (const code of codes) {
      await c.query('DELETE FROM rooms WHERE code = $1', [code]);
      await c.query('DELETE FROM room_seats WHERE code = $1', [code]);
    }
    for (const u of usernames) await c.query('DELETE FROM accounts WHERE username = $1', [u]);
    await c.end();
  }

  it('a room survives a full server restart and the seat token still works', async () => {
    if (!(await dbAvailable())) return console.log('postgres unavailable — skipped');
    const s1 = startServer({ port: 8901, databaseUrl: DB });
    await s1.ready;
    const A = client(8901);
    A.ws.on('open', () => A.ws.send(JSON.stringify({ t: 'create', name: 'Ana' })));
    const j = await A.next((m) => m.t === 'joined', 30000, 'A joined (s1)');
    const code = j.code!;
    const tokenA = j.token!;
    A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));
    await A.next((m) => m.t === 'snapshot' && m.meta!.started, 30000, 'started (s1)');
    await sleep(900); // let the debounced save flush
    A.ws.close();
    s1.close();

    // brand-new server process state, same database
    const s2 = startServer({ port: 8902, databaseUrl: DB });
    await s2.ready;
    const A2 = client(8902);
    A2.ws.on('open', () => A2.ws.send(JSON.stringify({ t: 'join', code, name: 'Ana', token: tokenA })));
    const re = await A2.next((m) => m.t === 'joined' && !!m.reconnected, 30000, 'rejoin after restart');
    expect(re.seat).toBe(0);
    const snap = await A2.next((m) => m.t === 'snapshot', 30000, 'snapshot after restart');
    expect(snap.meta!.started).toBe(true);
    expect(snap.view!.players[0].handCount).toBeGreaterThan(0);
    A2.ws.close();
    s2.close();
    await cleanup([code], []);
  }, 60000);

  it('optional account: rejoin the same seat from a different device without the room code', async () => {
    if (!(await dbAvailable())) return console.log('postgres unavailable — skipped');
    const username = `utest-${Date.now()}`;
    const s1 = startServer({ port: 8903, databaseUrl: DB });
    await s1.ready;
    const C = client(8903);
    C.ws.on('open', () => C.ws.send(JSON.stringify({ t: 'account', username })));
    const acc = await C.next((m) => m.t === 'account', 30000, 'account created');
    const accountToken = acc.accountToken!;
    C.ws.send(JSON.stringify({ t: 'create', name: 'Conta', accountToken }));
    const j = await C.next((m) => m.t === 'joined', 30000, 'create with account');
    const code = j.code!;
    await sleep(900);
    C.ws.close();
    s1.close();

    // "another device": only the account token, no code, no seat token
    const s2 = startServer({ port: 8904, databaseUrl: DB });
    await s2.ready;
    const D = client(8904);
    D.ws.on('open', () => D.ws.send(JSON.stringify({ t: 'join', accountToken })));
    const re = await D.next((m) => m.t === 'joined' && !!m.reconnected, 30000, 'account rejoin');
    expect(re.seat).toBe(0);
    expect(re.code).toBe(code);
    D.ws.close();
    s2.close();
    await cleanup([code], [username]);
  }, 60000);
});
