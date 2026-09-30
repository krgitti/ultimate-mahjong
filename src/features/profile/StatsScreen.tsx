import { loadStats } from '../../storage/profile';
import { fmtTime } from '../../components/ui';

export function StatsScreen() {
  const st = loadStats();
  const s = st.solitaire;
  const t = st.traditional;
  const winRate = s.gamesPlayed ? Math.round((s.gamesWon / s.gamesPlayed) * 100) : 0;

  return (
    <div>
      <h1 className="page-title">Estatísticas</h1>
      <p className="page-sub">Tudo fica salvo localmente no seu navegador (nenhum dado sai do dispositivo).</p>

      <div className="panel" style={{ marginBottom: '0.9rem' }}>
        <h3 className="panel-title">Mahjong Solitaire</h3>
        <div className="stat-grid">
          <div className="stat"><div className="stat-label">Partidas</div><div className="stat-value">{s.gamesPlayed}</div></div>
          <div className="stat"><div className="stat-label">Vitórias</div><div className="stat-value">{s.gamesWon}</div></div>
          <div className="stat"><div className="stat-label">Aproveitamento</div><div className="stat-value">{winRate}%</div></div>
          <div className="stat"><div className="stat-label">Bloqueios</div><div className="stat-value">{s.deadlocks}</div></div>
          <div className="stat"><div className="stat-label">Melhor pontuação</div><div className="stat-value">{s.bestScore}</div></div>
          <div className="stat"><div className="stat-label">Vitória mais rápida</div><div className="stat-value">{s.fastestWinMs != null ? fmtTime(s.fastestWinMs) : '—'}</div></div>
          <div className="stat"><div className="stat-label">Pares removidos</div><div className="stat-value">{s.totalPairs}</div></div>
          <div className="stat"><div className="stat-label">Tempo total</div><div className="stat-value">{fmtTime(s.totalMs)}</div></div>
          <div className="stat"><div className="stat-label">Dicas usadas</div><div className="stat-value">{s.hintsUsed}</div></div>
          <div className="stat"><div className="stat-label">Embaralhamentos</div><div className="stat-value">{s.shufflesUsed}</div></div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Mahjong Tradicional (Hong Kong)</h3>
        <div className="stat-grid">
          <div className="stat"><div className="stat-label">Mãos jogadas</div><div className="stat-value">{t.handsPlayed}</div></div>
          <div className="stat"><div className="stat-label">Mãos vencidas</div><div className="stat-value">{t.handsWon}</div></div>
          <div className="stat"><div className="stat-label">Vitórias por Ron</div><div className="stat-value">{t.ronWins}</div></div>
          <div className="stat"><div className="stat-label">Vitórias por Tsumo</div><div className="stat-value">{t.tsumoWins}</div></div>
          <div className="stat"><div className="stat-label">Melhor mão (fan)</div><div className="stat-value">{t.bestFan}</div></div>
          <div className="stat"><div className="stat-label">Melhor mão (pontos)</div><div className="stat-value">{t.bestPoints}</div></div>
          <div className="stat"><div className="stat-label">Partidas</div><div className="stat-value">{t.matchesPlayed}</div></div>
          <div className="stat"><div className="stat-label">Partidas vencidas</div><div className="stat-value">{t.matchesWon}</div></div>
        </div>
      </div>
    </div>
  );
}
