import { useEffect, useRef, useState } from 'react';
import type { PublicState } from '../../game-engine/traditional/engine';
import { TileFaceArt, TileBack } from '../../components/TileFace';
import { faceName, type TileFace } from '../../game-engine/tiles/tiles';
import { sfx } from '../../components/sound';

/** Derive the WS URL for both local dev and the Arena preview proxy. */
export function onlineWsUrl(defaultPort = 8787): string {
  const port = Number(localStorage.getItem('umo.online.port') || defaultPort);
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `ws://${hostname}:${port}`;
  const m = hostname.match(/^\d+-(.+)$/);
  if (m) return `${protocol === 'https:' ? 'wss' : 'ws'}://${port}-${m[1]}`;
  return `ws://${hostname}:${port}`;
}

interface Meta {
  code: string;
  started: boolean;
  seats: ({ seat: number; name: string; connected: boolean; human: boolean } | null)[];
  canStart: boolean;
}
interface MyActions {
  legal: number[];
  canTsumo: boolean;
  canRiichi: boolean;
}

function Mini({ face }: { face?: TileFace }) {
  return (
    <span className={`mini-tile${face ? '' : ' back'}`}>
      {face ? <TileFaceArt face={face} /> : <TileBack />}
    </span>
  );
}

const WIND_PT = ['', 'Leste', 'Sul', 'Oeste', 'Norte'];

export function OnlineScreen() {
  const [phase, setPhase] = useState<'form' | 'lobby' | 'table'>('form');
  const [name, setName] = useState(() => sessionStorage.getItem('umo.online.name') || '');
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('umo.online.token'));
  const [accountToken, setAccountToken] = useState<string | null>(() => sessionStorage.getItem('umo.online.accountToken'));
  const [accountName, setAccountName] = useState(() => sessionStorage.getItem('umo.online.accountName') || '');
  const [accountUser, setAccountUser] = useState('');
  const [view, setView] = useState<PublicState | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [actions, setActions] = useState<MyActions>({ legal: [], canTsumo: false, canRiichi: false });
  const [mySeat, setMySeat] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = (firstMsg?: Record<string, unknown>) => {
    const ws = new WebSocket(onlineWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      setError(null);
      if (firstMsg) ws.send(JSON.stringify(firstMsg));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'account') {
        const at = String(msg.accountToken || '');
        sessionStorage.setItem('umo.online.accountToken', at);
        sessionStorage.setItem('umo.online.accountName', String(msg.username || ''));
        setAccountToken(at);
        setAccountName(String(msg.username || ''));
        setError(null);
        return;
      }
      if (msg.t === 'joined') {
        setCode(msg.code);
        setToken(msg.token);
        setMySeat(msg.seat);
        sessionStorage.setItem('umo.online.token', msg.token);
        sessionStorage.setItem('umo.online.code', msg.code);
        sessionStorage.setItem('umo.online.name', name);
        setPhase('lobby');
      } else if (msg.t === 'snapshot') {
        setView(msg.view);
        setMeta(msg.meta);
        setActions(msg.myActions ?? { legal: [], canTsumo: false, canRiichi: false });
        setPhase(msg.meta.started ? 'table' : 'lobby');
        setCode(msg.meta.code);
      } else if (msg.t === 'error') {
        setError(msg.error);
      }
    };
    ws.onclose = () => setError('Conexão fechada — recarregue para reconectar.');
  };

  // auto-reconnect on load when a token exists
  useEffect(() => {
    const savedCode = sessionStorage.getItem('umo.online.code');
    if (token && savedCode) connect({ t: 'join', code: savedCode, name: name || 'Jogador', token });
    return () => wsRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (o: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(o));
  };

  const doDiscard = (id: number) => {
    if (!actions.legal.includes(id)) return;
    send({ t: 'action', action: { kind: 'discard', tileId: id } });
    setSelected(null);
    sfx.click();
  };

  /* ------------------------------- render ------------------------------- */

  if (phase === 'form') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 className="page-title">Jogar online (multiplayer real)</h1>
        <p className="page-sub">
          Servidor autoritativo local: as mãos ocultas nunca saem do servidor; cada assento tem um token de
          reconexão. Crie uma sala e compartilhe o código, ou entre com um código. Assentos vazios podem ser
          preenchidos por bots na hora de começar.
        </p>
        <label className="field">
          Seu nome
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jogador" />
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => connect({ t: 'create', name: name || 'Jogador', accountToken: accountToken ?? undefined })}>
            ✚ Criar sala
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Código da sala (ex.: A7K2)"
            style={{ width: 180 }}
            maxLength={4}
          />
          <button className="btn" onClick={() => connect({ t: 'join', code: joinCode, name: name || 'Jogador', accountToken: accountToken ?? undefined })}>Entrar na sala</button>
          <button className="btn" onClick={() => connect({ t: 'spectate', code: joinCode, name: name || 'Espectador' })}>👁 Assistir</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            value={accountUser}
            onChange={(e) => setAccountUser(e.target.value)}
            placeholder="Conta (opcional)"
            style={{ width: 180 }}
            maxLength={32}
          />
          <button className="btn" onClick={() => connect({ t: 'account', username: accountUser })}>Criar conta</button>
          {accountToken && (
            <button className="btn" onClick={() => connect({ t: 'join', accountToken })}>↻ Retomar minha sala</button>
          )}
        </div>
        {accountToken && (
          <p className="muted small" style={{ marginTop: 6 }}>
            Conta <b>{accountName}</b> ativa — suas salas podem ser retomadas em outro dispositivo.
          </p>
        )}
        {error && <p style={{ color: '#ffd9d7', marginTop: 10 }}>{error}</p>}
        <p className="muted small" style={{ marginTop: 14 }}>
          Requer o servidor rodando: <code>npm run server</code> (porta 8787). Sem contas, sem banco remoto —
          o estado vive no processo do servidor enquanto ele estiver ativo.
        </p>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 className="page-title">Sala {code}</h1>
        <p className="page-sub">Compartilhe o código <b>{code}</b>. Seu token de reconexão fica salvo nesta aba.</p>
        <div className="panel">
          {meta?.seats.map((s2, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <span style={{ width: 90 }} className="muted small">{WIND_PT[i]}</span>
              <span style={{ flex: 1 }}>
                {s2 ? `${s2.name} ${s2.connected ? '🟢' : '💤'}` : '— vazio —'}
              </span>
            </div>
          ))}
        </div>
        {meta?.canStart && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" onClick={() => send({ t: 'start', fillBots: true })}>
              ▶ Começar (bots nos assentos vazios)
            </button>
          </div>
        )}
        {error && <p style={{ color: '#ffd9d7' }}>{error}</p>}
      </div>
    );
  }

  const v = view;
  if (!v) return null;
  const myHand = v.myHand?.seat === mySeat ? v.myHand.tiles : [];
  const myOffers = v.offers.filter((o) => o.seat === mySeat);
  const humanTurn = v.phase === 'discard' && v.current === mySeat;

  return (
    <div>
      <div className="row-between" style={{ marginBottom: '0.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.2rem' }}>
          Sala {meta?.code} — mão {v.handNumber} · vento {WIND_PT[v.roundWind]}
        </h1>
        <span className="muted small">Muro {v.wallCount}</span>
      </div>
      <div className="trad-layout">
        <div className="side-top">
          {v.players[2] && (
            <div className="seat-panel">
              <div className="seat-name">{v.players[2].name} <span className="seat-wind">{WIND_PT[((2 - v.dealer) % 4 + 4) % 4 + 1]}</span>{v.players[2].riichi && ' 🀄'}</div>
              <div className="row small"><span>Mão: {v.players[2].handCount}</span><span>Pontos: <b>{v.players[2].score}</b></span></div>
              <div className="meld-row">{Array.from({ length: Math.min(v.players[2].handCount, 14) }).map((_, i) => <Mini key={i} />)}</div>
            </div>
          )}
        </div>
        <div className="side-left">
          {v.players[3] && (
            <div className="seat-panel">
              <div className="seat-name">{v.players[3].name}{v.players[3].riichi && ' 🀄'}</div>
              <div className="row small"><span>Mão: {v.players[3].handCount}</span><span>Pontos: <b>{v.players[3].score}</b></span></div>
              <div className="meld-row">{Array.from({ length: Math.min(v.players[3].handCount, 14) }).map((_, i) => <Mini key={i} />)}</div>
            </div>
          )}
        </div>
        <div className="center-area">
          <div className="ponds-grid">
            {[2, 3, 1, 0].map((seat) => (
              <div className="pond-box" key={seat}>
                <div className="pond-label">{v.players[seat]?.name}</div>
                <div className="pond">
                  {(v.players[seat]?.discards ?? []).map((f, i) => <Mini key={i} face={f} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="side-right">
          {v.players[1] && (
            <div className="seat-panel">
              <div className="seat-name">{v.players[1].name}{v.players[1].riichi && ' 🀄'}</div>
              <div className="row small"><span>Mão: {v.players[1].handCount}</span><span>Pontos: <b>{v.players[1].score}</b></span></div>
              <div className="meld-row">{Array.from({ length: Math.min(v.players[1].handCount, 14) }).map((_, i) => <Mini key={i} />)}</div>
            </div>
          )}
        </div>
        {mySeat >= 0 ? (
        <div className="my-area">
          <div className="seat-panel active-seat">
            <div className="seat-name">{v.players[mySeat]?.name} (você)</div>
            <div className="row small"><span>Pontos: <b>{v.players[mySeat]?.score}</b></span></div>
          </div>
          <div className="hand-row" role="list" aria-label="Sua mão">
            {[...myHand].sort((a, b) => a.id - b.id).map(({ id, face }) => (
              <button
                key={id}
                role="listitem"
                className={`hand-tile${selected === id ? ' selected' : ''}`}
                aria-label={faceName(face)}
                disabled={!humanTurn || !actions.legal.includes(id)}
                onClick={() => (selected === id ? doDiscard(id) : setSelected(id))}
              >
                <span className="tile-face-inner"><TileFaceArt face={face} /></span>
              </button>
            ))}
          </div>
          <div className="action-bar">
            {humanTurn && actions.canTsumo && (
              <button className="btn btn-primary btn-sm" onClick={() => send({ t: 'action', action: { kind: 'tsumo' } })}>🏆 TSUMO!</button>
            )}
            {humanTurn && actions.canRiichi && (
              <button className="btn btn-primary btn-sm" onClick={() => send({ t: 'action', action: { kind: 'riichi' } })}>🀄 Riichi</button>
            )}
            {myOffers.map((o, i) => (
              <button
                key={i}
                className={`btn btn-sm${o.kind === 'ron' ? ' btn-primary' : ''}`}
                onClick={() =>
                  o.kind === 'chi'
                    ? send({ t: 'action', action: { call: 'chi', chiChoice: o.chiOptions?.[0] } })
                    : send({ t: 'action', action: { call: o.kind } })
                }
              >
                {o.kind === 'ron' ? '🏆 RON!' : o.kind === 'pon' ? 'Pon' : o.kind === 'kan' ? 'Kong' : 'Chow'}
              </button>
            ))}
            {myOffers.length > 0 && (
              <button className="btn btn-sm" onClick={() => send({ t: 'action', action: { call: 'pass' } })}>Passar</button>
            )}
            {v.phase === 'calls-rob' && v.offers.some((o) => o.seat === mySeat) && (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => send({ t: 'action', action: { yes: true } })}>🏆 Roubar Kong!</button>
                <button className="btn btn-sm" onClick={() => send({ t: 'action', action: { yes: false } })}>Passar</button>
              </>
            )}
          </div>
        </div>
        ) : (
        <div className="my-area">
          <div className="seat-panel active-seat">
            <div className="seat-name">👁 Modo espectador — sala {meta?.code}</div>
            <div className="row small"><span>Apenas assistindo — as mãos dos jogadores não são exibidas.</span></div>
          </div>
        </div>
        )}
      </div>

      {v.result && (
        <div className="panel" style={{ marginTop: 10, borderColor: 'var(--gold)' }}>
          {v.result.kind === 'win' ? (
            <>
              <b>{v.players[v.result.winner!]?.name}</b> venceu ({v.result.selfDrawn ? 'TSUMO' : 'RON'}) —{' '}
              {v.result.scoring?.totalFan} {v.result.scoring?.items.some((i) => i.name.includes('han')) ? 'han' : 'fan'},{' '}
              {v.result.scoring?.points} pontos
              <ul className="muted small">
                {v.result.scoring?.items.map((i2, k) => (
                  <li key={k}>{i2.name} +{i2.fan}</li>
                ))}
              </ul>
            </>
          ) : (
            <b>Empate — muro esgotado</b>
          )}
          <p className="muted small">Próxima mão em instantes…</p>
        </div>
      )}

      <div className="panel" style={{ marginTop: '0.7rem' }}>
        <h3 className="panel-title">Histórico</h3>
        <div className="event-log" aria-live="polite">
          {[...v.events].reverse().slice(0, 40).map((ev, i) => (
            <div key={i} className={ev.t === 'win' ? 'ev-win' : ''}>[M{ev.hand}] {ev.detail ?? ev.t}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
