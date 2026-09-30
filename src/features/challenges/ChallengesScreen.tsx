import { useMemo } from 'react';
import type { SolitaireLaunch } from '../../app/App';
import { CAMPAIGN, CHALLENGES, loadCampaign, loadChallengeResults } from '../../storage/profile';
import { Stars, fmtTime } from '../../components/ui';

export function ChallengesScreen({ onLaunch }: { onLaunch: (l: SolitaireLaunch) => void }) {
  const campaign = loadCampaign();
  const results = loadChallengeResults();
  const stars = useMemo(() => Object.values(campaign).reduce((n, c) => n + (c?.stars ?? 0), 0), [campaign]);

  return (
    <div>
      <h1 className="page-title">Campanha & Desafios</h1>
      <p className="page-sub">
        A campanha tem ordem sugerida e restrições crescentes (dicas, embaralhamentos, tempo). Desafios usam{' '}
        <strong>sementes fixas</strong>: o mesmo tabuleiro para todos — compare seu tempo. Estrelas: ★ vencer,
        ★★ dentro do tempo-alvo, ★★★ sem usar dicas.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>Campanha — {stars}/{CAMPAIGN.length * 3} ★</h2>
      <div className="grid-cards">
        {CAMPAIGN.map((level) => {
          const prog = campaign[level.id];
          const done = (prog?.stars ?? 0) > 0;
          return (
            <button
              key={level.id}
              className={`card${done ? ' done' : ''}`}
              onClick={() =>
                onLaunch({
                  layoutId: level.layoutId,
                  levelId: level.id,
                  seed: Date.now() >>> 0, // fresh board per attempt; challenges below are the deterministic ones
                  timeLimitMs: level.timeLimitMs,
                  maxHints: level.maxHints,
                  maxShuffles: level.maxShuffles,
                })
              }
            >
              <span className="card-name">
                {level.id}. {level.name}
              </span>
              <span className="card-desc">
                Layout: {level.layoutId} · {level.timeLimitMs ? `limite ${fmtTime(level.timeLimitMs)}` : 'sem tempo'} ·{' '}
                {level.maxHints === null ? 'dicas livres' : `${level.maxHints} dica(s)`} ·{' '}
                {level.maxShuffles === null ? 'embaralhar livre' : `${level.maxShuffles} embaralhamento(s)`}
              </span>
              <span className="card-meta">
                {prog ? <Stars n={prog.stars} /> : <Stars n={0} />}{' '}
                {prog?.bestMs != null && <span className="muted">· melhor {fmtTime(prog.bestMs)}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <h2 style={{ fontSize: '1.1rem', marginTop: '1.2rem' }}>Desafios determinísticos</h2>
      <div className="grid-cards">
        {CHALLENGES.map((ch) => {
          const r = results[ch.id];
          return (
            <button
              key={ch.id}
              className={`card challenge-card${r?.completed ? ' done' : ''}`}
              onClick={() =>
                onLaunch({
                  layoutId: ch.layoutId,
                  challengeId: ch.id,
                  seed: ch.seed,
                  timeLimitMs: ch.timeLimitMs,
                  maxHints: ch.maxHints,
                  maxShuffles: ch.maxShuffles,
                })
              }
            >
              <span className="card-name">{ch.name}</span>
              <span className="card-desc">{ch.description}</span>
              <span className="card-meta">
                {r?.completed ? `✔ concluído · ${r.bestMs != null ? fmtTime(r.bestMs) : '-'} · ${r.bestScore} pts` : 'não concluído'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
