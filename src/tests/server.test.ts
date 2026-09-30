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
    players: { name: string; discards: unknown[]; handCount: number }[];
    myHand?: { tiles: { id: number }[] };
    events: { t: string }[];
    offers: { seat: number; kind: string }[];
  };
  myActions?: { legal: number[] };
  meta?: { code: string; started: boolean; seats: ({ name: string; connected: boolean } | null)[] };
  code?: string;
  token?: string;
  reconnected?: boolean;
  error?: string;
}

function client(): { ws: WebSocket; next: (pred?: (m: Snap) => boolean, timeout?: number) => Promise<Snap> } {
  const queue: Snap[] = [];
  const waiters: { pred: (m: Snap) => boolean; res: (m: Snap) => void; rej: (e: Error) => void }[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Snap;
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) {
      const [w] = waiters.splice(i, 1);
      w.res(m);
    } else queue.push(m);
  });
  const next = (pred: (m: Snap) => boolean = () => true, timeout = 15000) =>
    new Promise<Snap>((res, rej) => {
      const qi = queue.findIndex(pred);
      if (qi >= 0) {
        res(queue.splice(qi, 1)[0]);
        return;
      }
      const to = setTimeout(() => rej(new Error('timeout waiting for message')), timeout);
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

describe('item 4 — authoritative server + reconnection', () => {
  it('two real clients play a hand; hidden hands never leak; reconnect restores the seat', async () => {
    const server = startServer({ port: PORT });

    const A = client();
    A.ws.on('open', () => A.ws.send(JSON.stringify({ t: 'create', name: 'Ana' })));
    const joinedA = await A.next((m) => m.t === 'joined');
    expect(joinedA.code).toMatch(/^[A-Z2-9]{4}$/);
    const code = joinedA.code!;
    const tokenA = joinedA.token!;

    const B = client();
    B.ws.on('open', () => B.ws.send(JSON.stringify({ t: 'join', code, name: 'Beto' })));
    const joinedB = await B.next((m) => m.t === 'joined');
    expect(joinedB.seat).toBe(1);

    // lobby snapshots arrive for both
    const lobbyA = await A.next((m) => m.t === 'snapshot' && m.meta!.seats[1] !== null);
    expect(lobbyA.meta!.started).toBe(false);
    expect(lobbyA.meta!.seats[1]!.name).toBeTruthy();

    // host starts with bots filling seats 2/3
    A.ws.send(JSON.stringify({ t: 'start', fillBots: true }));
    const startedSnap = await A.next((m) => m.t === 'snapshot' && m.meta!.started);
    expect(startedSnap.meta!.seats[2]).toBeNull(); // bots are not sessions

    // A is dealer: server expects a discard from seat 0
    const myTurn = await A.next((m) => m.t === 'snapshot' && m.view!.phase === 'discard' && m.view!.current === 0);
    expect(myTurn.myActions!.legal.length).toBeGreaterThan(0);

    // hidden info check: B's snapshot must NOT contain A's hand faces
    const bSnap = await B.next((m) => m.t === 'snapshot' && !!m.view);
    const bJson = JSON.stringify(bSnap.view!.players[0]);
    expect(bJson).not.toContain('"myHand"'); // other seats have no hand payload
    // and A's own snapshot DOES contain own hand
    expect(JSON.stringify(myTurn.view)).toContain('myHand');

    const tileId = myTurn.myActions!.legal[0];
    A.ws.send(JSON.stringify({ t: 'action', action: { kind: 'discard', tileId } }));

    // both clients see the discard land in seat 0's pond
    const seenByB = await B.next((m) => m.t === 'snapshot' && m.view!.players[0].discards.length === 1);
    expect(seenByB.view!.players[0].discards.length).toBe(1);
    const seenByA = await A.next((m) => m.t === 'snapshot' && m.view!.players[0].discards.length === 1);
    expect(seenByA.view!.players[0].discards.length).toBe(1);

    // B is a connected human: the server must WAIT for B (authoritative turn control)
    const bTurn = await B.next((m) => m.t === 'snapshot' && m.view!.phase === 'discard' && m.view!.current === 1 && m.myActions!.legal.length > 0, 15000);
    B.ws.send(JSON.stringify({ t: 'action', action: { kind: 'discard', tileId: bTurn.myActions!.legal[0] } }));

    // game keeps flowing with bots (events grow)
    await A.next((m) => m.t === 'snapshot' && m.view!.events.length >= 6, 20000);

    // B disconnects and reconnects with the token
    const tokenB = joinedB.token!;
    B.ws.close();
    const awaySnap = await A.next((m) => m.t === 'snapshot' && m.meta!.seats[1]?.connected === false, 10000);
    expect(awaySnap.meta!.seats[1]!.connected).toBe(false);

    const B2 = client();
    B2.ws.on('open', () => B2.ws.send(JSON.stringify({ t: 'join', code, name: 'B', token: tokenB })));
    const re = await B2.next((m) => m.t === 'joined' && !!m.reconnected);
    expect(re.seat).toBe(1);
    const backSnap = await B2.next((m) => m.t === 'snapshot');
    expect(backSnap.seat).toBe(1);
    expect(backSnap.view!.players[1].handCount).toBeGreaterThan(0);
    void tokenA;

    A.ws.close();
    B2.ws.close();
    server.close();
  }, 60000);
});
