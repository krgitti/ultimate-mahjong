import WebSocket from 'ws';
import { startServer } from '../server/main';
const PORT = 8901;
const server = startServer({ port: PORT });
const log = (...a: unknown[]) => console.log('[dbg]', ...a);
function client(tag: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'snapshot') log(tag, 'snapshot phase', m.view?.phase, 'current', m.view?.current, 'legal', m.myActions?.legal?.length, 'started', m.meta?.started, 'ponds', m.view?.players?.map((p: {discards: unknown[]}) => p.discards.length));
    else log(tag, m.t, m.code ?? '', 'seat', m.seat ?? '');
  });
  return ws;
}
const A = client('A');
A.on('open', () => A.send(JSON.stringify({ t: 'create', name: 'Ana' })));
setTimeout(() => {
  const B = client('B');
  B.on('open', () => B.send(JSON.stringify({ t: 'join', code: CODE, name: 'Beto' })));
  (globalThis as Record<string, unknown>).B = B;
}, 500);
let CODE = '';
A.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'joined') CODE = m.code; });
setTimeout(() => { A.send(JSON.stringify({ t: 'start', fillBots: true })); log('A', 'sent start'); }, 1500);
setTimeout(() => { log('A', 'sending discard? wait for legal via next snapshot...'); }, 4000);
setTimeout(() => process.exit(0), 9000);
