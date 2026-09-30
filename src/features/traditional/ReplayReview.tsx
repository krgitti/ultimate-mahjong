import { useMemo, useState } from 'react';
import {
  replayMatch,
  faceOf,
  type ReplayRecord,
  type ReplayAction,
} from '../../game-engine/traditional/engine';
import type { Ruleset } from '../../game-engine/rules/ruleset';
import { faceName } from '../../game-engine/tiles/tiles';
import { TileFaceArt, TileBack } from '../../components/TileFace';

/* ------------------------------------------------------------------ */
/* Replay review UI (item 3): timeline with hand-by-hand navigation    */
/* ------------------------------------------------------------------ */

const SEAT_LABEL = ['Você (Leste)', 'Sul', 'Oeste', 'Norte'];

function actionLabel(a: ReplayAction, seatName: (s: number) => string): string {
  switch (a.t) {
    case 'draw':
      return 'compra';
    case 'discard':
      return `descarta #${a.tileId}`;
    case 'riichi':
      return `${seatName(a.seat)} declara riichi`;
    case 'tsumo':
      return `${seatName(a.seat)} TSUMO!`;
    case 'ankan':
      return `${seatName(a.seat)} kong fechado`;
    case 'addedkong':
      return `${seatName(a.seat)} adiciona kong`;
    case 'decision':
      return `${seatName(a.seat)}: ${a.kind}${a.chiChoice ? ` (${a.chiChoice.join(',')})` : ''}`;
    case 'rob':
      return `${seatName(a.seat)} ${a.yes ? 'rouba o kong' : 'não rouba'}`;
    case 'next-hand':
      return '— próxima mão —';
  }
}

export function ReplayReview({
  record,
  ruleset,
  onClose,
}: {
  record: ReplayRecord;
  ruleset: Ruleset;
  onClose: () => void;
}) {
  const [step, setStep] = useState(record.actions.length);
  const total = record.actions.length;

  /** indices where a new hand starts (right after each next-hand) */
  const handStarts = useMemo(() => {
    const starts = [0];
    record.actions.forEach((a, i) => {
      if (a.t === 'next-hand') starts.push(i + 1);
    });
    return starts;
  }, [record]);

  const st = useMemo(
    () => replayMatch(ruleset, { seed: record.seed, actions: record.actions.slice(0, step) }),
    [ruleset, record, step]
  );

  const seatName = (seat: number) => st.players[seat]?.name ?? SEAT_LABEL[seat];
  const atEnd = step >= total;

  const jumpHand = (dir: -1 | 1) => {
    if (dir === 1) {
      const next = handStarts.find((h) => h > step);
      setStep(next ?? total);
    } else {
      const prev = [...handStarts].reverse().find((h) => h < step);
      setStep(prev ?? 0);
    }
  };

  const timeline = record.actions.slice(Math.max(0, step - 4), step + 3);
  const timelineBase = Math.max(0, step - 4);

  return (
    <div className="replay-review" role="dialog" aria-label="Revisão da partida">
      <div className="replay-header">
        <strong>🎬 Revisão da partida</strong>
        <span className="replay-step">
          passo {step}/{total} · mão {st.handNumber}
          {st.phase === 'match-over' ? ' · fim' : ''}
        </span>
        <button className="btn btn-sm" onClick={onClose}>
          ✕ Fechar
        </button>
      </div>

      <div className="replay-board">
        {st.players.map((p) => (
          <div key={p.seat} className={`replay-seat${p.seat === 0 ? ' me' : ''}`}>
            <div className="replay-seat-head">
              <b>{seatName(p.seat)}</b>
              <span className="replay-meta">
                {p.hand.length} na mão{p.riichi ? ' · 🀫 riichi' : ''} · {p.score} pts
              </span>
            </div>
            <div className="replay-melds">
              {p.melds.map((m, i) => (
                <span key={i} className="replay-meld">
                  {m.tiles.map((id) => (
                    <span key={id} className="replay-tile">
                      {m.kind === 'ankan' ? <TileBack /> : <TileFaceArt face={faceOf(st, id)} />}
                    </span>
                  ))}
                </span>
              ))}
            </div>
            <div className="replay-pond">
              {p.discards.map((id) => (
                <span key={id} className="replay-tile">
                  <TileFaceArt face={faceOf(st, id)} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="replay-log" aria-label="Últimos eventos">
        {st.events.slice(-4).map((e, i) => (
          <span key={i} className="replay-event">
            {e.t}
            {e.tileId !== undefined ? ` ${faceName(faceOf(st, e.tileId))}` : ''}
          </span>
        ))}
      </div>

      <div className="replay-controls">
        <button className="btn btn-sm" onClick={() => setStep(0)} aria-label="Início">
          ⏮
        </button>
        <button className="btn btn-sm" onClick={() => jumpHand(-1)} aria-label="Mão anterior">
          ⏪ mão
        </button>
        <button className="btn btn-sm" onClick={() => setStep((x) => Math.max(0, x - 1))} aria-label="Voltar um passo">
          ◀
        </button>
        <input
          type="range"
          min={0}
          max={total}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
          aria-label="Linha do tempo"
          className="replay-slider"
        />
        <button className="btn btn-sm" onClick={() => setStep((x) => Math.min(total, x + 1))} aria-label="Avançar um passo">
          ▶
        </button>
        <button className="btn btn-sm" onClick={() => jumpHand(1)} aria-label="Próxima mão">
          mão ⏩
        </button>
        <button className="btn btn-sm" onClick={() => setStep(total)} aria-label="Fim">
          ⏭
        </button>
      </div>

      <ol className="replay-timeline" aria-label="Ações">
        {timeline.map((a, i) => {
          const idx = timelineBase + i;
          const label = actionLabel(a, seatName);
          const full =
            a.t === 'discard' ? `${seatName(st.current)} ${label} ${faceName(faceOf(st, a.tileId))}` : label;
          return (
            <li key={idx}>
              <button
                className={`timeline-item${idx === step - 1 ? ' current' : ''}${idx >= step ? ' future' : ''}`}
                onClick={() => setStep(idx + 1)}
              >
                <span className="timeline-n">{idx + 1}</span> {full}
              </button>
            </li>
          );
        })}
      </ol>
      {atEnd && <p className="replay-end">Fim da linha do tempo — você está no estado final da partida.</p>}
    </div>
  );
}
