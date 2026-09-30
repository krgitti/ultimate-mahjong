/**
 * AUTHORITATIVE MULTIPLAYER SERVER (demo infrastructure).
 *
 * - The engine state lives ONLY here; clients receive `publicView(seat)` —
 *   hidden hands never cross the wire.
 * - Seats are claimed with random tokens (no accounts by design, v1).
 * - Reconnection: a seat token re-claims the seat; the room survives while
 *   the server process lives. Disconnected seats are auto-played passively
 *   (first legal discard / pass) so hands never stall.
 * - Empty seats can be filled with real engine bots at match start
 *   (bots are a game feature, NOT simulated humans).
 * - Production notes (README): this process is the authoritative core; add
 *   Postgres snapshots + account auth + permanent hosting for a public deploy.
 *
 * Run: npx tsx server/main.ts  (port 8787 by default, PORT env override)
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  newMatch,
  drawTile,
  discard,
  legalDiscards,
  resolveCalls,
  resolveRob,
  canTsumo,
  declareTsumo,
  canRiichi,
  declareRiichi,
  nextHandOrEnd,
  publicView,
  type TradState,
  type CallDecision,
} from '../src/game-engine/traditional/engine';
import { hkRuleset } from '../src/game-engine/rules/ruleset';
import { HK_DEFAULTS, HK_CHICKEN } from '../src/game-engine/rules/hongkong';
import { riichiRuleset } from '../src/game-engine/rules/riichi';
import { mcrRuleset } from '../src/game-engine/rules/mcr';
import { replayMatch, type TradState as _TS } from '../src/game-engine/traditional/engine';
import { MemoryStore, PostgresStore, type RoomRecord, type RoomStore, type RulesConfigId } from './store';
import { chooseDiscard, chooseCall, type BotView } from '../src/game-engine/ai/bot';
import { createRng } from '../src/game-engine/tiles/rng';
import { faceIndex } from '../src/game-engine/tiles/tiles';

export interface ServerOptions {
  port: number;
  rules?: 'classic' | 'chicken' | 'riichi' | 'mcr';
  hands?: number;
  /** postgres connection string; when set, rooms persist and survive restarts */
  databaseUrl?: string;
}

interface Session {
  ws: WebSocket | null;
  token: string;
  name: string;
  connected: boolean;
  lastSeen: number;
  accountId: number | null;
}

interface Room {
  code: string;
  state: TradState;
  seats: (Session | null)[];
  started: boolean;
  hostSeat: number;
  spectators: { ws: WebSocket; name: string }[];
  pendingCall: Map<number, CallDecision | 'pending'>;
  pendingRob: Map<number, boolean>;
  callWaitingSince: number;
  handOverAt: number | null;
  timer: NodeJS.Timeout | null;
  rngTick: number;
  rulesConfig: RulesConfigId;
  saveTimer: NodeJS.Timeout | null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
function token(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function startServer(opts: ServerOptions) {
  const rooms = new Map<string, Room>();
  const store: RoomStore = opts.databaseUrl ? new PostgresStore(opts.databaseUrl) : new MemoryStore();
  let storeReady = false;

  function rulesFor(cfg: RulesConfigId) {
    if (cfg === 'riichi') return riichiRuleset({ handsPerMatch: 4, renchan: true });
    if (cfg === 'mcr') return mcrRuleset();
    return hkRuleset(cfg === 'chicken' ? HK_CHICKEN : HK_DEFAULTS);
  }

  function rebuildRoom(rec: RoomRecord): Room | null {
    if (rooms.has(rec.code)) return rooms.get(rec.code)!;
    const state = replayMatch(rulesFor(rec.rulesConfig), { seed: rec.seed, actions: rec.actions });
    if (state.phase === 'match-over') {
      void store.deleteRoom(rec.code).catch(() => {});
      return null;
    }
    rec.seats.forEach((sr, i) => {
      if (sr) state.players[i].name = sr.name;
    });
    const room: Room = {
      code: rec.code,
      state,
      seats: rec.seats.map((sr) =>
        sr ? { ws: null, token: sr.token, name: sr.name, connected: false, lastSeen: 0, accountId: sr.accountId } : null
      ),
      spectators: [],
      started: rec.started,
      hostSeat: rec.hostSeat,
      pendingCall: new Map(),
      pendingRob: new Map(),
      callWaitingSince: Date.now(),
      handOverAt: null,
      timer: null,
      rngTick: rec.rngTick,
      rulesConfig: rec.rulesConfig,
      saveTimer: null,
    };
    rooms.set(rec.code, room);
    return room;
  }

  const ready = (async () => {
    try {
      await store.init();
      for (const rec of await store.loadAllRooms()) {
        try {
          rebuildRoom(rec);
        } catch (e) {
          console.error('room rebuild failed', rec.code, e);
        }
      }
      storeReady = true;
    } catch (e) {
      console.error('store init failed — rooms will live in memory only', e);
    }
  })();

  function serializeRoom(room: Room): RoomRecord {
    return {
      code: room.code,
      rulesConfig: room.rulesConfig,
      seed: room.state.replay.seed,
      actions: room.state.replay.actions,
      seats: room.seats.map((s2) => (s2 ? { name: s2.name, token: s2.token, accountId: s2.accountId } : null)),
      hostSeat: room.hostSeat,
      started: room.started,
      rngTick: room.rngTick,
      updatedAt: Date.now(),
    };
  }

  /** debounce saves: room states are compact (seed + action log) */
  function scheduleSave(room: Room) {
    if (room.saveTimer) return;
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      store.saveRoom(serializeRoom(room)).catch((e) => console.error('save failed', room.code, e));
    }, 400);
  }

  async function findRoom(codeRaw: string): Promise<Room | null> {
    const code = String(codeRaw || '').toUpperCase();
    const mem = rooms.get(code);
    if (mem) return mem;
    if (!storeReady) return null;
    const rec = await store.loadRoom(code);
    return rec ? rebuildRoom(rec) : null;
  }

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: http });

  function send(ws: WebSocket, msg: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcast(room: Room) {
    const s = room.state;
    for (let seat = 0; seat < 4; seat++) {
      const sess = room.seats[seat];
      if (sess?.ws && sess.connected) {
        send(sess.ws, {
          t: 'snapshot',
          seat,
          view: publicView(s, seat),
          myActions: {
            legal: legalDiscards(s, seat),
            canTsumo: canTsumo(s, seat),
            canRiichi: canRiichi(s, seat),
          },
          meta: {
            code: room.code,
            started: room.started,
            seats: room.seats.map((s2, i) => (s2 ? { seat: i, name: s2.name, connected: s2.connected, human: true } : null)),
            canStart: seat === room.hostSeat,
            spectators: room.spectators.length,
          },
        });
      }
      for (const spec of room.spectators) {
        send(spec.ws, {
          t: 'snapshot',
          seat: -1,
          spectator: true,
          view: publicView(s, -1),
          meta: {
            code: room.code,
            started: room.started,
            seats: room.seats.map((s2, i) => (s2 ? { seat: i, name: s2.name, connected: s2.connected, human: true } : null)),
            canStart: false,
            spectators: room.spectators.length,
          },
        });
      }
    }
    scheduleSave(room);
  }

  function botViewOf(room: Room, seat: number): BotView {
    const s = room.state;
    return {
      seat,
      seatWind: (((seat - s.dealer) % 4) + 4) % 4 + 1,
      roundWind: s.roundWind,
      hand: s.players[seat].hand.map((id) => s.tiles[id].face),
      melds: s.players[seat].melds.map((m) => ({ kind: m.kind, faces: m.tiles.map((t) => s.tiles[t].face) })),
      bonusFaces: s.players[seat].bonus.map((id) => s.tiles[id].face),
      visibleDiscards: s.players.flatMap((p) => p.discards.map((id) => s.tiles[id].face)),
      otherMeldFaces: s.players
        .filter((p) => p.seat !== seat)
        .flatMap((p) => p.melds.filter((m) => m.kind !== 'ankan').flatMap((m) => m.tiles.map((t) => s.tiles[t].face))),
      wallCount: s.wall.length,
      turnNumber: room.rngTick,
      opponents: s.players
        .filter((p) => p.seat !== seat)
        .map((p) => ({
          seat: p.seat,
          discards: p.discards.map((id) => faceIndex(s.tiles[id].face)),
          meldCount: p.melds.filter((m) => m.kind !== 'ankan').length,
          riichi: p.riichi,
        })),
    };
  }

  const isBotSeat = (room: Room, seat: number) => room.started && !room.seats[seat];
  const isAway = (room: Room, seat: number) => !!room.seats[seat] && !room.seats[seat]!.connected;

  function pump(room: Room) {
    const s = room.state;
    if (s.phase === 'hand-over') {
      if (room.handOverAt === null) room.handOverAt = Date.now();
      if (Date.now() - room.handOverAt > 6000) {
        room.handOverAt = null;
        nextHandOrEnd(s);
        broadcast(room);
      }
      return;
    }
    if (s.phase === 'match-over') return;

    if (s.phase === 'draw') {
      // server draws for everyone (humans included) after a short beat
      drawTile(s);
      broadcast(room);
      return;
    }

    if (s.phase === 'discard') {
      const seat = s.current;
      if (isBotSeat(room, seat) || isAway(room, seat)) {
        if (canTsumo(s, seat)) {
          declareTsumo(s, seat);
          broadcast(room);
          return;
        }
        if (isBotSeat(room, seat) && canRiichi(s, seat)) declareRiichi(s, seat);
        const view = botViewOf(room, seat);
        const i = isBotSeat(room, seat)
          ? chooseDiscard(view, 'hard', createRng((room.rngTick++ * 40503 + seat) >>> 0))
          : 0;
        const tileId = isBotSeat(room, seat)
          ? s.players[seat].hand[i] ?? s.players[seat].hand[0]
          : legalDiscards(s, seat)[0];
        discard(s, tileId);
        room.pendingCall.clear();
        room.pendingRob.clear();
        room.callWaitingSince = Date.now();
        broadcast(room);
      }
      return; // human online: wait for their action
    }

    if (s.phase === 'calls') {
      const humansPending = room.state.offers.some(
        (o) => room.seats[o.seat] && room.seats[o.seat]!.connected && !room.pendingCall.has(o.seat)
      );
      if (humansPending) {
        if (Date.now() - room.callWaitingSince > 30000) {
          for (const o of room.state.offers) if (!room.pendingCall.has(o.seat)) room.pendingCall.set(o.seat, { offer: null });
        } else return;
      }
      const res = resolveCalls(s, (seat, offers) => {
        if (room.seats[seat] && !isAway(room, seat)) {
          const d = room.pendingCall.get(seat);
          if (d === undefined || d === 'pending') return 'pending';
          room.pendingCall.delete(seat);
          return d;
        }
        if (isBotSeat(room, seat)) {
          const chi = offers.find((o) => o.kind === 'chi');
          const r = chooseCall(
            botViewOf(room, seat),
            {
              canRon: offers.some((o) => o.kind === 'ron'),
              canPon: offers.some((o) => o.kind === 'pon'),
              canKan: offers.some((o) => o.kind === 'kan'),
              chiOptions: chi?.chiOptions
                ? chi.chiOptions.map((pair) => pair.map((id) => s.tiles[id].face) as [typeof s.tiles[number]['face'], typeof s.tiles[number]['face']])
                : null,
              discardFace: s.lastDiscard
                ? s.tiles[s.lastDiscard.tileId].face
                : s.tiles[s.players[seat].hand[0] ?? 0].face,
            },
            'hard',
            createRng((room.rngTick++ * 7919 + seat) >>> 0)
          );
          if (r.call === 'ron') return { offer: offers.find((o) => o.kind === 'ron')! };
          if (r.call === 'pon') return { offer: offers.find((o) => o.kind === 'pon')! };
          if (r.call === 'kan') return { offer: offers.find((o) => o.kind === 'kan')! };
          if (r.call === 'chi' && chi) return { offer: chi, chiChoice: chi.chiOptions![r.chiChoice ?? 0] };
          return { offer: null };
        }
        return { offer: null }; // away human: pass
      });
      if (res === 'resolved') {
        room.callWaitingSince = Date.now();
        broadcast(room);
      }
      return;
    }

    if (s.phase === 'calls-rob') {
      const res = resolveRob(s, (seat) => {
        if (room.seats[seat] && !isAway(room, seat)) {
          const d = room.pendingRob.get(seat);
          if (d === undefined) return 'pending';
          room.pendingRob.delete(seat);
          return d;
        }
        return false;
      });
      if (res === 'resolved') broadcast(room);
      return;
    }
  }

  function tickAll() {
    for (const room of rooms.values()) {
      try {
        pump(room);
      } catch (e) {
        console.error('pump error', room.code, e);
      }
    }
  }
  const ticker = setInterval(tickAll, 400);

  wss.on('connection', (ws) => {
    let myRoom: Room | null = null;
    let mySeat = -1;
    let spectating = false;

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const t = msg.t as string;

      if (t === 'create') {
        const code = roomCode();
        const rulesConfig: RulesConfigId =
          msg.rules === 'riichi' || msg.rules === 'chicken' || msg.rules === 'mcr' ? msg.rules : 'classic';
        const rules = rulesFor(rulesConfig);
        const state = newMatch(rules, (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, [
          String(msg.name || 'Jogador 1'),
          '— vazio —',
          '— vazio —',
          '— vazio —',
        ]);
        const room: Room = {
          code,
          state,
          seats: [null, null, null, null],
          spectators: [],
          started: false,
          hostSeat: 0,
          pendingCall: new Map(),
          pendingRob: new Map(),
          callWaitingSince: Date.now(),
          handOverAt: null,
          timer: null,
          rngTick: 1,
          rulesConfig,
          saveTimer: null,
        };
        const sess: Session = { ws, token: token(), name: String(msg.name || 'Jogador 1'), connected: true, lastSeen: Date.now(), accountId: null };
        room.seats[0] = sess;
        state.players[0].name = sess.name;
        rooms.set(code, room);
        myRoom = room;
        mySeat = 0;
        if (typeof msg.accountToken === 'string') {
          const acc = await store.accountByToken(msg.accountToken);
          if (acc) {
            sess.accountId = acc.id;
            void store.linkSeat(code, 0, acc.id).catch(() => {});
          }
        }
        send(ws, { t: 'joined', code, token: sess.token, seat: 0 });
        broadcast(room);
        return;
      }

      if (t === 'account') {
        // optional accounts: username -> token (the token is the credential;
        // the server stores only its hash). Enables cross-device rejoin.
        const username = String(msg.username || '').trim().slice(0, 32);
        if (!username) {
          send(ws, { t: 'error', error: 'Nome de conta inválido.' });
          return;
        }
        const { account, accountToken } = await store.createAccount(username);
        send(ws, { t: 'account', username: account.username, accountToken });
        return;
      }

      if (t === 'spectate') {
        // spectators: read-only seats (seat -1). They receive the same public
        // snapshots as players, minus any private hand, and cannot act.
        const room = await findRoom(String(msg.code || ''));
        if (!room) {
          send(ws, { t: 'error', error: 'Sala não encontrada.' });
          return;
        }
        room.spectators.push({ ws, name: String(msg.name || 'Espectador') });
        myRoom = room;
        spectating = true;
        send(ws, { t: 'joined', code: room.code, seat: -1, spectator: true, token: null });
        broadcast(room);
        return;
      }

      if (t === 'join') {
        const at = typeof msg.accountToken === 'string' ? msg.accountToken : undefined;
        // account-based cross-device rejoin: no code needed
        if (at && !msg.code) {
          const acc = await store.accountByToken(at);
          if (acc) {
            for (const code of await store.roomsOfAccount(acc.id)) {
              const room = await findRoom(code);
              if (!room) continue;
              const seat = room.seats.findIndex((s2) => s2?.accountId === acc.id);
              if (seat >= 0) {
                const sess = room.seats[seat]!;
                sess.ws = ws;
                sess.connected = true;
                sess.lastSeen = Date.now();
                myRoom = room;
                mySeat = seat;
                send(ws, { t: 'joined', code: room.code, token: sess.token, seat, reconnected: true });
                broadcast(room);
                return;
              }
            }
          }
          send(ws, { t: 'error', error: 'Nenhuma sala ativa para esta conta.' });
          return;
        }
        const room = await findRoom(String(msg.code || ''));
        const tok = msg.token as string | undefined;
        if (!room) {
          send(ws, { t: 'error', error: 'Sala não encontrada.' });
          return;
        }
        // reconnection by token?
        if (tok) {
          const seat = room.seats.findIndex((s2) => s2?.token === tok);
          if (seat >= 0) {
            const sess = room.seats[seat]!;
            sess.ws = ws;
            sess.connected = true;
            sess.lastSeen = Date.now();
            myRoom = room;
            mySeat = seat;
            send(ws, { t: 'joined', code: room.code, token: tok, seat, reconnected: true });
            broadcast(room);
            return;
          }
        }
        const seat = room.seats.findIndex((s2) => s2 === null);
        if (seat === -1 || room.started) {
          send(ws, { t: 'error', error: room.started ? 'Partida em andamento.' : 'Sala cheia.' });
          return;
        }
        const sess: Session = { ws, token: token(), name: String(msg.name || `Jogador ${seat + 1}`), connected: true, lastSeen: Date.now(), accountId: null };
        room.seats[seat] = sess;
        room.state.players[seat].name = sess.name;
        myRoom = room;
        mySeat = seat;
        if (at) {
          const acc = await store.accountByToken(at);
          if (acc) {
            sess.accountId = acc.id;
            void store.linkSeat(room.code, seat, acc.id).catch(() => {});
          }
        }
        send(ws, { t: 'joined', code: room.code, token: sess.token, seat });
        broadcast(room);
        return;
      }

      if (!myRoom) return;
      if (spectating || mySeat < 0) {
        if (t === 'action' || t === 'start') send(ws, { t: 'error', error: 'Espectadores não podem jogar.' });
        return;
      }
      const room = myRoom;
      const s = room.state;

      if (t === 'start') {
        if (mySeat !== room.hostSeat || room.started) return;
        const fillBots = msg.fillBots !== false;
        room.started = true;
        for (let i = 0; i < 4; i++) {
          if (!room.seats[i]) {
            s.players[i].name = fillBots ? `Bot ${['Sul', 'Oeste', 'Norte'][i - 1] ?? i}` : `Vazio ${i}`;
            s.players[i].isHuman = false;
          } else {
            s.players[i].isHuman = true;
          }
        }
        broadcast(room);
        return;
      }

      if (t === 'action') {
        const a = msg.action as { kind: string; tileId?: number; call?: string; chiChoice?: number[]; yes?: boolean };
        if (s.current === mySeat && s.phase === 'discard') {
          if (a.kind === 'discard' && typeof a.tileId === 'number') {
            if (discard(s, a.tileId)) {
              room.callWaitingSince = Date.now();
              broadcast(room);
            } else send(ws, { t: 'error', error: 'Descarte ilegal.' });
          } else if (a.kind === 'tsumo') {
            if (declareTsumo(s, mySeat)) broadcast(room);
          } else if (a.kind === 'riichi') {
            if (declareRiichi(s, mySeat)) broadcast(room);
          }
        }
        if (s.phase === 'calls') {
          const offer = s.offers.find((o) => o.seat === mySeat && (a.call === 'pass' ? true : o.kind === a.call));
          if (a.call === 'pass') {
            room.pendingCall.set(mySeat, { offer: null });
          } else if (offer) {
            room.pendingCall.set(mySeat, { offer, chiChoice: a.chiChoice ?? undefined } as CallDecision);
          }
          room.callWaitingSince = Date.now();
          return;
        }
        if (s.phase === 'calls-rob' && typeof a.yes === 'boolean') {
          room.pendingRob.set(mySeat, a.yes);
          return;
        }
      }
    });

    ws.on('close', () => {
      if (myRoom && !spectating && mySeat >= 0) scheduleSave(myRoom);
      if (myRoom && spectating) {
        myRoom.spectators = myRoom.spectators.filter((sp) => sp.ws !== ws);
        broadcast(myRoom);
        return;
      }
      if (myRoom && mySeat >= 0) {
        const sess = myRoom.seats[mySeat];
        if (sess) {
          sess.connected = false;
          sess.ws = null;
          broadcast(myRoom);
        }
      }
    });
  });

  http.listen(opts.port, '0.0.0.0');
  return {
    port: opts.port,
    /** resolves when the store finished loading persisted rooms */
    ready,
    close: () => {
      clearInterval(ticker);
      for (const room of rooms.values()) if (room.saveTimer) clearTimeout(room.saveTimer);
      wss.close();
      http.close();
      rooms.clear();
      void store.close().catch(() => {});
    },
  };
}

if (process.argv[1]?.endsWith('main.ts')) {
  const port = Number(process.env.PORT || 8787);
  // optional Postgres persistence: UMO_DATABASE_URL=postgres://user:pass@host/db
  const databaseUrl = process.env.UMO_DATABASE_URL;
  const srv = startServer({ port, databaseUrl });
  void srv.ready.then(() => {
    console.log(
      `[server] authoritative mahjong server on :${port} — ` +
        (databaseUrl ? 'salas persistentes (Postgres)' : 'salas em memória (sem UMO_DATABASE_URL)')
    );
  });
}
