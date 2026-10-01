import { useEffect, useRef, useState } from 'react';
import type { PublicState } from '../../game-engine/traditional/engine';
import { TileFaceArt, TileBack } from '../../components/TileFace';
import { faceName, type TileFace } from '../../game-engine/tiles/tiles';
import { sfx } from '../../components/sound';
import { ReplayReview } from '../traditional/ReplayReview';
import { inviteLink, roomFromSearch, copyText, replayLink, replayCodeFromSearch, monthDaysLeft } from './invite';
import QRCode from 'qrcode';
import { t } from '../../i18n';
import type { ReplayRecord } from '../../game-engine/traditional/engine';
import type { Ruleset } from '../../game-engine/rules/ruleset';
import { rulesetForReplay } from '../traditional/replayIO';

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
  ranked?: boolean;
  isPrivate?: boolean;
  turnExpiresAt?: number;
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
/** mesmo conjunto fixo do servidor (server/main.ts) */
const EMOTES = ['😀', '😂', '😮', '😢', '👍', '🙏', '🀄', '🎉'];

interface ChatMsg {
  seat: number;
  name: string;
  text?: string;
  emote?: string;
}

/** Últimas N partidas ranqueadas + gráfico de Elo (SVG puro, sem libs) */
function HistoryPanel({
  rows,
  onReview,
}: {
  rows: { playedAt: number; win: boolean; points: number; eloBefore: number; eloAfter: number; roomCode: string; hasReplay?: boolean }[];
  onReview?: (playedAt: number) => void;
}) {
  // série cronológica (mais antiga → mais nova) para o gráfico
  const series = [...rows].sort((a, b) => a.playedAt - b.playedAt).map((r) => r.eloAfter);
  const W = 320;
  const H = 96;
  const pad = 10;
  let pts = '';
  let min = 1500;
  let max = 1500;
  if (series.length > 0) {
    min = Math.min(...series);
    max = Math.max(...series);
    const span = Math.max(1, max - min);
    pts = series
      .map((v, i) => {
        const x = series.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (series.length - 1);
        const y = H - pad - ((v - min) / span) * (H - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <h3 className="panel-title">{t('on.history', { n: rows.length })}</h3>
      {rows.length === 0 ? (
        <p className="muted small">Nenhuma partida ranqueada ainda.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 420, display: 'block' }} role="img" aria-label="Gráfico de Elo">
            <polyline points={pts} fill="none" stroke="var(--gold, #d4af37)" strokeWidth="2" />
            {series.map((v, i) => {
              const x = series.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (series.length - 1);
              const y = H - pad - ((v - Math.min(...series)) / Math.max(1, Math.max(...series) - Math.min(...series))) * (H - 2 * pad);
              return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--gold, #d4af37)" />;
            })}
            <text x="4" y="10" fontSize="9" fill="currentColor" opacity="0.7">⭐ {max}</text>
            <text x="4" y={H - 3} fontSize="9" fill="currentColor" opacity="0.7">⭐ {min}</text>
          </svg>
          {rows.slice(0, 10).map((r, i) => {
            const d = r.eloAfter - r.eloBefore;
            return (
              <div key={i} className="row small" style={{ marginBottom: 3 }}>
                <span style={{ width: 18 }}>{r.win ? '🏆' : '·'}</span>
                <span style={{ width: 130 }} className="muted">{new Date(r.playedAt).toLocaleString()}</span>
                <span style={{ flex: 1 }}>
                  {r.win ? 'Vitória' : 'Derrota'} · {r.points >= 0 ? '+' : ''}{r.points} pts · sala {r.roomCode}
                </span>
                <span>
                  ⭐ {r.eloBefore} → <b>{r.eloAfter}</b>{' '}
                  <span style={{ color: d > 0 ? '#9fe8a2' : d < 0 ? '#ff9d99' : 'inherit' }}>
                    ({d > 0 ? '+' : ''}{d})
                  </span>
                </span>
                {r.hasReplay && onReview && (
                  <button
                    className="btn btn-sm"
                    title={t('on.review')}
                    onClick={() => onReview(r.playedAt)}
                  >
                    {t('on.review')}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export function OnlineScreen() {
  const [phase, setPhase] = useState<'form' | 'lobby' | 'table'>('form');
  const [name, setName] = useState(() => sessionStorage.getItem('umo.online.name') || '');
  const [code, setCode] = useState('');
  // item 8.4: convite por link (?sala=CODE) preenche o código
  const [joinCode, setJoinCode] = useState(() => roomFromSearch(window.location.search));
  /** temporada corrente como YYYY-MM (fallback local p/ o painel) */
  const seasonHint = () => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('umo.online.token'));
  const [accountToken, setAccountToken] = useState<string | null>(() => sessionStorage.getItem('umo.online.accountToken'));
  const [accountName, setAccountName] = useState(() => sessionStorage.getItem('umo.online.accountName') || '');
  const [accountUser, setAccountUser] = useState('');
  const [rulesSel, setRulesSel] = useState<'classic' | 'chicken' | 'riichi' | 'mcr'>('classic');
  const [roomPw, setRoomPw] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [queueInfo, setQueueInfo] = useState<{ position: number; size: number; rules: string } | null>(null);
  const [stats, setStats] = useState<{ played: number; wins: number; points: number; elo: number; season: string; prevSeason: string | null; prevElo: number | null; eloByRuleset?: { classic: number; riichi: number; mcr: number } } | null>(null);
  // item 11.5: variante da fila ranqueada e da classificação
  const [rankRs, setRankRs] = useState<'classic' | 'riichi' | 'mcr'>('classic');
  const [lbRs, setLbRs] = useState<'classic' | 'riichi' | 'mcr'>('classic');
  const [leaderSeason, setLeaderSeason] = useState<string | null>(null);
  // item 8.4: feedback dos botões de cópia (código/link) — null = nada copiado
  const [copied, setCopied] = useState<'código' | 'link' | null>(null);
  // item 11.3: QR do convite/replay (gerado localmente, sem serviço externo)
  const [qr, setQr] = useState<{ label: string; url: string; img: string } | null>(null);
  const showQr = (label: string, url: string) => {
    QRCode.toDataURL(url, { margin: 1, width: 256 })
      .then((img) => setQr({ label, url, img }))
      .catch(() => undefined);
  };
  /** copia com feedback; se o navegador bloquear, pede cópia manual */
  const doCopy = async (what: 'código' | 'link', text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } else {
      window.prompt('Copie manualmente:', text);
    }
  };
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatOpen, setChatOpen] = useState(true);
  const [hist, setHist] = useState<{ playedAt: number; win: boolean; points: number; eloBefore: number; eloAfter: number; roomCode: string; hasReplay?: boolean }[] | null>(null);
  // item 8.3: revisão de partida ranqueada salva (ReplayReview reutilizado)
  const [replayView, setReplayView] = useState<{ record: ReplayRecord; ruleset: Ruleset } | null>(null);
  // item 9.2: código do replay compartilhável da partida atual + campo p/ assistir por código
  const [lastReplayCode, setLastReplayCode] = useState<string | null>(null);
  const [watchCode, setWatchCode] = useState('');
  const [leader, setLeader] = useState<{ username: string; elo: number; rankedPlayed: number; rankedWins: number; rankedPoints: number }[] | null>(null);
  // item 9.4: status da fila ranqueada por Elo
  const [rq, setRq] = useState<{ position: number; size: number; elo: number; window: number } | null>(null);
  // item 9.3: pódio das temporadas encerradas
  const [seasonHist, setSeasonHist] = useState<{ season: string; rows: { username: string; elo: number; rankedPlayed: number; rankedWins: number }[] }[] | null>(null);
  const [view, setView] = useState<PublicState | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [actions, setActions] = useState<MyActions>({ legal: [], canTsumo: false, canRiichi: false });
  const [mySeat, setMySeat] = useState(-1);
  // erro do servidor vem com `code` (item 9.1): exibimos a tradução do código
  const [error, setError] = useState<{ code?: string; text: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // item 7.3: notificação de vez (title + som) e countdown do timer de descarte
  const myTurn = phase === 'table' && view?.phase === 'discard' && view.current === mySeat && mySeat >= 0;
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!myTurn) return;
    sfx.click();
    const original = document.title;
    let on = false;
    document.title = '▶ Sua vez!';
    const id = setInterval(() => {
      on = !on;
      document.title = on ? original : '▶ Sua vez!';
    }, 1000);
    return () => {
      clearInterval(id);
      document.title = original;
    };
  }, [myTurn]);
  useEffect(() => {
    if (!myTurn) return;
    const id = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(id);
  }, [myTurn]);

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
      if (msg.t === 'queue') {
        setQueueInfo({ position: msg.position, size: msg.size, rules: String(msg.rules) });
        return;
      }
      if (msg.t === 'unqueued') {
        setQueueInfo(null);
        return;
      }
      if (msg.t === 'stats') {
        setStats({
          played: msg.rankedPlayed,
          wins: msg.rankedWins,
          points: msg.rankedPoints,
          elo: msg.elo ?? 1500,
          season: String(msg.season ?? ''),
          prevSeason: msg.prevSeason ?? null,
          prevElo: msg.prevElo ?? null,
          eloByRuleset: msg.eloByRuleset as { classic: number; riichi: number; mcr: number } | undefined,
        });
        return;
      }
      if (msg.t === 'leaderboard') {
        setLeader((msg.rows ?? []) as typeof leader);
        setLeaderSeason(msg.season ? String(msg.season) : null);
        return;
      }
      if (msg.t === 'history') {
        setHist((msg.rows ?? []) as typeof hist);
        return;
      }
      if (msg.t === 'queueRankedStatus') {
        setRq({ position: Number(msg.position), size: Number(msg.size), elo: Number(msg.elo), window: Number(msg.window) });
        return;
      }
      if (msg.t === 'joined') {
        setRq(null);
      }
      if (msg.t === 'seasonHistory') {
        setSeasonHist((msg.seasons ?? []) as typeof seasonHist);
        return;
      }
      if (msg.t === 'replayCode' && msg.code) {
        setLastReplayCode(String(msg.code));
        return;
      }
      if (msg.t === 'replay' && msg.replay) {
        const rec = msg.replay as ReplayRecord;
        setReplayView({ record: rec, ruleset: rulesetForReplay(String(rec.rulesetId ?? 'hk')) });
        return;
      }
      if (msg.t === 'chat' || msg.t === 'emote') {
        setChat((c) => [...c.slice(-59), { seat: msg.seat, name: String(msg.name ?? ''), text: msg.text, emote: msg.emote }]);
        return;
      }
      if (msg.t === 'joined') {
        setQueueInfo(null);
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
        setError(msg.code ? { code: String(msg.code), text: String(msg.error ?? '') } : { text: String(msg.error) });
      }
    };
    ws.onclose = () => setError({ code: 'err.connectionClosed', text: '' });
  };

  // item 8.4: veio de convite com nome já salvo nesta aba → entra sozinho
  // item 9.2: ?replay=CODE → abre o replay compartilhado direto
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current) return;
    const replayParam = replayCodeFromSearch(window.location.search);
    if (replayParam) {
      autoJoined.current = true;
      connect({ t: 'replayByCode', code: replayParam });
      return;
    }
    const invited = roomFromSearch(window.location.search);
    const savedName = sessionStorage.getItem('umo.online.name');
    if (invited && savedName) {
      autoJoined.current = true;
      connect({ t: 'join', code: invited, name: savedName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const sendChat = () => {
    const text = chatText.trim();
    if (!text) return;
    send({ t: 'chat', text });
    setChatText('');
  };

  const chatPanel = (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <h3 className="panel-title" style={{ margin: 0 }}>💬 Chat da mesa</h3>
        <button className="btn btn-sm" onClick={() => setChatOpen((o) => !o)}>{chatOpen ? '—' : '+'}</button>
      </div>
      {chatOpen && (
        <>
          <div className="event-log" aria-live="polite" style={{ maxHeight: 140, marginBottom: 6 }}>
            {chat.length === 0 && <div className="muted small">Sem mensagens ainda.</div>}
            {chat.map((m, i) => (
              <div key={i} className="small">
                {/* item 11.4: espectadores (seat -1) participam do chat identificados */}
                {m.emote ? (
                  <><b>{m.seat === -1 ? '👁 ' : ''}{m.name}</b> {m.emote}</>
                ) : (
                  <><b>{m.seat === -1 ? '👁 ' : ''}{m.name}</b>: {m.text}</>
                )}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 6 }}>
            {EMOTES.map((e, i) => (
              <button key={i} className="btn btn-sm" title={`Emote ${e}`} onClick={() => send({ t: 'emote', id: i })}>
                {e}
              </button>
            ))}
          </div>
          <div className="row">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              placeholder="Mensagem (máx. 140)"
              maxLength={140}
              style={{ flex: 1 }}
              aria-label="Mensagem do chat"
            />
            <button className="btn btn-sm" onClick={sendChat}>Enviar</button>
          </div>
        </>
      )}
    </div>
  );

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
        <h1 className="page-title">{t('on.title')}</h1>
        <p className="page-sub">{t('on.sub')}</p>
        <label className="field">
          {t('on.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jogador" />
        </label>
        <label className="field">
          Regras da sala/fila
          <select value={rulesSel} onChange={(e) => setRulesSel(e.target.value as typeof rulesSel)}>
            <option value="classic">HK clássica</option>
            <option value="chicken">HK frango (sem mínimo)</option>
            <option value="riichi">Riichi (Japão)</option>
            <option value="mcr">MCR (Competição)</option>
          </select>
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => connect({ t: 'create', name: name || 'Jogador', rules: rulesSel, accountToken: accountToken ?? undefined, password: roomPw || undefined })}>
            ✚ {t('on.create')}
          </button>
          <button
            className="btn"
            title={accountToken ? 'Resultados contam para a sua conta' : 'Crie uma conta para salas ranqueadas'}
            disabled={!accountToken}
            onClick={() => connect({ t: 'create', name: name || 'Jogador', rules: rulesSel, ranked: true, accountToken, password: roomPw || undefined })}
          >
            🏆 Sala ranqueada
          </button>
          <input
            type="password"
            value={roomPw}
            onChange={(e) => setRoomPw(e.target.value)}
            placeholder={t('on.pwPlaceholder')}
            style={{ width: 150 }}
            maxLength={32}
            aria-label="Senha da sala"
          />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => connect({ t: 'queue', name: name || 'Jogador', rules: rulesSel, accountToken: accountToken ?? undefined })}>
            ⚡ Partida rápida
          </button>
          {queueInfo ? (
            <>
              <span className="muted small">
                Na fila ({queueInfo.rules}): posição {queueInfo.position} de {queueInfo.size} — a mesa começa com 4.
              </span>
              <button className="btn btn-sm" onClick={() => send({ t: 'unqueue' })}>
                Sair da fila
              </button>
            </>
          ) : (
            <span className="muted small">Entre na fila e o servidor monta a mesa com 4 jogadores.</span>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder={t('on.codePlaceholder')}
            style={{ width: 180 }}
            maxLength={4}
          />
          <input
            type="password"
            value={joinPw}
            onChange={(e) => setJoinPw(e.target.value)}
            placeholder="🔒 Senha"
            style={{ width: 100 }}
            maxLength={32}
            aria-label="Senha para entrar"
          />
          <button className="btn" onClick={() => connect({ t: 'join', code: joinCode, name: name || 'Jogador', accountToken: accountToken ?? undefined, password: joinPw || undefined })}>{t('on.join')}</button>
          <button className="btn" onClick={() => connect({ t: 'spectate', code: joinCode, name: name || 'Espectador', password: joinPw || undefined })}>👁 Assistir</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            value={accountUser}
            onChange={(e) => setAccountUser(e.target.value)}
            placeholder={t('on.accountPlaceholder')}
            style={{ width: 180 }}
            maxLength={32}
          />
          <button className="btn" onClick={() => connect({ t: 'account', username: accountUser })}>{t('on.createAccount')}</button>
          {accountToken && (
            <button className="btn" onClick={() => connect({ t: 'join', accountToken })}>{t('on.resume')}</button>
          )}
          {accountToken && (
            <button className="btn" onClick={() => connect({ t: 'stats', accountToken })}>{t('on.statsBtn')}</button>
          )}
          <select
            value={lbRs}
            onChange={(e) => setLbRs(e.target.value as 'classic' | 'riichi' | 'mcr')}
            aria-label={t('on.leaderboardRuleset')}
          >
            <option value="classic">{t('stats.variantHK')}</option>
            <option value="riichi">{t('stats.variantRiichi')}</option>
            <option value="mcr">{t('stats.variantMCR')}</option>
          </select>{' '}
          <button className="btn" onClick={() => connect({ t: 'leaderboard', ruleset: lbRs })}>{t('on.leaderboardBtn')}</button>
          {accountToken && (
            <select
              value={rankRs}
              onChange={(e) => setRankRs(e.target.value as 'classic' | 'riichi' | 'mcr')}
              aria-label={t('on.queueRuleset')}
            >
              <option value="classic">{t('stats.variantHK')}</option>
              <option value="riichi">{t('stats.variantRiichi')}</option>
              <option value="mcr">{t('stats.variantMCR')}</option>
            </select>
          )}
          {accountToken && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setRq(null);
                connect({ t: 'queueRanked', name: name || 'Jogador', accountToken, ruleset: rankRs });
              }}
            >
              ⚡ {t('on.queueRanked')}
            </button>
          )}
          {accountToken && (
            <button className="btn" onClick={() => connect({ t: 'history', accountToken })}>{t('on.historyBtn')}</button>
          )}
        </div>
        {rq && (
          <p className="muted small" style={{ marginTop: 6 }}>
            ⏳ {t('on.queueRankedStatus', { p: rq.position, n: rq.size, elo: rq.elo, w: rq.window })}
          </p>
        )}
        {stats && (
          <p className="muted small" style={{ marginTop: 6 }}>
            🏆 Ranqueadas: <b>{stats.played}</b> partidas · <b>{stats.wins}</b> vitórias ·{' '}
            <b>{stats.points}</b> pontos · ⭐ Elo <b>{stats.elo}</b>
            {stats.eloByRuleset && (
              <>
                {' '}· {t('stats.variantHK')} <b>{stats.eloByRuleset.classic}</b>
                {' '}· {t('stats.variantRiichi')} <b>{stats.eloByRuleset.riichi}</b>
                {' '}· {t('stats.variantMCR')} <b>{stats.eloByRuleset.mcr}</b>
              </>
            )}
            {stats.season && <> · 🎖️ {t('on.season')} <b>{stats.season}</b></>}
          </p>
        )}
        {stats?.prevSeason && (
          <p className="muted small" style={{ marginTop: 4 }}>
            🎖️ {t('on.seasonEnded', { season: stats.prevSeason, elo: stats.prevElo ?? 1500 })}
          </p>
        )}
        {hist && (
          <HistoryPanel
            rows={hist}
            onReview={(playedAt) => connect({ t: 'replay', accountToken, playedAt })}
          />
        )}
        {leader && leader.length > 0 && (
          <div className="panel" style={{ marginTop: 8 }}>
            <h3 className="panel-title">
              🎖️ {t('on.seasonPanel', { season: leaderSeason ?? seasonHint() })}
            </h3>
            {monthDaysLeft() <= 7 && (
              <p className="muted small" style={{ color: '#ffd28a' }}>
                ⏳ {t('on.seasonEnding', { n: monthDaysLeft() })}
              </p>
            )}
            <div className="row" style={{ gap: 10 }}>
              {leader.slice(0, 3).map((r, i) => (
                <span key={r.username} className="small">
                  {['🥇', '🥈', '🥉'][i]} <b>{r.username}</b> ⭐ {r.elo}
                </span>
              ))}
            </div>
            <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => connect({ t: 'seasonHistory' })}>
              🏛 {t('on.pastSeasons')}
            </button>
            {seasonHist && (
              seasonHist.length === 0 ? (
                <p className="muted small" style={{ marginTop: 4 }}>{t('on.noPastSeasons')}</p>
              ) : (
                seasonHist.map((sh) => (
                  <div key={sh.season} style={{ marginTop: 6 }}>
                    <b className="small">{t('on.season')} {sh.season}</b>
                    <ul className="muted small" style={{ margin: '2px 0 0 16px' }}>
                      {sh.rows.slice(0, 3).map((r, i) => (
                        <li key={r.username}>
                          {['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} {r.username} — ⭐ {r.elo} ({r.rankedWins}/{r.rankedPlayed})
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )
            )}
          </div>
        )}
        {replayView && (
          <ReplayReview
            record={replayView.record}
            ruleset={replayView.ruleset}
            onClose={() => setReplayView(null)}
          />
        )}
        {leader && (
          <div className="panel" style={{ marginTop: 8 }}>
            <h3 className="panel-title">{t('on.leaderboard')}{leaderSeason ? ` — ${t('on.season')} ${leaderSeason}` : ''}</h3>
            {leader.length === 0 ? (
              <p className="muted small">Nenhuma conta ainda.</p>
            ) : (
              leader.map((r, i) => (
                <div key={r.username} className="row small" style={{ marginBottom: 4 }}>
                  <span style={{ width: 28 }}>{i + 1}.</span>
                  <span style={{ flex: 1 }}>{r.username}</span>
                  <span>⭐ <b>{r.elo}</b></span>
                  <span className="muted" style={{ width: 110, textAlign: 'right' }}>
                    {r.rankedWins}V/{Math.max(0, r.rankedPlayed - r.rankedWins)}D · {r.rankedPlayed}P
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {accountToken && (
          <p className="muted small" style={{ marginTop: 6 }}>
            Conta <b>{accountName}</b> ativa — suas salas podem ser retomadas em outro dispositivo.
          </p>
        )}
        {error && <p style={{ color: '#ffd9d7', marginTop: 10 }}>{error.code ? t(error.code) : error.text}</p>}
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
        <h1 className="page-title">
          Sala {code}
          {meta?.ranked ? ' 🏆' : ''}
          {meta?.isPrivate ? ' 🔒' : ''}
        </h1>
        {meta?.ranked && (
          <p className="page-sub">
            Sala ranqueada — o resultado conta para as contas vinculadas. Começa com 3+ humanos
            (assentos vazios viram bots).
          </p>
        )}
        {meta?.isPrivate && <p className="page-sub">🔒 Sala privada — quem entrar precisa da senha.</p>}
        <p className="page-sub">
          {t('on.share')} <b>{code}</b>. {' '}
          <button className="btn btn-sm" onClick={() => doCopy('código', code)}>
            {copied === 'código' ? t('on.copied') : t('on.copyCode')}
          </button>{' '}
          <button className="btn btn-sm" onClick={() => doCopy('link', inviteLink(window.location.href, code))}>
            {copied === 'link' ? t('on.copied') : t('on.copyLink')}
          </button>{' '}
          <button className="btn btn-sm" onClick={() => showQr(t('on.qrInvite'), inviteLink(window.location.href, code))}>
            {t('on.qrBtn')}
          </button>
        </p>
        {qr && (
          <div className="panel" style={{ marginTop: 8, textAlign: 'center' }}>
            <img src={qr.img} alt={t('on.qrAlt')} width={220} height={220} style={{ imageRendering: 'pixelated' }} />
            <div className="muted small" style={{ wordBreak: 'break-all' }}>{qr.label} — {qr.url}</div>
            <button className="btn btn-sm" onClick={() => setQr(null)}>{t('on.qrClose')}</button>
          </div>
        )}
        {lastReplayCode && (
          <p className="page-sub">
            🎬 {t('on.replayCodeTitle')} <b>{lastReplayCode}</b>{' '}
            <button className="btn btn-sm" onClick={() => doCopy('código', lastReplayCode)}>
              {copied === 'código' ? t('on.copied') : t('on.copyCode')}
            </button>{' '}
            <button
              className="btn btn-sm"
              onClick={() => doCopy('link', replayLink(window.location.href, lastReplayCode))}
            >
              {copied === 'link' ? t('on.copied') : t('on.copyLink')}
            </button>{' '}
            <button className="btn btn-sm" onClick={() => showQr(t('on.qrReplay'), replayLink(window.location.href, lastReplayCode))}>
              {t('on.qrBtn')}
            </button>{' '}
            <button className="btn btn-sm" onClick={() => connect({ t: 'replayByCode', code: lastReplayCode })}>
              {t('on.review')}
            </button>
          </p>
        )}
        <p className="page-sub" style={{ marginTop: 6 }}>
          <input
            value={watchCode}
            onChange={(e) => setWatchCode(e.target.value.toUpperCase())}
            placeholder={t('on.replayCodePlaceholder')}
            maxLength={16}
            style={{ width: 180 }}
          />{' '}
          <button
            className="btn btn-sm"
            onClick={() => watchCode.trim() && connect({ t: 'replayByCode', code: watchCode.trim() })}
          >
            {t('on.watchReplay')}
          </button>
        </p>
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
        {chatPanel}
        {error && <p style={{ color: '#ffd9d7' }}>{error.code ? t(error.code) : error.text}</p>}
      </div>
    );
  }

  const v = view;
  if (!v) return null;
  const myHand = v.myHand?.seat === mySeat ? v.myHand.tiles : [];
  const myOffers = v.offers.filter((o) => o.seat === mySeat);
  const humanTurn = v.phase === 'discard' && v.current === mySeat;

  // item 9.7: navegação por teclado na mão (setas + Enter)
  const handSorted = [...myHand].sort((a, b) => a.id - b.id);
  const onHandKey = (e: React.KeyboardEvent) => {
    const opts = humanTurn ? handSorted.filter((h) => actions.legal.includes(h.id)) : [];
    if (opts.length === 0) return;
    const i = selected == null ? -1 : opts.findIndex((h) => h.id === selected);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight'
        ? opts[i < 0 ? 0 : (i + 1) % opts.length]
        : opts[i < 0 ? opts.length - 1 : (i - 1 + opts.length) % opts.length];
      setSelected(next.id);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (selected != null && actions.legal.includes(selected)) {
        e.preventDefault();
        doDiscard(selected);
      }
    }
  };

  return (
    <div>
      <div className="row-between" style={{ marginBottom: '0.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.2rem' }}>
          Sala {meta?.code}
          {meta?.ranked ? ' 🏆' : ''}
          {meta?.isPrivate ? ' 🔒' : ''} — mão {v.handNumber} · vento {WIND_PT[v.roundWind]}
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
          <div
            className="hand-row"
            role="list"
            aria-label="Sua mão — use as setas para percorrer e Enter para descartar"
            onKeyDown={onHandKey}
          >
            {handSorted.map(({ id, face }) => (
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
          {myTurn && meta?.turnExpiresAt && (
            <div className="row small" style={{ marginBottom: 6 }} role="timer" aria-label="Tempo para descartar">
              <span>
                ⏳ <b>{Math.max(0, Math.ceil((meta.turnExpiresAt - nowTick) / 1000))}s</b> para descartar
                (depois o servidor descarta por você)
              </span>
              <span style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden' }}>
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    background: 'var(--gold, #d4af37)',
                    width: `${Math.min(100, Math.max(0, ((meta.turnExpiresAt - nowTick) / 30000) * 100))}%`,
                  }}
                />
              </span>
            </div>
          )}
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

      {chatPanel}

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
