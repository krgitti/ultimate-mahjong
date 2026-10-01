import { loadStats } from '../../storage/profile';
import { fmtTime } from '../../components/ui';
import { t } from '../../i18n';

export function StatsScreen() {
  const st = loadStats();
  const s = st.solitaire;
  const tr = st.traditional; // renomeado: t() é o tradutor (item 8.5)
  const winRate = s.gamesPlayed ? Math.round((s.gamesWon / s.gamesPlayed) * 100) : 0;

  return (
    <div>
      <h1 className="page-title">{t('stats.title')}</h1>
      <p className="page-sub">{t('stats.sub')}</p>

      <div className="panel" style={{ marginBottom: '0.9rem' }}>
        <h3 className="panel-title">{t('set.solitaire')}</h3>
        <div className="stat-grid">
          <div className="stat"><div className="stat-label">{t('stats.gamesPlayed')}</div><div className="stat-value">{s.gamesPlayed}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.winsLabel')}</div><div className="stat-value">{s.gamesWon}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.winRate')}</div><div className="stat-value">{winRate}%</div></div>
          <div className="stat"><div className="stat-label">{t('stats.deadlocks')}</div><div className="stat-value">{s.deadlocks}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.bestScore')}</div><div className="stat-value">{s.bestScore}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.fastestWin')}</div><div className="stat-value">{s.fastestWinMs != null ? fmtTime(s.fastestWinMs) : '—'}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.pairsRemoved')}</div><div className="stat-value">{s.totalPairs}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.totalTime')}</div><div className="stat-value">{fmtTime(s.totalMs)}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.hintsUsed')}</div><div className="stat-value">{s.hintsUsed}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.shuffles')}</div><div className="stat-value">{s.shufflesUsed}</div></div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">{t('set.traditional')} (Hong Kong)</h3>
        <div className="stat-grid">
          <div className="stat"><div className="stat-label">{t('stats.handsPlayed')}</div><div className="stat-value">{tr.handsPlayed}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.handsWon')}</div><div className="stat-value">{tr.handsWon}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.ronWins')}</div><div className="stat-value">{tr.ronWins}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.tsumoWins')}</div><div className="stat-value">{tr.tsumoWins}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.bestFan')}</div><div className="stat-value">{tr.bestFan}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.bestPoints')}</div><div className="stat-value">{tr.bestPoints}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.matchesPlayed')}</div><div className="stat-value">{tr.matchesPlayed}</div></div>
          <div className="stat"><div className="stat-label">{t('stats.matchesWon')}</div><div className="stat-value">{tr.matchesWon}</div></div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: '0.9rem' }}>
        <h3 className="panel-title">{t('stats.byRuleset')}</h3>
        {(['classic', 'riichi', 'mcr'] as const).map((k) => {
          const v = tr.byRuleset[k];
          const rate = v.handsPlayed ? Math.round((v.handsWon / v.handsPlayed) * 100) : 0;
          const label = k === 'classic' ? t('stats.variantHK') : k === 'riichi' ? t('stats.variantRiichi') : t('stats.variantMCR');
          return (
            <div key={k} style={{ marginBottom: 10 }}>
              <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{label}</b>
                <span className="muted">{rate}%</span>
              </div>
              <div
                role="img"
                aria-label={`${label}: ${v.handsWon} de ${v.handsPlayed} mãos vencidas`}
                style={{ height: 8, background: 'rgba(127,127,127,0.25)', borderRadius: 4, overflow: 'hidden' }}
              >
                <div style={{ width: `${rate}%`, height: '100%', background: 'var(--gold, #d4af37)', borderRadius: 4 }} />
              </div>
              <div className="muted small">
                {t('stats.handsPlayed')}: {v.handsPlayed} · {t('stats.handsWon')}: {v.handsWon} ·{' '}
                {t('stats.matchesPlayed')}: {v.matchesPlayed} · {t('stats.matchesWon')}: {v.matchesWon} ·{' '}
                {t('stats.bestFan')}: {v.bestFan}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
