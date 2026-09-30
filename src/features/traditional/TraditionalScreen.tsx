import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Settings } from '../../storage/profile';
import { recordTraditionalHand, recordTraditionalMatch } from '../../storage/profile';
import {
  newMatch,
  drawTile,
  discard,
  resolveCalls,
  resolveRob,
  canTsumo,
  canAnkan,
  canAddKong,
  canRiichi,
  declareRiichi,
  declareAnkan,
  declareAddedKong,
  declareTsumo,
  nextHandOrEnd,
  seatWindOf,
  handFaces,
  faceOf,
  legalDiscards,
  waitsWithCounts,
  type TradState,
  type Offer,
  type CallDecision,
} from '../../game-engine/traditional/engine';
import { HK_DEFAULTS, HK_CHICKEN } from '../../game-engine/rules/hongkong';
import { hkRuleset } from '../../game-engine/rules/ruleset';
import { riichiRuleset } from '../../game-engine/rules/riichi';
import { mcrRuleset } from '../../game-engine/rules/mcr';
import { chooseDiscard, chooseCall, type BotView, type Difficulty } from '../../game-engine/ai/bot';
import { createRng } from '../../game-engine/tiles/rng';
import { faceName, faceIndex, indexToFace, type TileFace } from '../../game-engine/tiles/tiles';
import { TileFaceArt, TileBack } from '../../components/TileFace';
import { Modal } from '../../components/ui';
import { sfx } from '../../components/sound';

const WIND_PT = ['', 'Leste', 'Sul', 'Oeste', 'Norte'];

function MiniTile({ face }: { face?: TileFace }) {
  return (
    <span className={`mini-tile${face ? '' : ' back'}`}>
      {face && <TileFaceArt face={face} />}
      {!face && <TileBack />}
    </span>
  );
}

export function TraditionalScreen({ settings }: { settings: Settings }) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const rules = settings.traditional.rules === 'chicken' ? HK_CHICKEN : { ...HK_DEFAULTS, handsPerMatch: settings.traditional.hands };
  const ruleset =
    settings.traditional.rules === 'riichi'
      ? riichiRuleset({ handsPerMatch: settings.traditional.hands, renchan: true })
      : settings.traditional.rules === 'mcr'
        ? mcrRuleset({ handsPerMatch: settings.traditional.hands, renchan: false, minFan: 8, flowerPositionBonus: true })
        : hkRuleset(rules);
  const stateRef = useRef<TradState | null>(null);
  if (stateRef.current === null) stateRef.current = newMatch(ruleset, Date.now() >>> 0);
  const humanDecisionRef = useRef<CallDecision | null>(null);
  const humanRobRef = useRef<boolean | null>(null);
  const turnCountRef = useRef(0);
  const recordedHandRef = useRef(0);
  const recordedMatchRef = useRef(false);
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [matchOverAck, setMatchOverAck] = useState(false);

  const lastRulesRef = useRef(settings.traditional.rules);
  if (lastRulesRef.current !== settings.traditional.rules) {
    lastRulesRef.current = settings.traditional.rules;
    stateRef.current = newMatch(ruleset, Date.now() >>> 0);
  }

  const s = stateRef.current;
  const difficulty: Difficulty = settings.traditional.botDifficulty;

  /* ---------- bot view builder (public info only) ---------- */
  const botView = useCallback(
    (st: TradState, seat: number): BotView => ({
      seat,
      seatWind: seatWindOf(st, seat),
      roundWind: st.roundWind,
      hand: handFaces(st, seat),
      melds: st.players[seat].melds.map((m) => ({ kind: m.kind, faces: m.tiles.map((t) => faceOf(st, t)) })),
      bonusFaces: st.players[seat].bonus.map((id) => faceOf(st, id)),
      visibleDiscards: st.players.flatMap((p) => p.discards.map((id) => faceOf(st, id))),
      otherMeldFaces: st.players
        .filter((p) => p.seat !== seat)
        .flatMap((p) =>
          p.melds
            // concealed kongs stay SECRET — bots must not see them (real-rule fidelity)
            .filter((m) => m.kind !== 'ankan')
            .flatMap((m) => m.tiles.map((t) => faceOf(st, t)))
        ),
      wallCount: st.wall.length,
      turnNumber: turnCountRef.current,
      // per-opponent PUBLIC info only (ponds, open melds, riichi flag)
      opponents: st.players
        .filter((p) => p.seat !== seat)
        .map((p) => ({
          seat: p.seat,
          discards: p.discards.map((id) => faceIndex(faceOf(st, id))),
          meldCount: p.melds.filter((m) => m.kind !== 'ankan').length,
          riichi: p.riichi,
        })),
    }),
    []
  );

  const botDecideCalls = useCallback(
    (st: TradState, seat: number, offers: Offer[]): CallDecision => {
      const view = botView(st, seat);
      const discardFace = st.lastDiscard ? faceOf(st, st.lastDiscard.tileId) : view.hand[0];
      const chi = offers.find((o) => o.kind === 'chi');
      const res = chooseCall(
        view,
        {
          canRon: offers.some((o) => o.kind === 'ron'),
          canPon: offers.some((o) => o.kind === 'pon'),
          canKan: offers.some((o) => o.kind === 'kan'),
          chiOptions: chi?.chiOptions
            ? chi.chiOptions.map((pair) => pair.map((id) => faceOf(st, id)) as [TileFace, TileFace])
            : null,
          discardFace,
        },
        difficulty,
        createRng((st.rngState ^ (seat * 0x9e3779b9) ^ (turnCountRef.current * 2654435761)) >>> 0)
      );
      if (res.call === 'ron') return { offer: offers.find((o) => o.kind === 'ron')! };
      if (res.call === 'pon') return { offer: offers.find((o) => o.kind === 'pon')! };
      if (res.call === 'kan') return { offer: offers.find((o) => o.kind === 'kan')! };
      if (res.call === 'chi') return { offer: chi!, chiChoice: chi!.chiOptions![res.chiChoice ?? 0] };
      return { offer: null };
    },
    [botView, difficulty]
  );

  /* ---------- game loop ---------- */
  useEffect(() => {
    const st = s;
    if (st.phase === 'hand-over' || st.phase === 'match-over') return;

    if (st.phase === 'draw') {
      const delay = st.players[st.current].isHuman ? 350 : 650;
      const t = window.setTimeout(() => {
        drawTile(st);
        sfx.click();
        bump();
      }, delay);
      return () => window.clearTimeout(t);
    }

    if (st.phase === 'discard' && !st.players[st.current].isHuman) {
      const t = window.setTimeout(() => {
        const seat = st.current;
        if (canTsumo(st, seat)) {
          declareTsumo(st, seat);
          sfx.win();
          bump();
          return;
        }
        if (canAnkan(st, seat) !== null && Math.random() < 0) {
          /* ankan by bots disabled in v1 (keeps flow simple) */
        }
        if (difficulty === 'hard' && canRiichi(st, seat)) declareRiichi(st, seat);
        const view = botView(st, seat);
        const i = chooseDiscard(view, difficulty, createRng((st.rngState ^ (turnCountRef.current * 40503)) >>> 0));
        turnCountRef.current += 1;
        const tileId = st.players[seat].hand[i] ?? st.players[seat].hand[0];
        discard(st, tileId);
        sfx.click();
        bump();
      }, 900);
      return () => window.clearTimeout(t);
    }

    if (st.phase === 'calls') {
      const t = window.setTimeout(() => {
        const res = resolveCalls(st, (seat, offers) => {
          if (st.players[seat].isHuman) {
            if (humanDecisionRef.current === null) return 'pending';
            const d = humanDecisionRef.current;
            humanDecisionRef.current = null;
            return d;
          }
          return botDecideCalls(st, seat, offers);
        });
        // 'pending' means the UI is waiting for the human — do NOT bump (would loop);
        // the human's answer handler bumps and re-enters this effect.
        if (res === 'resolved') {
          sfx.call();
          bump();
        }
      }, 450);
      return () => window.clearTimeout(t);
    }

    if (st.phase === 'calls-rob') {
      const t = window.setTimeout(() => {
        const res = resolveRob(st, (seat) => {
          if (st.players[seat].isHuman) {
            if (humanRobRef.current === null) return 'pending';
            const d = humanRobRef.current;
            humanRobRef.current = null;
            return d;
          }
          return false; // bots never rob in v1 (documented limitation)
        });
        if (res === 'resolved') bump();
      }, 450);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  /* ---------- stats recording ---------- */
  useEffect(() => {
    if (s.phase === 'hand-over' && s.result && recordedHandRef.current !== s.handNumber) {
      recordedHandRef.current = s.handNumber;
      if (s.result.kind === 'win') {
        recordTraditionalHand({
          humanWon: s.result.winner === 0,
          selfDrawn: !!s.result.selfDrawn,
          fan: s.result.scoring?.totalFan ?? 0,
          points: s.result.scoring?.points ?? 0,
        });
      }
      bump();
    }
    if (s.phase === 'match-over' && !recordedMatchRef.current) {
      recordedMatchRef.current = true;
      const best = Math.max(...s.players.map((p) => p.score));
      recordTraditionalMatch(s.players[0].score === best && best > 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase, s.result]);

  /* ---------- human actions ---------- */

  const humanOffers = useMemo(() => {
    if (s.phase !== 'calls') return [];
    return s.offers.filter((o) => o.seat === 0);
  }, [s.phase, s.offers, s.events.length]);

  const humanCanRob = s.phase === 'calls-rob' && s.offers.some((o) => o.seat === 0);

  // tenpai information: which tiles complete the hand and how many remain
  const waitsInfo = useMemo(() => {
    if (s.phase === 'hand-over' || s.phase === 'match-over') return null;
    const me = s.players[0];
    const handF = handFaces(s, 0);
    if (s.phase === 'discard' && s.current === 0) {
      // holding 14: which discards leave us tenpai, waiting on what
      const rows: { dropId: number; dropFace: TileFace; waits: { face: number; left: number }[] }[] = [];
      for (const id of legalDiscards(s, 0)) {
        const faces: TileFace[] = [];
        let dropped = false;
        for (const tid of me.hand) {
          if (!dropped && tid === id) {
            dropped = true;
            continue;
          }
          faces.push(faceOf(s, tid));
        }
        const w = waitsWithCounts(s, 0, faces);
        if (w.length) rows.push({ dropId: id, dropFace: faceOf(s, id), waits: w });
      }
      return rows.length ? ({ mode: 'per-discard', rows } as const) : null;
    }
    if (handF.length % 3 === 1) {
      const w = waitsWithCounts(s, 0, handF);
      if (w.length) return { mode: 'tenpai', waits: w } as const;
    }
    return null;
  }, [s]);
  const humanTurn = s.phase === 'discard' && s.current === 0;
  const canHumanTsumo = humanTurn && canTsumo(s, 0);
  const canHumanAnkan = humanTurn && canAnkan(s, 0) !== null;
  const canHumanAddKong = humanTurn && canAddKong(s, 0) !== null;
  const canHumanRiichi = humanTurn && canRiichi(s, 0);
  const myLegal = humanTurn ? new Set(legalDiscards(s, 0)) : new Set<number>();

  const doDiscard = (tileId: number) => {
    if (!humanTurn || !myLegal.has(tileId)) return;
    if (discard(s, tileId)) {
      setSelectedTile(null);
      sfx.click();
      bump();
    }
  };

  const answerOffer = (decision: CallDecision) => {
    humanDecisionRef.current = decision;
    sfx.call();
    bump();
  };

  const answerRob = (yes: boolean) => {
    humanRobRef.current = yes;
    bump();
  };

  const newMatchNow = () => {
    stateRef.current = newMatch(ruleset, Date.now() >>> 0);
    humanDecisionRef.current = null;
    humanRobRef.current = null;
    recordedHandRef.current = 0;
    recordedMatchRef.current = false;
    setMatchOverAck(false);
    setSelectedTile(null);
    bump();
  };

  /* ---------- render ---------- */

  const me = s.players[0];
  const sortedHand = [...me.hand].sort((a, b) => a - b);

  const seatPanel = (seat: number) => {
    const p = s.players[seat];
    return (
      <div className={`seat-panel${s.current === seat && s.phase !== 'hand-over' ? ' active-seat' : ''}`}>
        <div className="seat-name">
          {p.name}
          <span className="seat-wind">{WIND_PT[seatWindOf(s, seat)]}</span>
          {seat === s.dealer && <span title="Dealer">🎴</span>}
          {p.riichi && <span className="seat-wind" title="Riichi declarado" style={{ color: '#e5484d' }}>🀄 Riichi</span>}
        </div>
        <div className="row small">
          <span>Mão: {p.hand.length}</span>
          <span>Pontos: <b>{p.score}</b></span>
        </div>
        {p.bonus.length > 0 && (
          <div className="meld-row" title="Flores/estações">
            {p.bonus.map((id) => <MiniTile key={id} face={faceOf(s, id)} />)}
          </div>
        )}
        {p.melds.length > 0 && (
          <div className="meld-row">
            {p.melds.map((m, i) => (
              <span key={i} className="row" style={{ gap: 1, marginRight: 4 }} title={`${m.kind}${m.added ? ' (adicionado)' : ''}`}>
                {m.tiles.map((t) => <MiniTile key={t} face={m.kind === 'ankan' ? faceOf(s, t) : faceOf(s, t)} />)}
              </span>
            ))}
          </div>
        )}
        {seat !== 0 && (
          <div className="meld-row" aria-label={`${p.hand.length} peças ocultas`}>
            {Array.from({ length: Math.min(p.hand.length, 14) }).map((_, i) => (
              <MiniTile key={i} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const pondBox = (seat: number) => (
    <div className="pond-box">
      <div className="pond-label">{s.players[seat].name}</div>
      <div className="pond">
        {s.players[seat].discards.map((id) => (
          <MiniTile key={id} face={faceOf(s, id)} />
        ))}
      </div>
    </div>
  );

  const chiOptionFaces = (opt: number[]) => opt.map((id) => faceOf(s, id));

  return (
    <div>
      <div className="row-between" style={{ marginBottom: '0.5rem' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '1.2rem' }}>
            Mahjong Tradicional — {s.ruleset.name}
          </h1>
          <p className="muted small" style={{ margin: 0 }}>
            Mão {s.handNumber}/{s.ruleset.handsPerMatch} · Vento dominante {WIND_PT[s.roundWind]} · Muro {s.wall.length} · Dificuldade {difficulty}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setShowRules(true)}>📜 Regras</button>
          <button className="btn btn-sm" onClick={newMatchNow}>⟳ Nova partida</button>
        </div>
      </div>

      <div className="trad-layout">
        <div className="side-top">{seatPanel(2)}</div>
        <div className="side-left">{seatPanel(3)}</div>
        <div className="center-area">
          <div className="table-info">
            <span className="wind-badge">Dominante: {WIND_PT[s.roundWind]}</span>
            <span>Muro: <b>{s.wall.length}</b></span>
            <span>Morto: <b>{s.deadWall.length}</b></span>
            {s.ruleset.name === 'Riichi' && s.doraIndicators.length > 0 && (
              <span className="dora-badge" title="Indicador de dora: a próxima peça vale +1 han">
                Dora:{' '}
                {s.doraIndicators.map((id) => (
                  <span key={id} className="dora-tile">
                    <TileFaceArt face={faceOf(s, id)} />
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="ponds-grid">
            {pondBox(2)}
            {pondBox(3)}
            {pondBox(1)}
            {pondBox(0)}
          </div>
        </div>
        <div className="side-right">{seatPanel(1)}</div>

        <div className="my-area">
          {seatPanel(0)}
          {waitsInfo && (
            <div className="waits-panel" role="status" aria-label="Informação de esperas">
              {waitsInfo.mode === 'tenpai' && (
                <>
                  <span className="waits-label">🎯 Em tenpai — esperas:</span>
                  {waitsInfo.waits.map((w) => (
                    <span key={w.face} className="wait-chip" title={faceName(indexToFace(w.face))}>
                      <span className="wait-tile">
                        <TileFaceArt face={indexToFace(w.face)} />
                      </span>
                      <b>×{w.left}</b>
                    </span>
                  ))}
                </>
              )}
              {waitsInfo.mode === 'per-discard' && (
                <>
                  <span className="waits-label">🎯 Descartes que deixam em tenpai:</span>
                  {waitsInfo.rows.map((r) => (
                    <span key={r.dropId} className="wait-chip">
                      <span className="wait-tile drop" title={`Descartar ${faceName(r.dropFace)}`}>
                        <TileFaceArt face={r.dropFace} />
                      </span>
                      <span className="wait-arrow">→</span>
                      {r.waits.map((w) => (
                        <span key={w.face} className="wait-chip inner" title={faceName(indexToFace(w.face))}>
                          <span className="wait-tile">
                            <TileFaceArt face={indexToFace(w.face)} />
                          </span>
                          <b>×{w.left}</b>
                        </span>
                      ))}
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
          <div className="hand-row" role="list" aria-label="Sua mão">
            {sortedHand.map((id) => {
              const isDrawn = id === s.drawnTile;
              return (
                <button
                  key={id}
                  role="listitem"
                  className={`hand-tile${selectedTile === id ? ' selected' : ''}${isDrawn ? ' drawn' : ''}`}
                  style={{
                    width: 'calc(34px * var(--scale))',
                    height: 'calc(46px * var(--scale))',
                    marginLeft: isDrawn ? 'calc(10px * var(--scale))' : undefined,
                  }}
                  aria-label={faceName(faceOf(s, id))}
                  onClick={() => {
                    if (selectedTile === id) doDiscard(id);
                    else setSelectedTile(id);
                  }}
                  disabled={!humanTurn || !myLegal.has(id)}
                >
                  <span className="tile-face-inner">
                    <TileFaceArt face={faceOf(s, id)} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="action-bar">
            {humanTurn && (
              <>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={selectedTile === null}
                  onClick={() => selectedTile !== null && doDiscard(selectedTile)}
                >
                  🀫 Descartar
                </button>
                {canHumanTsumo && (
                  <button className="btn btn-primary btn-sm" onClick={() => { declareTsumo(s, 0); sfx.win(); bump(); }}>
                    🏆 TSUMO!
                  </button>
                )}
                {canHumanRiichi && !me.riichi && (
                  <button className="btn btn-primary btn-sm" onClick={() => { declareRiichi(s, 0); sfx.call(); bump(); }}>
                    🀄 Riichi
                  </button>
                )}
                {canHumanAnkan && (
                  <button className="btn btn-sm" onClick={() => { declareAnkan(s, 0); sfx.call(); bump(); }}>
                    Kong fechado
                  </button>
                )}
                {canHumanAddKong && (
                  <button className="btn btn-sm" onClick={() => { declareAddedKong(s, 0); bump(); }}>
                    Adicionar Kong
                  </button>
                )}
              </>
            )}
            {humanOffers.length > 0 && (
              <>
                {humanOffers.some((o) => o.kind === 'ron') && (
                  <button className="btn btn-primary btn-sm" onClick={() => answerOffer({ offer: humanOffers.find((o) => o.kind === 'ron')! })}>
                    🏆 RON!
                  </button>
                )}
                {humanOffers.some((o) => o.kind === 'pon') && (
                  <button className="btn btn-sm" onClick={() => answerOffer({ offer: humanOffers.find((o) => o.kind === 'pon')! })}>
                    Pon
                  </button>
                )}
                {humanOffers.some((o) => o.kind === 'kan') && (
                  <button className="btn btn-sm" onClick={() => answerOffer({ offer: humanOffers.find((o) => o.kind === 'kan')! })}>
                    Kong
                  </button>
                )}
                {humanOffers.filter((o) => o.kind === 'chi').flatMap((o) =>
                  (o.chiOptions ?? []).map((opt, i) => (
                    <button
                      key={`chi-${i}`}
                      className="btn btn-sm"
                      onClick={() => answerOffer({ offer: o, chiChoice: opt })}
                      title="Chow"
                    >
                      Chow {chiOptionFaces(opt).map((f2) => faceName(f2)).join(' + ')}
                    </button>
                  ))
                )}
                <button className="btn btn-sm" onClick={() => answerOffer({ offer: null })}>
                  Passar
                </button>
              </>
            )}
            {humanCanRob && (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => answerRob(true)}>
                  🏆 Roubar Kong!
                </button>
                <button className="btn btn-sm" onClick={() => answerRob(false)}>
                  Passar
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: '0.7rem' }}>
        <h3 className="panel-title">Histórico</h3>
        <div className="event-log" aria-live="polite">
          {[...s.events].reverse().slice(0, 60).map((ev, i) => (
            <div key={i} className={ev.t === 'win' ? 'ev-win' : ''}>
              [M{ev.hand}] {ev.detail ?? ev.t}
            </div>
          ))}
        </div>
      </div>

      {showRules && (
        <Modal title={`Regras — ${s.ruleset.name} (v1)`} onClose={() => setShowRules(false)}>
          <ul className="muted" style={{ lineHeight: 1.6 }}>
            {s.ruleset.summary().map((r, i) => (
              <li key={i}>{r}</li>
            ))}
            <li>Chamadas: Ron {'>'} Pon/Kong {'>'} Chow (apenas do jogador à esquerda).</li>
            <li>Bots nunca veem informações ocultas — apenas descartes e conjuntos expostos.</li>
          </ul>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setShowRules(false)}>Entendi</button>
          </div>
        </Modal>
      )}

      {s.phase === 'hand-over' && s.result && (
        <Modal title={s.result.kind === 'win' ? 'Mão vencida!' : 'Empate'} onClose={() => {}}>
          {s.result.kind === 'win' ? (
            <>
              <div className="winner-banner">
                {s.players[s.result.winner!].name} venceu por {s.result.selfDrawn ? 'TSUMO' : 'RON'} —{' '}
                {s.result.scoring!.totalFan} fan{s.result.scoring!.capped ? ' (limite)' : ''}
              </div>
              <div className="fan-list">
                {s.result.scoring!.items.map((it, i) => (
                  <div className="fan-row" key={i}>
                    <span>{it.name}{!it.qualifies ? ' *' : ''}</span>
                    <b>+{it.fan}</b>
                  </div>
                ))}
                <div className="fan-row">
                  <span>Pontos</span>
                  <b>{s.result.scoring!.points}</b>
                </div>
              </div>
              <p className="muted small">* fan de bônus não conta para o mínimo.</p>
            </>
          ) : (
            <p>Muro esgotado — ninguém pontua nesta mão.</p>
          )}
          <div className="modal-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                nextHandOrEnd(s);
                setSelectedTile(null);
                bump();
              }}
            >
              {s.handNumber >= rules.handsPerMatch ? 'Ver resultado final' : 'Próxima mão'}
            </button>
          </div>
        </Modal>
      )}

      {s.phase === 'match-over' && !matchOverAck && (
        <Modal title="Fim da partida 🏁" onClose={() => {}}>
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Jogador</th><th className="num">Pontos</th></tr>
            </thead>
            <tbody>
              {[...s.players]
                .sort((a, b) => b.score - a.score)
                .map((p, i) => (
                  <tr key={p.seat}>
                    <td>{i + 1}º</td>
                    <td>{p.name}{p.seat === 0 ? ' (você)' : ''}</td>
                    <td className="num">{p.score}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setMatchOverAck(true)}>
              Fechar
            </button>
            <button className="btn" onClick={newMatchNow}>
              Nova partida
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
