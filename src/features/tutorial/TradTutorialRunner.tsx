import { useEffect, useReducer, useRef, useState } from 'react';
import {
  drawTile,
  discard,
  resolveCalls,
  canTsumo,
  declareTsumo,
  seatWindOf,
  faceOf,
  type TradState,
  type Offer,
  type CallDecision,
} from '../../game-engine/traditional/engine';
import { createTutorialMatch, TRAD_STEPS, tradStepIndex, type TradTutContext } from './traditionalTutorial';
import { t } from '../../i18n';
import { faceName, type TileFace } from '../../game-engine/tiles/tiles';
import { TileFaceArt, TileBack } from '../../components/TileFace';
import { sfx } from '../../components/sound';
import { navigate } from '../../app/App';

const WIND_PT = ['', 'Leste', 'Sul', 'Oeste', 'Norte'];

export function TradTutorialRunner() {
  const stateRef = useRef<TradState | null>(null);
  if (stateRef.current === null) stateRef.current = createTutorialMatch();
  const ctxRef = useRef<TradTutContext>({ suitsClicked: new Set() });
  const humanDecisionRef = useRef<CallDecision | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const msgTimer = useRef<number | null>(null);

  const s = stateRef.current;
  const stepIdx = tradStepIndex(s, ctxRef.current);
  const step = TRAD_STEPS[stepIdx];
  const ended = s.phase === 'hand-over' || s.phase === 'match-over';

  const flash = (m: string) => {
    setMsg(m);
    if (msgTimer.current) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), 4600);
  };

  /* game loop */
  useEffect(() => {
    if (ended) return;
    if (s.phase === 'draw') {
      const human = s.players[s.current].isHuman;
      const t = window.setTimeout(() => {
        drawTile(s);
        if (!s.players[s.current].isHuman && s.phase === 'discard' && s.drawnTile !== null) {
          // tutorial bots always discard what they draw (tsumogiri) — fully scripted
          discard(s, s.drawnTile);
        }
        sfx.click();
        bump();
      }, human ? 500 : 1000);
      return () => window.clearTimeout(t);
    }
    if (s.phase === 'calls') {
      const t = window.setTimeout(() => {
        const nowStep = tradStepIndex(s, ctxRef.current);
        const res = resolveCalls(s, (seat) => {
          if (s.players[seat].isHuman) {
            if (nowStep === 2) {
              if (humanDecisionRef.current === null) return 'pending';
              const d = humanDecisionRef.current;
              humanDecisionRef.current = null;
              return d;
            }
            return { offer: null };
          }
          return { offer: null }; // tutorial bots never call
        });
        if (res === 'resolved') {
          sfx.call();
          bump();
        }
      }, 550);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const humanTurn = s.phase === 'discard' && s.current === 0 && !ended;
  const humanOffers: Offer[] = s.phase === 'calls' ? s.offers.filter((o) => o.seat === 0) : [];
  const showCallButtons = stepIdx === 2 && humanOffers.length > 0;
  const canWin = humanTurn && canTsumo(s, 0) && stepIdx >= 5;

  const onTileClick = (id: number) => {
    if (ended) return;
    const face = faceOf(s, id);
    if (stepIdx === 0) {
      if (face.suit === 'man' || face.suit === 'pin' || face.suit === 'sou') {
        ctxRef.current.suitsClicked.add(face.suit);
        setSelectedTile(id);
        sfx.select();
        flash(t('tut.trad.suitClick', { suit: faceName(face) }));
      } else {
        flash(t('tut.trad.honors'));
      }
      bump();
      return;
    }
    if (selectedTile === id && (stepIdx === 1 || stepIdx === 3)) {
      tryDiscard(id);
      return;
    }
    setSelectedTile(id);
    sfx.select();
  };

  const tryDiscard = (id: number) => {
    if (!humanTurn) return;
    const face = faceOf(s, id);
    if (stepIdx === 1 && !(face.suit === 'man' && face.rank === 1)) {
      flash(t('tut.trad.discard1err'));
      sfx.error();
      return;
    }
    if (stepIdx === 3 && !(face.suit === 'sou' && face.rank === 5)) {
      flash(t('tut.trad.discard5err'));
      sfx.error();
      return;
    }
    if (stepIdx !== 1 && stepIdx !== 3) {
      flash(t('tut.trad.noDiscard'));
      return;
    }
    if (discard(s, id)) {
      setSelectedTile(null);
      sfx.click();
      bump();
    }
  };

  const answer = (d: CallDecision) => {
    humanDecisionRef.current = d;
    sfx.call();
    bump();
  };

  const me = s.players[0];
  const sorted = [...me.hand].sort((a, b) => a - b);

  return (
    <div className="tut-layout">
      <aside className="panel tut-coach" aria-live="polite">
        <span className="tut-step-badge">
          {t('tut.stepOf', { a: Math.min(stepIdx + 1, TRAD_STEPS.length), b: TRAD_STEPS.length })}
        </span>
        <h3 style={{ margin: '0 0 0.35rem' }}>{t(step.title)}</h3>
        <p className="tut-text">{t(step.coach)}</p>
        {msg && <div className="tut-blocked-msg" role="alert">{msg}</div>}
        <div className="tut-progress" aria-hidden="true">
          {TRAD_STEPS.map((st, i) => (
            <span key={st.id} className={i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''} />
          ))}
        </div>
        {ended && s.result?.kind === 'win' && s.result.scoring && (
          <div className="fan-list" style={{ marginTop: '0.6rem' }}>
            {s.result.scoring.items.map((it, i) => (
              <div className="fan-row" key={i}>
                <span>{it.name}</span>
                <b>+{it.fan}</b>
              </div>
            ))}
            <div className="fan-row">
              <span>{t('tut.trad.pointsRow')}</span>
              <b>{s.result.scoring.points}</b>
            </div>
          </div>
        )}
        {stepIdx >= TRAD_STEPS.length - 1 && (
          <div className="row" style={{ marginTop: '0.7rem' }}>
            <button className="btn btn-primary" onClick={() => navigate('traditional')}>
              {t('tut.trad.playFull')}
            </button>
          </div>
        )}
      </aside>

      <section className="panel">
        <div className="row-between small muted">
          <span>{t('tut.trad.winds', { dom: WIND_PT[s.roundWind], seat: WIND_PT[seatWindOf(s, 0)] })}</span>
          <span>{t('tut.trad.wall', { n: s.wall.length })}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '0.5rem 0' }}>
          {[1, 2, 3].map((seat) => (
            <div key={seat} className={`seat-panel${s.current === seat ? ' active-seat' : ''}`}>
              <div className="seat-name">
                {s.players[seat].name}
                <span className="seat-wind">{WIND_PT[seatWindOf(s, seat)]}</span>
              </div>
              <div className="meld-row">
                {Array.from({ length: Math.min(s.players[seat].hand.length, 13) }).map((_, i) => (
                  <span key={i} className="mini-tile back"><TileBack /></span>
                ))}
              </div>
              {s.players[seat].discards.length > 0 && (
                <div className="pond">
                  {s.players[seat].discards.map((id) => (
                    <span key={id} className="mini-tile"><TileFaceArt face={faceOf(s, id)} /></span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="seat-panel">
            <div className="pond-label muted small">{t('tut.trad.yourDiscards')}</div>
            <div className="pond">
              {me.discards.map((id) => (
                <span key={id} className="mini-tile"><TileFaceArt face={faceOf(s, id)} /></span>
              ))}
            </div>
            {me.melds.length > 0 && (
              <div className="meld-row">
                {me.melds.map((m, i) => (
                  <span key={i} className="row" style={{ gap: 1 }}>
                    {m.tiles.map((t) => (
                      <span key={t} className="mini-tile"><TileFaceArt face={faceOf(s, t)} /></span>
                    ))}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="hand-row">
          {sorted.map((id) => (
            <button
              key={id}
              className={`hand-tile${selectedTile === id ? ' selected' : ''}${id === s.drawnTile ? ' drawn' : ''}`}
              style={{ width: 'calc(34px * var(--scale))', height: 'calc(46px * var(--scale))' }}
              aria-label={faceName(faceOf(s, id))}
              onClick={() => onTileClick(id)}
            >
              <span className="tile-face-inner"><TileFaceArt face={faceOf(s, id)} /></span>
            </button>
          ))}
        </div>

        <div className="action-bar" style={{ marginTop: 8 }}>
          {(stepIdx === 1 || stepIdx === 3) && (
            <button
              className="btn btn-primary btn-sm"
              disabled={!humanTurn || selectedTile === null}
              onClick={() => selectedTile !== null && tryDiscard(selectedTile)}
            >
              🀫 {t('tut.trad.discardBtn', { tile: stepIdx === 1 ? t('tiles.1man') : t('tiles.5sou') })}
            </button>
          )}
          {canWin && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                declareTsumo(s, 0);
                sfx.win();
                bump();
              }}
            >
              🏆 {t('tut.trad.tsumoBtn')}
            </button>
          )}
          {showCallButtons && (
            <>
              {humanOffers.some((o) => o.kind === 'ron') && (
                <button className="btn btn-primary btn-sm" onClick={() => answer({ offer: humanOffers.find((o) => o.kind === 'ron')! })}>
                  🏆 {t('tut.trad.ronBtn')}
                </button>
              )}
              {humanOffers.filter((o) => o.kind === 'chi').flatMap((o) =>
                (o.chiOptions ?? []).map((opt, i) => (
                  <button key={i} className="btn btn-sm" onClick={() => answer({ offer: o, chiChoice: opt })}>
                    {t('tut.trad.chowBtn', { tiles: (opt.map((id) => faceOf(s, id)) as TileFace[]).map((x) => faceName(x)).join(' + ') })}
                  </button>
                ))
              )}
            </>
          )}
          {s.phase === 'calls' && !showCallButtons && <span className="muted small">{t('tut.trad.deciding')}</span>}
          {ended && <span className="muted small">{t('tut.trad.ended')}</span>}
        </div>
      </section>
    </div>
  );
}
