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

  const onTileClick = (t: SolTile) => {
    if (finished) return;
    if (!isFree(t, s.tiles)) {
      setShakeId(t.id);
      window.setTimeout(() => setShakeId(null), 300);
      sfx.error();
      flash(
        stepIdx === 0
          ? 'Essa peça está BLOQUEADA: ou tem uma peça em cima, ou está presa entre vizinhas dos dois lados. Peças bloqueadas não podem ser selecionadas.'
          : 'Peça bloqueada — escolha uma peça livre (sem cobertura e com um lado aberto).'
      );
      return;
    }
    if (selectedId === null) {
      const err = step?.allow?.({ type: 'select', tileId: t.id }, s);
      if (err) {
        setShakeId(t.id);
        window.setTimeout(() => setShakeId(null), 300);
        sfx.error();
        flash(err);
        return;
      }
      ctxRef.current.selectedDistinctSuits.add(t.face.suit);
      const completesStep = !!step?.done(s, ctxRef.current);
      setSelectedId(t.id);
      sfx.select();
      if (completesStep) {
        // the step advanced with this very selection — don't carry the tile over
        setSelectedId(null);
        flash('Isso! Próximo passo.');
      }
      bump();
      return;
    }
    if (selectedId === t.id) {
      setSelectedId(null);
      return;
    }
    const res = attemptPair(s, selectedId, t.id);
    if (res.ok) {
      ctxRef.current.pairsRemoved += 1;
      ctxRef.current.lastPair = [selectedId, t.id];
      sfx.match();
      setSelectedId(null);
      setHintIds([]);
    } else {
      s.streak = 0;
      setShakeId(t.id);
      window.setTimeout(() => setShakeId(null), 300);
      sfx.error();
      flash('Essas duas peças não formam um par compatível (mesma face, ou flor com flor / estação com estação).');
      setSelectedId(t.id);
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
            <span className="tut-step-badge">Concluído 🎉</span>
            <p className="tut-text">
              Você limpou o tabuleiro! Resumo: <b>livre</b> = sem cobertura + um lado aberto; pares precisam de faces
              compatíveis; flores combinam entre si (e estações entre si); priorize remoções que liberam peças.
            </p>
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button className="btn btn-primary" onClick={() => navigate('solitaire')}>Jogar Solitaire</button>
              <button className="btn" onClick={restartTut}>Repetir tutorial</button>
            </div>
          </>
        ) : (
          <>
            <span className="tut-step-badge">
              Passo {stepIdx + 1} de {SOLITAIRE_STEPS.length}
            </span>
            <h3 style={{ margin: '0 0 0.35rem' }}>{step!.title}</h3>
            <p className="tut-text">{step!.coach}</p>
            {coachMsg && <div className="tut-blocked-msg" role="alert">{coachMsg}</div>}
            <div className="tut-progress" aria-hidden="true">
              {SOLITAIRE_STEPS.map((st, i) => (
                <span key={st.id} className={i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''} />
              ))}
            </div>
            <div className="row" style={{ marginTop: '0.7rem' }}>
              <button className="btn btn-sm" onClick={doHint}>💡 Dica</button>
              <button className="btn btn-sm" onClick={restartTut}>Recomeçar</button>
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
