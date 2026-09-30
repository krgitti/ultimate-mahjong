import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { SolitaireLaunch } from '../../app/App';
import {
  createSolitaire,
  attemptPair,
  undo,
  redo,
  hint as engineHint,
  isFree,
  remainingCount,
  shuffleRemaining,
  restart,
  serializeSolitaire,
  deserializeSolitaire,
  useHint,
  type SolitaireState,
  type SolTile,
} from '../../game-engine/solitaire/engine';
import { dealSolvable, remainingFaces } from '../../game-engine/solitaire/generator';
import { createRng } from '../../game-engine/tiles/rng';
import { listLayouts, layoutPositions, registerCustomLayout } from '../../game-engine/layouts';
import type { TileFace } from '../../game-engine/tiles/tiles';
import { store, KEYS } from '../../storage/storage';
import {
  loadSettings,
  loadCustomLayouts,
  recordSolitaireResult,
  saveCampaignProgress,
  saveChallengeResult,
  CAMPAIGN,
} from '../../storage/profile';
import { BoardView } from './BoardView';
import { Modal, fmtTime, useToast } from '../../components/ui';
import { sfx } from '../../components/sound';

interface SavedGame {
  json: string;
  launch: SolitaireLaunch | null;
  savedAt: number;
}

const ERROR_MSG: Record<string, string> = {
  'not-free': 'Essa peça está bloqueada. Uma peça livre não tem cobertura e tem um dos lados livres.',
  'not-matching': 'As peças não formam um par. Flores combinam entre si e estações entre si.',
  'same-tile': 'Escolha duas peças diferentes.',
  removed: 'Essa peça já foi removida.',
  'game-over': 'A partida terminou.',
};

export function SolitaireScreen({ launch }: { launch: SolitaireLaunch | null }) {
  const toast = useToast();
  const settings = loadSettings();

  const [game, setGame] = useState<SolitaireState | null>(null);
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hintIds, setHintIds] = useState<number[]>([]);
  const [removingIds, setRemovingIds] = useState<number[]>([]);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const [showNewGame, setShowNewGame] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [pickLayout, setPickLayout] = useState('turtle');
  const [pickSeed, setPickSeed] = useState('');
  const initialFacesRef = useRef<TileFace[]>([]);
  const hintTimerRef = useRef<number | null>(null);
  const recordedRef = useRef(false);

  const activeLaunch = launch;

  /* ---------- creation ---------- */

  const newGame = useCallback(
    (layoutId: string, seed: number, l: SolitaireLaunch | null) => {
      try {
        // make custom layouts available after reloads
        for (const c of loadCustomLayouts())
          registerCustomLayout({ id: c.id, name: c.name, source: 'custom', tiles: c.tiles });
        let positions;
        try {
          positions = layoutPositions(layoutId);
        } catch {
          toast(`Layout desconhecido: ${layoutId}`, true);
          return;
        }
        const rng = createRng(seed);
        const deal = dealSolvable(positions, rng);
        const st = createSolitaire({
          layoutId,
          seed,
          faces: deal.faces,
          positions,
          matchMode: settings.solitaire.matchMode,
        });
        initialFacesRef.current = st.tiles.map((t) => ({ ...t.face }));
        recordedRef.current = false;
        setTimeUp(false);
        setSelectedId(null);
        setHintIds([]);
        setGame(st);
        store.write<SavedGame>(KEYS.solitaireSave, {
          json: serializeSolitaire(st),
          launch: l,
          savedAt: Date.now(),
        });
      } catch (e) {
        toast(`Não foi possível gerar o tabuleiro: ${(e as Error).message}`, true);
      }
    },
    [settings.solitaire.matchMode, toast]
  );

  /* ---------- boot: restore saved game or start default ---------- */
  useEffect(() => {
    // editor "play" event (custom layouts)
    const onPlayLayout = (e: Event) => {
      const detail = (e as CustomEvent<{ layoutId: string }>).detail;
      if (detail?.layoutId) newGame(detail.layoutId, Date.now() >>> 0, null);
    };
    window.addEventListener('umo:play-layout', onPlayLayout);
    if (game) return () => window.removeEventListener('umo:play-layout', onPlayLayout);
    if (activeLaunch) {
      const layoutId = activeLaunch.layoutId ?? 'turtle';
      const seed = activeLaunch.seed ?? (Date.now() >>> 0);
      newGame(layoutId, seed, activeLaunch);
      return () => window.removeEventListener('umo:play-layout', onPlayLayout);
    }
    const saved = store.read<SavedGame | null>(KEYS.solitaireSave, null);
    if (saved) {
      try {
        const st = deserializeSolitaire(saved.json);
        initialFacesRef.current = st.tiles.map((t) => ({ ...t.face }));
        recordedRef.current = false;
        setGame(st);
        toast('Partida anterior restaurada.');
        return () => window.removeEventListener('umo:play-layout', onPlayLayout);
      } catch {
        store.clear(KEYS.solitaireSave);
      }
    }
    newGame('turtle', Date.now() >>> 0, null);
    return () => window.removeEventListener('umo:play-layout', onPlayLayout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- timer ---------- */
  useEffect(() => {
    if (!game || game.status !== 'playing' || timeUp || showNewGame) return;
    const id = window.setInterval(() => {
      game.elapsedMs += 1000;
      const limit = activeLaunch?.timeLimitMs;
      if (limit && game.elapsedMs >= limit && !recordedRef.current) {
        setTimeUp(true);
        sfx.lose();
        finish(false);
      }
      bump();
    }, 1000);
    return () => window.clearInterval(id);
  }, [game, timeUp, showNewGame, activeLaunch?.timeLimitMs]);

  /* ---------- persistence on change (version tracks in-place engine mutations) ---------- */
  useEffect(() => {
    if (!game) return;
    store.write<SavedGame>(KEYS.solitaireSave, {
      json: serializeSolitaire(game),
      launch: activeLaunch ?? null,
      savedAt: Date.now(),
    });
  }, [game, version, activeLaunch]);

  /* ---------- results ---------- */

  const finish = useCallback(
    (won: boolean) => {
      if (!game || recordedRef.current) return;
      recordedRef.current = true;
      recordSolitaireResult({
        won,
        score: game.score,
        pairs: game.moves,
        ms: game.elapsedMs,
        hints: game.hintsUsed,
        shuffles: game.shufflesUsed,
      });
      if (won) {
        if (activeLaunch?.levelId) {
          const level = CAMPAIGN.find((l) => l.id === activeLaunch.levelId);
          if (level) {
            let stars = 1;
            if (game.elapsedMs <= level.targetMs) stars += 1;
            if (game.hintsUsed === 0) stars += 1;
            saveCampaignProgress(level.id, stars, game.elapsedMs);
          }
        }
        if (activeLaunch?.challengeId) {
          saveChallengeResult(activeLaunch.challengeId, game.elapsedMs, game.score);
        }
        sfx.win();
      } else {
        sfx.lose();
      }
    },
    [game, activeLaunch]
  );

  useEffect(() => {
    if (!game || recordedRef.current) return;
    if (game.status === 'won') finish(true);
    else if (game.status === 'deadlock') finish(false);
  }, [game?.status, game, finish]);

  /* ---------- actions ---------- */

  const onTileClick = (t: SolTile) => {
    if (!game || game.status !== 'playing' || timeUp) return;
    if (t.removed) return;
    if (!isFree(t, game.tiles)) {
      setShakeId(t.id);
      window.setTimeout(() => setShakeId(null), 300);
      toast(ERROR_MSG['not-free'], true);
      sfx.error();
      return;
    }
    if (selectedId === null) {
      setSelectedId(t.id);
      sfx.select();
      return;
    }
    if (selectedId === t.id) {
      setSelectedId(null);
      return;
    }
    const res = attemptPair(game, selectedId, t.id);
    if (res.ok) {
      sfx.match();
      setRemovingIds([selectedId, t.id]);
      window.setTimeout(() => setRemovingIds([]), 280);
      setSelectedId(null);
      setHintIds([]);
    } else {
      if (res.error === 'not-matching') game.streak = 0;
      setShakeId(t.id);
      window.setTimeout(() => setShakeId(null), 300);
      toast(ERROR_MSG[res.error ?? 'not-matching'], true);
      sfx.error();
      setSelectedId(t.id);
    }
    bump();
  };

  const doHint = useCallback(() => {
    if (!game || game.status !== 'playing') return;
    const max = activeLaunch?.maxHints ?? null;
    if (max !== null && game.hintsUsed >= max) {
      toast(`Limite de ${max} dica(s) neste modo.`, true);
      return;
    }
    const h = engineHint(game);
    if (!h) {
      toast('Nenhum movimento disponível.');
      return;
    }
    useHint(game);
    setHintIds([h.a.id, h.b.id]);
    if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHintIds([]), 2600);
    sfx.click();
    bump();
  }, [game, activeLaunch?.maxHints, toast]);

  const doShuffle = useCallback(() => {
    if (!game || game.status !== 'playing') return;
    const max = activeLaunch?.maxShuffles ?? null;
    if (max !== null && game.shufflesUsed >= max) {
      toast(`Limite de ${max} embaralhamento(s) neste modo.`, true);
      return;
    }
    const pool = remainingFaces(game.tiles, game.matchMode);
    const rng = createRng((game.seed ^ ((game.shufflesUsed + 1) * 0x9e3779b9)) >>> 0);
    // deterministic shuffle of the pool
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    shuffleRemaining(game, pool);
    setSelectedId(null);
    setHintIds([]);
    toast('Peças restantes embaralhadas.');
    sfx.click();
    bump();
  }, [game, activeLaunch?.maxShuffles, toast]);

  const doUndo = useCallback(() => {
    if (!game) return;
    undo(game);
    setSelectedId(null);
    sfx.click();
    bump();
  }, [game]);

  const doRedo = useCallback(() => {
    if (!game) return;
    redo(game);
    setSelectedId(null);
    sfx.click();
    bump();
  }, [game]);

  const doRestart = useCallback(() => {
    if (!game) return;
    restart(game, initialFacesRef.current);
    recordedRef.current = false;
    setTimeUp(false);
    setSelectedId(null);
    toast('Partida reiniciada com as mesmas peças.');
    bump();
  }, [game, toast]);

  /* keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showNewGame) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      switch (e.key.toLowerCase()) {
        case 'u': doUndo(); break;
        case 'r': doRedo(); break;
        case 'h': doHint(); break;
        case 's': doShuffle(); break;
        case 'n': setShowNewGame(true); break;
        case 'escape': setSelectedId(null); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo, doHint, doShuffle, showNewGame]);

  /* ---------- render ---------- */

  const layouts = useMemo(() => {
    for (const c of loadCustomLayouts())
      registerCustomLayout({ id: c.id, name: c.name, source: 'custom', tiles: c.tiles });
    const all = listLayouts();
    return all.filter((l, i, arr) => arr.findIndex((x) => x.id === l.id) === i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.layoutId]);

  if (!game) return <p className="muted">Gerando tabuleiro…</p>;

  const remaining = remainingCount(game);
  const pairsLeft = remaining / 2;
  const limits: string[] = [];
  if (activeLaunch?.timeLimitMs) limits.push(`Tempo: ${fmtTime(activeLaunch.timeLimitMs)}`);
  if (activeLaunch?.maxHints !== null && activeLaunch?.maxHints !== undefined)
    limits.push(`Dicas: ${game.hintsUsed}/${activeLaunch.maxHints}`);
  if (activeLaunch?.maxShuffles !== null && activeLaunch?.maxShuffles !== undefined)
    limits.push(`Embaralhar: ${game.shufflesUsed}/${activeLaunch.maxShuffles}`);

  return (
    <div className="solitaire-screen">
      <div className="sol-toolbar" role="toolbar" aria-label="Controles da partida">
        <button className="btn btn-sm" onClick={() => setShowNewGame(true)} title="Novo jogo (N)">🗎 Novo</button>
        <button className="btn btn-sm" onClick={doUndo} disabled={game.history.length === 0} title="Desfazer (U)">↩ Desfazer</button>
        <button className="btn btn-sm" onClick={doRedo} disabled={game.future.length === 0} title="Refazer (R)">↪ Refazer</button>
        <button className="btn btn-sm" onClick={doHint} title="Dica (H)">💡 Dica</button>
        <button className="btn btn-sm" onClick={doShuffle} title="Embaralhar (S)">🔀 Embaralhar</button>
        <button className="btn btn-sm" onClick={doRestart} title="Reiniciar com as mesmas peças">⟳ Reiniciar</button>
        <div className="sol-status" aria-live="polite">
          <span>Pares: <b>{pairsLeft}</b></span>
          <span>Pontos: <b>{game.score}</b></span>
          {settings.showTimer && <span>Tempo: <b>{fmtTime(game.elapsedMs)}</b></span>}
          <span>Jogadas: <b>{game.moves}</b></span>
          {limits.length > 0 && <span className="small">{limits.join(' · ')}</span>}
        </div>
      </div>

      <BoardView
        state={game}
        selectedId={selectedId}
        hintIds={hintIds}
        removingIds={removingIds}
        shakeId={shakeId}
        onTileClick={onTileClick}
      />

      {showNewGame && (
        <Modal title="Novo jogo" onClose={() => setShowNewGame(false)} wide>
          <div className="row" style={{ marginBottom: '0.7rem' }}>
            <label className="field">
              Semente (opcional)
              <input
                type="number"
                value={pickSeed}
                placeholder="aleatória"
                onChange={(e) => setPickSeed(e.target.value)}
                style={{ width: 140 }}
              />
            </label>
            <span className="muted small">Mesma semente + layout = mesmo tabuleiro (útil para reproduzir partidas).</span>
          </div>
          <div className="layout-picker" role="group" aria-label="Escolha de layout">
            {layouts.map((l) => (
              <button
                key={l.id}
                className="layout-option"
                aria-pressed={pickLayout === l.id}
                onClick={() => setPickLayout(l.id)}
              >
                <div className="lo-name">{l.name}</div>
                <div className="lo-meta">{l.count} peças · {l.layers} camada(s)</div>
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowNewGame(false)}>Cancelar</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setShowNewGame(false);
                const seed = pickSeed ? Number(pickSeed) >>> 0 : Date.now() >>> 0;
                newGame(pickLayout, seed, null);
              }}
            >
              Jogar
            </button>
          </div>
        </Modal>
      )}

      {game.status === 'won' && (
        <Modal title="Vitória! 🎉" onClose={() => {}}>
          <p>
            Tabuleiro limpo em <b>{fmtTime(game.elapsedMs)}</b> com <b>{game.score}</b> pontos
            ({game.hintsUsed} dica(s), {game.shufflesUsed} embaralhamento(s)).
          </p>
          {activeLaunch?.levelId && <p className="muted">Progresso da campanha registrado.</p>}
          {activeLaunch?.challengeId && <p className="muted">Desafio concluído!</p>}
          <div className="modal-actions">
            <button className="btn" onClick={doRestart}>Jogar novamente</button>
            <button className="btn btn-primary" onClick={() => setShowNewGame(true)}>Novo tabuleiro</button>
          </div>
        </Modal>
      )}

      {(game.status === 'deadlock' || timeUp) && (
        <Modal title={timeUp ? 'Tempo esgotado ⏰' : 'Sem movimentos 😞'} onClose={() => {}}>
          <p>
            {timeUp
              ? 'O limite de tempo desta sessão terminou.'
              : 'Nenhum par livre disponível. Você pode embaralhar, desfazer a última jogada ou reiniciar.'}
          </p>
          <div className="modal-actions">
            {game.history.length > 0 && <button className="btn" onClick={doUndo}>Desfazer</button>}
            {!timeUp && (
              <button className="btn" onClick={doShuffle}>Embaralhar</button>
            )}
            <button className="btn" onClick={doRestart}>Reiniciar</button>
            <button className="btn btn-primary" onClick={() => setShowNewGame(true)}>Novo jogo</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
