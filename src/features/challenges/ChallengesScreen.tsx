import { useMemo } from 'react';
import type { SolitaireLaunch } from '../../app/App';
import { CAMPAIGN, CHALLENGES, loadCampaign, loadChallengeResults } from '../../storage/profile';
import { Stars, fmtTime } from '../../components/ui';
import { t } from '../../i18n';

export function ChallengesScreen({ onLaunch }: { onLaunch: (l: SolitaireLaunch) => void }) {
  const campaign = loadCampaign();
  const results = loadChallengeResults();
  const stars = useMemo(() => Object.values(campaign).reduce((n, c) => n + (c?.stars ?? 0), 0), [campaign]);

  return (
    <div>
      <h1 className="page-title">{t('ch.title')}</h1>
      <p className="page-sub">{t('ch.sub')}</p>

      <h2 style={{ fontSize: '1.1rem' }}>{t('ch.campaign', { n: stars, m: CAMPAIGN.length * 3 })}</h2>
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
                {level.id}. {t(`camp.${level.id}`)}
              </span>
              <span className="card-desc">
                {t('ch.layout', { id: level.layoutId })} ·{' '}
                {level.timeLimitMs ? t('ch.limit', { time: fmtTime(level.timeLimitMs) }) : t('ch.noTime')} ·{' '}
                {level.maxHints === null ? t('ch.freeHints') : t('ch.nHints', { n: level.maxHints })} ·{' '}
                {level.maxShuffles === null ? t('ch.freeShuffles') : t('ch.nShuffles', { n: level.maxShuffles })}
              </span>
              <span className="card-meta">
                {prog ? <Stars n={prog.stars} /> : <Stars n={0} />}{' '}
                {prog?.bestMs != null && <span className="muted">{t('ch.best', { time: fmtTime(prog.bestMs) })}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <h2 style={{ fontSize: '1.1rem', marginTop: '1.2rem' }}>{t('ch.deterministic')}</h2>
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
              <span className="card-name">{t(`chn.${ch.id}.n`)}</span>
              <span className="card-desc">{t(`chn.${ch.id}.d`)}</span>
              <span className="card-meta">
                {r?.completed
                  ? t('ch.doneMeta', { time: r.bestMs != null ? fmtTime(r.bestMs) : '-', score: r.bestScore })
                  : t('ch.notDone')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
