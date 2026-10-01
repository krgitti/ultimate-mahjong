import { useMemo, useReducer, useRef, useState } from 'react';
import {
  createSolitaire,
  attemptPair,
  hint as engineHint,
  isFree,
  useHint,
  type SolitaireState,
  type SolTile,
} from '../../game-engine/solitaire/engine';
import { SOLITAIRE_STEPS, TUT_FACES, TUT_POSITIONS, newTutContext, tutorialStepIndex, type TutContext } from './solitaireTutorial';
import { BoardView } from '../solitaire/BoardView';
import { sfx } from '../../components/sound';
import { navigate } from '../../app/App';
import { t } from '../../i18n';

export function SolitaireTutorialRunner() {
  const gameRef = useRef<SolitaireState>(
    createSolitaire({
      layoutId: 'tutorial-mini',
      seed: 1,
      faces: TUT_FACES,
      positions: TUT_POSITIONS,
    })
  );
  const ctxRef = useRef<TutContext>(newTutContext());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hintIds, setHintIds] = useState<number[]>([]);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const [coachMsg, setCoachMsg] = useState<string | null>(null);
  const msgTimer = useRef<number | null>(null);

  const s = gameRef.current;
  const stepIdx = tutorialStepIndex(ctxRef.current, s);
  const finished = stepIdx >= SOLITAIRE_STEPS.length;
  const step = finished ? null : SOLITAIRE_STEPS[stepIdx];

  const highlights = useMemo(() => {
    if (!step?.highlight) return [];
    return step.highlight(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id, s.tiles.filter((t) => t.removed).length]);

  const flash = (msg: string) => {
    setCoachMsg(msg);
    if (msgTimer.current) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setCoachMsg(null), 4200);
  };

  const onTileClick = (tile: SolTile) => {
    if (finished) return;
    if (!isFree(tile, s.tiles)) {
      setShakeId(tile.id);
      window.setTimeout(() => setShakeId(null), 300);
      sfx.error();
      flash(t(stepIdx === 0 ? 'tut.sol.blocked0' : 'tut.sol.blocked'));
      return;
    }
    if (selectedId === null) {
      const err = step?.allow?.({ type: 'select', tileId: tile.id }, s);
      if (err) {
        setShakeId(tile.id);
        window.setTimeout(() => setShakeId(null), 300);
        sfx.error();
        flash(t(err));
        return;
      }
      ctxRef.current.selectedDistinctSuits.add(tile.face.suit);
      const completesStep = !!step?.done(s, ctxRef.current);
      setSelectedId(tile.id);
      sfx.select();
      if (completesStep) {
        // the step advanced with this very selection — don't carry the tile over
        setSelectedId(null);
        flash(t('tut.sol.next'));
      }
      bump();
      return;
    }
    if (selectedId === tile.id) {
      setSelectedId(null);
      return;
    }
    const res = attemptPair(s, selectedId, tile.id);
    if (res.ok) {
      ctxRef.current.pairsRemoved += 1;
      ctxRef.current.lastPair = [selectedId, tile.id];
      sfx.match();
      setSelectedId(null);
      setHintIds([]);
    } else {
      s.streak = 0;
      setShakeId(tile.id);
      window.setTimeout(() => setShakeId(null), 300);
      sfx.error();
      flash(t('tut.sol.notPair'));
      setSelectedId(tile.id);
    }
    bump();
  };

  const doHint = () => {
    const h = engineHint(s);
    if (!h) return;
    useHint(s);
    setHintIds([h.a.id, h.b.id]);
    window.setTimeout(() => setHintIds([]), 2600);
    bump();
  };

  const restartTut = () => {
    gameRef.current = createSolitaire({
      layoutId: 'tutorial-mini',
      seed: 1,
      faces: TUT_FACES,
      positions: TUT_POSITIONS,
    });
    ctxRef.current = newTutContext();
    setSelectedId(null);
    setCoachMsg(null);
    bump();
  };

  return (
    <div className="tut-layout">
      <aside className="panel tut-coach" aria-live="polite">
        {finished ? (
          <>
            <span className="tut-step-badge">{t('tut.doneBadge')}</span>
            <p className="tut-text">{t('tut.sol.doneText')}</p>
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button className="btn btn-primary" onClick={() => navigate('solitaire')}>{t('tut.sol.play')}</button>
              <button className="btn" onClick={restartTut}>{t('tut.repeat')}</button>
            </div>
          </>
        ) : (
          <>
            <span className="tut-step-badge">
              {t('tut.stepOf', { a: stepIdx + 1, b: SOLITAIRE_STEPS.length })}
            </span>
            <h3 style={{ margin: '0 0 0.35rem' }}>{t(step!.title)}</h3>
            <p className="tut-text">{t(step!.coach)}</p>
            {coachMsg && <div className="tut-blocked-msg" role="alert">{coachMsg}</div>}
            <div className="tut-progress" aria-hidden="true">
              {SOLITAIRE_STEPS.map((st, i) => (
                <span key={st.id} className={i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''} />
              ))}
            </div>
            <div className="row" style={{ marginTop: '0.7rem' }}>
              <button className="btn btn-sm" onClick={doHint}>💡 {t('sol.hint')}</button>
              <button className="btn btn-sm" onClick={restartTut}>{t('tut.restart')}</button>
            </div>
          </>
        )}
      </aside>
      <section className="panel" style={{ minHeight: 420, display: 'flex' }}>
        <BoardView
          state={s}
          selectedId={selectedId}
          hintIds={hintIds.length ? hintIds : highlights}
          removingIds={[]}
          shakeId={shakeId}
          onTileClick={onTileClick}
        />
      </section>
    </div>
  );
}
