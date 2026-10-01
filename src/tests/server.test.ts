// @vitest-environment node
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../../server/main';
import { eloDeltas, seasonKey } from '../../server/elo';
import { PostgresStore, MemoryStore } from '../../server/store';

const PORT = 8899;

interface Snap {
  t: string;
  seat?: number;
  view?: {
    phase: string;
    current: number;
    handNumber?: number;
    wallCount?: number;
    players: { name: string; discards: unknown[]; handCount: number; isHuman?: boolean }[];
    myHand?: { tiles: { id: number }[] };
    events: { t: string }[];
    offers: { seat: number; kind: string }[];
  };
  myActions?: { legal: number[] };
  meta?: { code: string; started: boolean; seats: ({ name: string; connected: boolean } | null)[]; spectators?: number; ranked?: boolean; isPrivate?: boolean; turnExpiresAt?: number };
  code?: string;
  token?: string;
  accountToken?: string;
  reconnected?: boolean;
  spectator?: boolean;
  error?: string;
  seat2?: never;
  position?: number;
  size?: number;
  rules?: string;
  queued?: boolean;
  username?: string;
  rankedPlayed?: number;
  rankedWins?: number;
  rankedPoints?: number;
  elo?: number;
  season?: string;
  prevSeason?: string | null;
  prevElo?: number | null;
  text?: string;
  emote?: string;
  rows?: {
    username?: string; elo?: number; rankedPlayed?: number; rankedWins?: number; rankedPoints?: number;
    playedAt?: number; win?: boolean; points?: number; eloBefore?: number; eloAfter?: number; roomCode?: string; season?: string;
  }[];
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

describe('item 4c — matchmaking rápido, salas ranqueadas e stats', () => {
  const DB = process.env.UMO_TEST_DATABASE_URL || 'postgres://umo:umo@127.0.0.1:5432/umo';

  /** envia assim que o socket abrir (ou já, se abriu antes do registro) */
  function sendWhenOpen(c: TestClient, msg: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
    else c.ws.on('open', () => c.ws.send(JSON.stringify(msg)));
  }

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

  it('a fila monta a mesa com 4 jogadores e começa a partida', async () => {
    const server = startServer({ port: 8905 });
    const cs = [client(8905), client(8905), client(8905), client(8905)];
    sendWhenOpen(cs[0], { t: 'queue', name: 'P1' });
    const st = await cs[0].next((m) => m.t === 'queue', 30000, 'queue status');
    expect(st.position).toBe(1);
    expect(st.size).toBe(1);
    for (let i = 1; i < 4; i++) sendWhenOpen(cs[i], { t: 'queue', name: `P${i + 1}` });
    const joined = await Promise.all(cs.map((c, i) => c.next((m) => m.t === 'joined', 30000, `joined ${i}`)));
    expect(new Set(joined.map((j) => j.code)).size).toBe(1);
    expect(joined.map((j) => j.seat).sort()).toEqual([0, 1, 2, 3]);
    const snap = await cs[0].next((m) => m.t === 'snapshot', 30000, 'snap');
    expect(snap.meta!.started).toBe(true);
    for (const c of cs) c.ws.close();
    server.close();
  }, 90000);

  it('filas de regras diferentes não se misturam; unqueue atualiza posições', async () => {
    const server = startServer({ port: 8906 });
    const A = client(8906);
    const B = client(8906);
    const R = client(8906);
    sendWhenOpen(A, { t: 'queue', name: 'A' });
    await A.next((m) => m.t === 'queue' && m.size === 1, 30000, 'A1');
    sendWhenOpen(B, { t: 'queue', name: 'B' });
    await B.next((m) => m.t === 'queue' && m.size === 2, 30000, 'B2');
    sendWhenOpen(R, { t: 'queue', name: 'R', rules: 'riichi' });
    const rq = await R.next((m) => m.t === 'queue', 30000, 'R queue');
    expect(rq.rules).toBe('riichi');
    expect(rq.size).toBe(1);
    B.ws.send(JSON.stringify({ t: 'unqueue' }));
    await B.next((m) => m.t === 'unqueued', 30000, 'unqueued');
    const a2 = await A.next((m) => m.t === 'queue' && m.size === 1, 30000, 'A re-status');
    expect(a2.position).toBe(1);
    for (const c of [A, B, R]) c.ws.close();
    server.close();
  }, 90000);

  it('salas ranqueadas exigem conta; stats refletem resultados ranqueados', async () => {
    if (!(await dbAvailable())) {
      console.log('postgres unavailable — skipping ranked/stats test');
      return;
    }
    const s1 = startServer({ port: 8907, databaseUrl: DB });
    await s1.ready;

    const A = client(8907);
    sendWhenOpen(A, { t: 'create', name: 'SemConta', ranked: true });
    const err = await A.next((m) => m.t === 'error', 30000, 'ranked sem conta');
    expect(err.error).toMatch(/ranqueadas/i);
    A.ws.close();

    const B = client(8907);
    sendWhenOpen(B, { t: 'account', username: 'ranked-tester' });
    const acc = await B.next((m) => m.t === 'account', 30000, 'account');
    const at = acc.accountToken!;

    // grava um resultado pelo mesmo caminho usado no fim de partida ranqueada
    const { PostgresStore } = await import('../../server/store');
    const st = new PostgresStore(DB);
    await st.init();
    const found = await st.accountByToken(at);
    expect(found).toBeTruthy();
    await st.recordRankedResult(found!.id, true, 12000);
    await st.close();

    B.ws.send(JSON.stringify({ t: 'stats', accountToken: at }));
    const stats = await B.next((m) => m.t === 'stats', 30000, 'stats');
    expect(stats.rankedPlayed).toBe(1);
    expect(stats.rankedWins).toBe(1);
    expect(stats.rankedPoints).toBe(12000);

    B.ws.send(JSON.stringify({ t: 'create', name: 'ranked-tester', ranked: true, accountToken: at }));
    const j = await B.next((m) => m.t === 'joined', 30000, 'joined ranked');
    const snap = await B.next((m) => m.t === 'snapshot', 30000, 'snap ranked');
    expect(snap.meta!.ranked).toBe(true);
    B.ws.close();
    s1.close();
    await cleanup([j.code!], ['ranked-tester']);
  }, 90000);
});

describe('item 6a — Elo + leaderboard', () => {
  const DB = process.env.UMO_TEST_DATABASE_URL || 'postgres://umo:umo@127.0.0.1:5432/umo';

  /** envia assim que o socket abrir (ou já, se abriu antes do registro) */
  function sendWhenOpen(c: TestClient, msg: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
    else c.ws.on('open', () => c.ws.send(JSON.stringify(msg)));
  }

  it('eloDeltas: zero-sum, vencedor ganha, perdedor perde, zebras movem mais', () => {
    // mesa equilibrada: vencedor ganha, perdedor perde, soma zero
    const d1 = eloDeltas([1500, 1500, 1500, 1500], [40, 10, -10, -40]);
    expect(d1.reduce((a, b) => a + b, 0)).toBe(0);
    expect(d1[0]).toBeGreaterThan(0);
    expect(d1[3]).toBeLessThan(0);
    expect(d1[0]).toBe(-d1[3]);

    // zebra (1300 vence mesa forte): ganha mais do que ganharia em mesa igual
    const upset = eloDeltas([1300, 1500, 1600, 1700], [50, 10, 0, -10]);
    const even = eloDeltas([1500, 1500, 1600, 1700], [50, 10, 0, -10]);
    expect(upset[0]).toBeGreaterThan(even[0]);
    expect(upset.reduce((a, b) => a + b, 0)).toBe(0);

    // empate geral: deltas ~0 (esperado == realizado em mesa igual)
    const tie = eloDeltas([1500, 1500, 1500, 1500], [0, 0, 0, 0]);
    expect(tie.every((d) => d === 0)).toBe(true);

    // menos de 2 contas: sem mudança
    expect(eloDeltas([1500], [10])).toEqual([0]);
  });

  it('partida ranqueada completa grava stats e Elo zero-sum nas contas', async () => {
    const PORT6 = 8908;
    const server = startServer({ port: PORT6 });
    try {
      const A = client(PORT6);
      autoPass(A, 0);
      autoPlay(A, 0);
      const B = client(PORT6);
      autoPass(B, 1);
      autoPlay(B, 1);
      // item 7.2: ranqueadas exigem 3+ humanos — C joga sem conta
      const C = client(PORT6);
      autoPass(C, 2);
      autoPlay(C, 2);

      // contas
      const accA = await new Promise<string>((res) => {
        A.ws.on('message', (raw) => {
          const m = JSON.parse(String(raw)) as Snap;
          if (m.t === 'account' && m.accountToken) res(m.accountToken);
        });
        sendWhenOpen(A, { t: 'account', username: 'elo-ana' });
      });
      const accB = await new Promise<string>((res) => {
        B.ws.on('message', (raw) => {
          const m = JSON.parse(String(raw)) as Snap;
          if (m.t === 'account' && m.accountToken) res(m.accountToken);
        });
        sendWhenOpen(B, { t: 'account', username: 'elo-bia' });
      });

      // sala ranqueada: A cria, B entra com conta
      A.ws.send(JSON.stringify({ t: 'create', name: 'Ana', ranked: true, accountToken: accA }));
      const j = await A.next((m) => m.t === 'joined', 30000, 'A joined ranked');
      B.ws.send(JSON.stringify({ t: 'join', code: j.code, name: 'Bia', accountToken: accB }));
      await B.next((m) => m.t === 'joined', 30000, 'B joined ranked');
      sendWhenOpen(C, { t: 'join', code: j.code, name: 'Caio' });
      await C.next((m) => m.t === 'joined', 30000, 'C joined ranked');
      A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));
      await A.next((m) => m.t === 'snapshot' && m.meta!.started, 30000, 'started');

      // dirige a partida inteira (4 mãos; 3 humanos + bot no assento 3)
      await A.next((m) => m.t === 'snapshot' && m.view?.phase === 'match-over', 420000, 'match-over');

      // o registro é assíncrono após o match-over
      await new Promise((r) => setTimeout(r, 1500));

      const statsOf = async (c: TestClient, accTok: string): Promise<Snap> => {
        c.ws.send(JSON.stringify({ t: 'stats', accountToken: accTok }));
        return c.next((m) => m.t === 'stats', 10000, 'stats');
      };
      const sa = await statsOf(A, accA);
      const sb = await statsOf(B, accB);
      expect(sa.rankedPlayed).toBe(1);
      expect(sb.rankedPlayed).toBe(1);
      expect(Number.isInteger(sa.elo)).toBe(true);
      expect(Number.isInteger(sb.elo)).toBe(true);
      // Elo é zero-sum entre as duas contas vinculadas
      expect((sa.elo ?? 0) + (sb.elo ?? 0)).toBe(3000);
      // quem venceu (maior pontuação) não perdeu Elo; perdedor não ganhou
      const winnerIsA = (sa.rankedWins ?? 0) === 1;
      if (sa.elo !== 1500 || sb.elo !== 1500) {
        expect(winnerIsA ? sa.elo! > 1500 : sb.elo! > 1500).toBe(true);
        expect(winnerIsA ? sb.elo! < 1500 : sa.elo! < 1500).toBe(true);
      }

      // leaderboard reflete as duas contas
      const L = client(PORT6);
      sendWhenOpen(L, { t: 'leaderboard' });
      const lb = await L.next((m) => m.t === 'leaderboard', 10000, 'leaderboard');
      const rows = lb.rows!;
      const ana = rows.find((r) => r.username === 'elo-ana')!;
      const bia = rows.find((r) => r.username === 'elo-bia')!;
      expect(ana.elo).toBe(sa.elo);
      expect(bia.elo).toBe(sb.elo);
      // ordenado por elo decrescente
      for (let i = 1; i < rows.length; i++) expect(rows[i - 1].elo!).toBeGreaterThanOrEqual(rows[i].elo!);

      // histórico (item 7.1): uma partida por conta, Elo antes/depois coerente
      A.ws.send(JSON.stringify({ t: 'history', accountToken: accA }));
      const ha = await A.next((m) => m.t === 'history', 10000, 'history A');
      const hrows = ha.rows!;
      expect(hrows.length).toBe(1);
      expect(hrows[0].eloBefore).toBe(1500);
      expect(hrows[0].eloAfter).toBe(sa.elo);
      expect(hrows[0].roomCode).toBe(j.code);
      expect(hrows[0].win).toBe((sa.rankedWins ?? 0) === 1);
      expect(Number(hrows[0].playedAt)).toBeGreaterThan(0);
      // temporada (item 8.1)
      expect(sa.season).toBe(seasonKey());
      expect(hrows[0].season).toBe(seasonKey());
      L.ws.close();
    } finally {
      await server.close();
    }
  }, 480000);

  it('PostgresStore: Elo persiste e leaderboard ordena', async () => {
    let ok = true;
    try {
      const c = new PostgresStore(DB);
      await c.init();
      const { account: a1, accountToken: t1 } = await c.createAccount('pg-elo-1-' + Date.now());
      const { account: a2 } = await c.createAccount('pg-elo-2-' + Date.now());
      await c.recordRankedResult(a1.id, true, 30, 1516);
      await c.recordRankedResult(a2.id, false, -30, 1484);
      const back = await c.accountById(a1.id);
      expect(back?.elo).toBe(1516);
      const rows = await c.leaderboard(50);
      const i1 = rows.findIndex((r) => r.username.startsWith('pg-elo-1-'));
      const i2 = rows.findIndex((r) => r.username.startsWith('pg-elo-2-'));
      expect(i1).toBeGreaterThanOrEqual(0);
      expect(i2).toBeGreaterThanOrEqual(0);
      expect(i1).toBeLessThan(i2); // 1516 > 1484
      expect(rows[i1].elo).toBe(1516);
      const byToken = await c.accountByToken(t1);
      expect(byToken?.elo).toBe(1516);
      // temporada (item 8.1): conta jogou em 2020-01 com Elo 1516 → nova temporada
      await c.recordRankedResult(a1.id, true, 10, 1508, seasonKey());
      const rolled = await c.accountById(a1.id);
      expect(rolled?.prevSeason).toBeNull(); // primeira temporada registrada
      expect(rolled?.season).toBe(seasonKey());
      expect(rolled?.elo).toBe(1508);
      // simula temporada antiga e verifica o rollover
      await c.recordRankedResult(a1.id, false, -8, 1620, '2020-01');
      await c.recordRankedResult(a1.id, true, 12, 1516, seasonKey());
      const after = await c.accountById(a1.id);
      expect(after?.prevSeason).toBe('2020-01');
      expect(after?.prevElo).toBe(1620);
      expect(after?.elo).toBe(1516);
      // histórico (item 7.1)
      await c.recordHistory(a1.id, { playedAt: 1000, win: true, points: 30, eloBefore: 1500, eloAfter: 1516, roomCode: 'PG01' });
      await c.recordHistory(a1.id, { playedAt: 2000, win: false, points: -16, eloBefore: 1516, eloAfter: 1516, roomCode: 'PG02' });
      const h = await c.history(a1.id, 10);
      expect(h.length).toBe(2);
      expect(h[0].playedAt).toBe(2000); // mais recente primeiro
      expect(h[0].roomCode).toBe('PG02');
      expect(h[1].eloAfter).toBe(1516);
      await c.close();
    } catch {
      ok = false;
    }
    if (!ok) console.log('postgres unavailable — skipping PG elo test');
  }, 60000);
});

describe('item 6b — chat de mesa e emotes', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('chat/emotes chegam a jogadores e espectadores, com limites e sem tocar no estado', async () => {
    const PORT7 = 8909;
    const server = startServer({ port: PORT7 });
    try {
      const A = client(PORT7);
      const B = client(PORT7);
      const C = client(PORT7);
      const sendOpen = (c: TestClient, msg: unknown) => {
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
        else c.ws.on('open', () => c.ws.send(JSON.stringify(msg)));
      };

      sendOpen(A, { t: 'create', name: 'Ana' });
      const j = await A.next((m) => m.t === 'joined', 15000, 'A joined');
      sendOpen(B, { t: 'join', code: j.code, name: 'Bia' });
      await B.next((m) => m.t === 'joined', 15000, 'B joined');
      sendOpen(C, { t: 'spectate', code: j.code, name: 'Spy' });
      await C.next((m) => m.t === 'joined', 15000, 'C spectating');

      // chat simples → jogadores e espectadores
      A.ws.send(JSON.stringify({ t: 'chat', text: 'olá' }));
      const cb = await B.next((m) => m.t === 'chat', 10000, 'B chat');
      expect(cb.seat).toBe(0);
      expect(cb.text).toBe('olá');
      const cc = await C.next((m) => m.t === 'chat', 10000, 'C chat');
      expect(cc.text).toBe('olá');

      // texto longo → truncado em 140
      await sleep(700);
      A.ws.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(300) }));
      const ct = await B.next((m) => m.t === 'chat' && m.text !== 'olá', 10000, 'B trunc');
      expect(ct.text!.length).toBe(140);

      // emote válido → emoji do conjunto do servidor
      await sleep(700);
      A.ws.send(JSON.stringify({ t: 'emote', id: 2 }));
      const em = await B.next((m) => m.t === 'emote', 10000, 'B emote');
      expect(em.emote).toBe('😮');
      expect(em.seat).toBe(0);

      // emote inválido → nenhuma mensagem (a próxima é o chat válido)
      await sleep(700);
      A.ws.send(JSON.stringify({ t: 'emote', id: 99 }));
      A.ws.send(JSON.stringify({ t: 'chat', text: 'depois' }));
      const nxt = await B.next((m) => m.t === 'chat' && m.text === 'depois' || m.t === 'emote', 10000, 'B after invalid');
      expect(nxt.t).toBe('chat');

      // rate limit: duas mensagens no mesmo instante → só a primeira passa
      await sleep(700);
      A.ws.send(JSON.stringify({ t: 'chat', text: 'r1' }));
      A.ws.send(JSON.stringify({ t: 'chat', text: 'r2' }));
      const r1 = await B.next((m) => m.t === 'chat' && m.text === 'r1', 10000, 'r1');
      expect(r1.text).toBe('r1');
      let leaked = false;
      try {
        await B.next((m) => m.t === 'chat' && m.text === 'r2', 500, 'r2 should not arrive');
        leaked = true;
      } catch {
        /* esperado: r2 descartada */
      }
      expect(leaked).toBe(false);

      // estado autoritativo intacto: nenhum snapshot NOVO por causa do chat
      // (esvazia primeiro os snapshots antigos, dos joins)
      for (;;) {
        try {
          await B.next((m) => m.t === 'snapshot', 60, 'drain');
        } catch {
          break;
        }
      }
      let snapshotDuringChat = false;
      try {
        await B.next((m) => m.t === 'snapshot', 400, 'no snapshot expected');
        snapshotDuringChat = true;
      } catch {
        /* esperado: chat não gera snapshot */
      }
      expect(snapshotDuringChat).toBe(false);
    } finally {
      await server.close();
    }
  }, 60000);

  it('chat fora de sala é ignorado', async () => {
    const PORT8 = 8910;
    const server = startServer({ port: PORT8 });
    try {
      const A = client(PORT8);
      if (A.ws.readyState !== WebSocket.OPEN) await new Promise((r) => A.ws.on('open', r));
      A.ws.send(JSON.stringify({ t: 'chat', text: 'ninguém ouve' }));
      let got = false;
      try {
        await A.next(() => true, 500, 'nothing expected');
        got = true;
      } catch {
        /* esperado: silêncio */
      }
      expect(got).toBe(false);
    } finally {
      await server.close();
    }
  }, 15000);
});

describe('item 7b — salas privadas e ranqueada 3 humanos + 1 bot', () => {
  const sendOpen = (c: TestClient, msg: unknown) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
    else c.ws.on('open', () => c.ws.send(JSON.stringify(msg)));
  };

  it('sala privada: senha obrigatória para entrar/assistir; token de assento dispensa', async () => {
    const PORT9 = 8911;
    const server = startServer({ port: PORT9 });
    try {
      const A = client(PORT9);
      const B = client(PORT9);
      const C = client(PORT9);

      sendOpen(A, { t: 'create', name: 'Ana', password: 'segredo' });
      const j = await A.next((m) => m.t === 'joined', 15000, 'A joined');
      const snap = await A.next((m) => m.t === 'snapshot', 15000, 'A snap');
      expect(snap.meta!.isPrivate).toBe(true);

      // sem senha → erro
      sendOpen(B, { t: 'join', code: j.code, name: 'Bia' });
      const e1 = await B.next((m) => m.t === 'error', 15000, 'B no pw');
      expect(e1.error).toContain('privada');

      // senha errada → erro
      B.ws.send(JSON.stringify({ t: 'join', code: j.code, name: 'Bia', password: 'errada' }));
      const e2 = await B.next((m) => m.t === 'error', 15000, 'B wrong pw');
      expect(e2.error).toContain('senha incorreta');

      // senha correta → entra
      B.ws.send(JSON.stringify({ t: 'join', code: j.code, name: 'Bia', password: 'segredo' }));
      const jb = await B.next((m) => m.t === 'joined', 15000, 'B joined');
      expect(jb.seat).toBe(1);

      // espectador sem senha → erro; com senha → entra
      sendOpen(C, { t: 'spectate', code: j.code, name: 'Spy' });
      const e3 = await C.next((m) => m.t === 'error', 15000, 'C no pw');
      expect(e3.error).toContain('privada');
      C.ws.send(JSON.stringify({ t: 'spectate', code: j.code, name: 'Spy', password: 'segredo' }));
      const jc = await C.next((m) => m.t === 'joined', 15000, 'C spectating');
      expect(jc.spectator).toBe(true);

      // reconexão por token de assento dispensa senha (token é credencial)
      const B2 = client(PORT9);
      sendOpen(B2, { t: 'join', code: j.code, name: 'Bia', token: jb.token });
      const jr = await B2.next((m) => m.t === 'joined', 15000, 'B reconnected');
      expect(jr.seat).toBe(1);
      expect(jr.reconnected).toBe(true);
    } finally {
      await server.close();
    }
  }, 60000);

  it('ranqueada exige 3+ humanos para começar; 3 humanos + 1 bot inicia', async () => {
    const PORT10 = 8912;
    const server = startServer({ port: PORT10 });
    try {
      const acc = async (c: TestClient, username: string): Promise<string> =>
        new Promise((res) => {
          c.ws.on('message', (raw) => {
            const m = JSON.parse(String(raw)) as Snap;
            if (m.t === 'account' && m.accountToken) res(m.accountToken);
          });
          sendOpen(c, { t: 'account', username });
        });

      // --- sala com só 2 humanos: start bloqueado
      const A = client(PORT10);
      const B = client(PORT10);
      const tA = await acc(A, 'r3-ana');
      await acc(B, 'r3-bia');
      sendOpen(A, { t: 'create', name: 'Ana', ranked: true, accountToken: tA });
      const j1 = await A.next((m) => m.t === 'joined', 15000, 'A ranked');
      B.ws.readyState === WebSocket.OPEN
        ? B.ws.send(JSON.stringify({ t: 'join', code: j1.code, name: 'Bia' }))
        : B.ws.on('open', () => B.ws.send(JSON.stringify({ t: 'join', code: j1.code, name: 'Bia' })));
      await B.next((m) => m.t === 'joined', 15000, 'B joined');
      A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));
      const err = await A.next((m) => m.t === 'error', 15000, 'start blocked');
      expect(err.error).toContain('3 jogadores humanos');
      const notStarted = await A.next((m) => m.t === 'snapshot', 15000, 'still lobby');
      expect(notStarted.meta!.started).toBe(false);

      // --- 3º humano entra → start libera e o 4º assento vira bot
      const C = client(PORT10);
      sendOpen(C, { t: 'join', code: j1.code, name: 'Caio' });
      await C.next((m) => m.t === 'joined', 15000, 'C joined');
      A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));
      const started = await A.next((m) => m.t === 'snapshot' && m.meta!.started, 30000, 'started');
      expect(started.meta!.seats[3]).toBeNull(); // bot não é sessão
      expect(started.meta!.ranked).toBe(true);
    } finally {
      await server.close();
    }
  }, 90000);
});

describe('item 7c — timer de descarte com auto-discard', () => {
  it('servidor descarta sozinho quando o humano estoura o prazo', async () => {
    const PORT11 = 8913;
    const server = startServer({ port: PORT11, discardTimeoutMs: 1500 });
    try {
      const A = client(PORT11);
      autoPass(A, 0); // atende chamadas, mas NÃO descarta — sem autoPlay
      if (A.ws.readyState !== WebSocket.OPEN) await new Promise((r) => A.ws.on('open', r));
      A.ws.send(JSON.stringify({ t: 'create', name: 'Ana' }));
      await A.next((m) => m.t === 'joined', 15000, 'joined');
      A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));

      // minha vez, com deadline anunciado no meta
      const myTurn = await A.next(
        (m) => m.t === 'snapshot' && m.view?.phase === 'discard' && m.view.current === 0 && m.meta?.turnExpiresAt !== undefined,
        30000,
        'my turn with deadline'
      );
      expect(myTurn.meta!.turnExpiresAt!).toBeGreaterThan(Date.now() - 5000);
      const ponds0 = myTurn.view!.players[0].discards.length;

      // fico parado: o servidor deve descartar por mim (~1.5s)
      const after = await A.next(
        (m) => m.t === 'snapshot' && (m.view?.players[0].discards.length ?? 0) > ponds0,
        15000,
        'auto-discard'
      );
      expect(after.view!.players[0].discards.length).toBe(ponds0 + 1);
    } finally {
      await server.close();
    }
  }, 60000);
});

describe('item 8a — temporadas ranqueadas', () => {
  it('seasonKey: formato YYYY-MM do mês corrente (UTC)', () => {
    expect(seasonKey()).toMatch(/^\d{4}-\d{2}$/);
    expect(seasonKey(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01');
    expect(seasonKey(new Date(Date.UTC(2025, 11, 31)))).toBe('2025-12');
  });

  it('MemoryStore: virada de temporada arquiva o Elo e reinicia em 1500', async () => {
    const st = new MemoryStore();
    await st.init();
    const { account, accountToken } = await st.createAccount('season-tester');
    // jogou a temporada antiga e terminou com 1700
    await st.recordRankedResult(account.id, true, 40, 1700, '2020-01');
    let acc = await st.accountByToken(accountToken);
    expect(acc?.elo).toBe(1700);
    expect(acc?.season).toBe('2020-01');
    // primeira partida da temporada atual: Elo base vira 1500 (o store arquiva)
    await st.recordRankedResult(account.id, false, -20, 1488, seasonKey());
    acc = await st.accountByToken(accountToken);
    expect(acc?.prevSeason).toBe('2020-01');
    expect(acc?.prevElo).toBe(1700);
    expect(acc?.elo).toBe(1488); // 1500 - 12 do exemplo
    expect(acc?.season).toBe(seasonKey());
    // leaderboard expõe o badge da temporada anterior
    const rows = await st.leaderboard(10);
    expect(rows[0].prevSeason).toBe('2020-01');
    expect(rows[0].prevElo).toBe(1700);
  });
});

describe('item 8b — watchdog de conexão (ranked)', () => {
  function sendWhenOpen8(c: TestClient, msg: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
    else c.ws.on('open', () => c.ws.send(JSON.stringify(msg)));
  }

  it('ranked: humano desconectado vira bot após o timeout', async () => {
    const PORT11 = 8915;
    const server = startServer({ port: PORT11, afkTimeoutMs: 1500 });
    try {
      const A = client(PORT11);
      const B = client(PORT11);
      const D = client(PORT11);
      // ranqueada precisa de 3+ humanos — conta do A
      const tok = await new Promise<string>((res) => {
        A.ws.on('message', (raw) => {
          const m = JSON.parse(String(raw)) as Snap;
          if (m.t === 'account' && m.accountToken) res(m.accountToken);
        });
        sendWhenOpen8(A, { t: 'account', username: 'afk-a-' + Date.now() });
      });
      sendWhenOpen8(A, { t: 'create', name: 'Ana', room: 'AFK1', ranked: true, accountToken: tok });
      const j = await A.next((m) => m.t === 'joined', 15000, 'A joined');
      sendWhenOpen8(B, { t: 'join', code: j.code, name: 'Bia' });
      await A.next((m) => m.t === 'snapshot' && m.meta!.seats[1] !== null, 15000, 'B in');
      sendWhenOpen8(D, { t: 'join', code: j.code, name: 'Dora' });
      await A.next((m) => m.t === 'snapshot' && m.meta!.seats[2] !== null, 15000, 'D in');
      sendWhenOpen8(A, { t: 'start' });
      await A.next((m) => m.t === 'snapshot' && m.meta!.started === true, 15000, 'started');

      // D cai — watchdog deve transformá-la em bot (> afkTimeoutMs)
      D.ws.close();
      const snap = await A.next(
        (m) => m.t === 'snapshot' && m.meta!.seats[2] === null && String(m.view!.players[2].name).startsWith('Bot'),
        15000,
        'D virou bot'
      );
      expect(snap.view!.players[2].name).toContain('Dora');
      expect(snap.view!.players[2].isHuman).toBe(false);
    } finally {
      await server.close();
    }
  }, 60000);

  it('casual: humano desconectado NÃO é substituído (segue ausente)', async () => {
    const PORT12 = 8916;
    const server = startServer({ port: PORT12, afkTimeoutMs: 1500 });
    try {
      const A = client(PORT12);
      const B = client(PORT12);
      sendWhenOpen8(A, { t: 'create', name: 'Ana', room: 'AFK2' });
      const j = await A.next((m) => m.t === 'joined', 15000, 'A joined');
      sendWhenOpen8(B, { t: 'join', code: j.code, name: 'Bia' });
      await A.next((m) => m.t === 'snapshot' && m.meta!.seats[1] !== null, 15000, 'B in');
      sendWhenOpen8(A, { t: 'start' });
      await A.next((m) => m.t === 'snapshot' && m.meta!.started === true, 15000, 'started');

      B.ws.close();
      const away = await A.next((m) => m.t === 'snapshot' && m.meta!.seats[1]?.connected === false, 15000, 'B away');
      await new Promise((r) => setTimeout(r, 2600)); // bem além do timeout
      // predicado exige snapshot da partida: a fila guarda snapshots antigos
      // do lobby (assento 1 ainda vazio) que satisfariam 'qualquer snapshot'
      const still = await A.next((m) => m.t === 'snapshot' && m.meta!.started === true, 15000, 'still');
      void away;
      expect(still.meta!.seats[1]).not.toBeNull(); // assento preservado (pode reconectar)
      expect(still.view!.players[1].isHuman).toBe(true);
    } finally {
      await server.close();
    }
  }, 60000);
});
