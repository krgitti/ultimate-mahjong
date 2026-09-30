import type { Settings } from '../../storage/profile';

export function SettingsScreen({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  return (
    <div>
      <h1 className="page-title">Configurações</h1>
      <p className="page-sub">Preferências salvas localmente e aplicadas na hora.</p>

      <div className="panel" style={{ marginBottom: '0.9rem' }}>
        <h3 className="panel-title">Interface & Áudio</h3>
        <div className="row" style={{ gap: '1.2rem' }}>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.sound}
              onChange={(e) => onChange({ sound: e.target.checked })}
            />
            Sons
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.highContrast}
              onChange={(e) => onChange({ highContrast: e.target.checked })}
            />
            Alto contraste
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.showTimer}
              onChange={(e) => onChange({ showTimer: e.target.checked })}
            />
            Mostrar cronômetro
          </label>
          <label className="field" style={{ minWidth: 200 }}>
            Escala da interface: {Math.round(settings.uiScale * 100)}%
            <input
              type="range"
              min={0.8}
              max={1.3}
              step={0.05}
              value={settings.uiScale}
              onChange={(e) => onChange({ uiScale: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '0.9rem' }}>
        <h3 className="panel-title">Mahjong Solitaire</h3>
        <label className="field" style={{ maxWidth: 380 }}>
          Regra de combinação de peças
          <select
            value={settings.solitaire.matchMode}
            onChange={(e) => onChange({ solitaire: { matchMode: e.target.value as 'classic' | 'strict' } })}
          >
            <option value="classic">Clássica (flor↔flor, estação↔estação)</option>
            <option value="strict">Estrita (apenas faces idênticas)</option>
          </select>
        </label>
        <p className="muted small" style={{ marginTop: 6 }}>
          Aplica-se a novos jogos. Na clássica, qualquer flor combina com qualquer flor (idem estações).
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">Mahjong Tradicional (Hong Kong)</h3>
        <div className="row" style={{ gap: '1.2rem' }}>
          <label className="field">
            Regras
            <select
              value={settings.traditional.rules}
              onChange={(e) =>
                onChange({ traditional: { ...settings.traditional, rules: e.target.value as 'classic' | 'chicken' } })
              }
            >
              <option value="classic">Clássica (mínimo 3 fan)</option>
              <option value="chicken">Chicken hand (mínimo 1 fan)</option>
            </select>
          </label>
          <label className="field">
            Duração da partida
            <select
              value={settings.traditional.hands}
              onChange={(e) =>
                onChange({ traditional: { ...settings.traditional, hands: Number(e.target.value) as 4 | 8 | 16 } })
              }
            >
              <option value={4}>4 mãos (rodada Leste)</option>
              <option value={8}>8 mãos (Leste + Sul)</option>
              <option value={16}>16 mãos (jogo completo)</option>
            </select>
          </label>
          <label className="field">
            Dificuldade dos bots
            <select
              value={settings.traditional.botDifficulty}
              onChange={(e) =>
                onChange({
                  traditional: { ...settings.traditional, botDifficulty: e.target.value as 'easy' | 'medium' | 'hard' },
                })
              }
            >
              <option value="easy">Fácil — descartes quase aleatórios</option>
              <option value="medium">Médio — minimiza shanten, sem defesa</option>
              <option value="hard">Difícil — shanten + segurança + valor</option>
            </select>
          </label>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Limitações por nível: <b>fácil</b> quebra formas úteis e não defende; <b>médio</b> joga a melhor forma mas
          ignora perigo e pontuação; <b>difícil</b> adiciona descarte seguro e noção de valor, sem defesa completa
          (betaori). Aplica-se à próxima partida.
        </p>
      </div>
    </div>
  );
}
