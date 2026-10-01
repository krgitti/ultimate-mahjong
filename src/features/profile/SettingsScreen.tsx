import type { Settings } from '../../storage/profile';
import { t, LANG_LABELS, type Lang } from '../../i18n';

/**
 * Configurações (tela traduzida — item 8.5). As descrições longas das house
 * rules MCR permanecem em PT (documentado no README).
 */
export function SettingsScreen({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  return (
    <div>
      <h1 className="page-title">{t('set.title')}</h1>
      <p className="page-sub">{t('set.pageSub')}</p>

      <div className="panel" style={{ marginBottom: '0.9rem' }}>
        <h3 className="panel-title">{t('set.interface')}</h3>
        <div className="row" style={{ gap: '1.2rem' }}>
          <label className="field" style={{ minWidth: 160 }}>
            {t('set.language')}
            <select
              value={settings.language}
              onChange={(e) => onChange({ language: e.target.value as Lang })}
            >
              {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
                <option key={l} value={l}>
                  {LANG_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.sound}
              onChange={(e) => onChange({ sound: e.target.checked })}
            />
            {t('set.sounds')}
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.highContrast}
              onChange={(e) => onChange({ highContrast: e.target.checked })}
            />
            {t('set.contrast')}
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.showTimer}
              onChange={(e) => onChange({ showTimer: e.target.checked })}
            />
            {t('set.showTimer')}
          </label>
          <label className="field" style={{ minWidth: 200 }}>
            {t('set.uiScale')}: {Math.round(settings.uiScale * 100)}%
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
        <h3 className="panel-title">{t('set.solitaire')}</h3>
        <label className="field" style={{ maxWidth: 380 }}>
          {t('set.matchRule')}
          <select
            value={settings.solitaire.matchMode}
            onChange={(e) => onChange({ solitaire: { matchMode: e.target.value as 'classic' | 'strict' } })}
          >
            <option value="classic">{t('set.matchClassic')}</option>
            <option value="strict">{t('set.matchStrict')}</option>
          </select>
        </label>
        <p className="muted small" style={{ marginTop: 6 }}>
          Aplica-se a novos jogos. Na clássica, qualquer flor combina com qualquer flor (idem estações).
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">{t('set.traditional')}</h3>
        <div className="row" style={{ gap: '1.2rem' }}>
          <label className="field">
            {t('set.rules')}
            <select
              value={settings.traditional.rules}
              onChange={(e) =>
                onChange({ traditional: { ...settings.traditional, rules: e.target.value as 'classic' | 'chicken' | 'riichi' | 'mcr' } })
              }
            >
              <option value="classic">{t('set.rulesClassic')}</option>
              <option value="chicken">{t('set.rulesChicken')}</option>
              <option value="riichi">{t('set.rulesRiichi')}</option>
              <option value="mcr">{t('set.rulesMcr')}</option>
            </select>
          </label>
          <label className="field">
            {t('set.duration')}
            <select
              value={settings.traditional.hands}
              onChange={(e) =>
                onChange({ traditional: { ...settings.traditional, hands: Number(e.target.value) as 4 | 8 | 16 } })
              }
            >
              <option value={4}>{t('set.hands4')}</option>
              <option value={8}>{t('set.hands8')}</option>
              <option value={16}>{t('set.hands16')}</option>
            </select>
          </label>
          <label className="field">
            {t('set.botDifficulty')}
            <select
              value={settings.traditional.botDifficulty}
              onChange={(e) =>
                onChange({
                  traditional: { ...settings.traditional, botDifficulty: e.target.value as 'easy' | 'medium' | 'hard' },
                })
              }
            >
              <option value="easy">{t('set.botEasy')}</option>
              <option value="medium">{t('set.botMedium')}</option>
              <option value="hard">{t('set.botHard')}</option>
            </select>
          </label>
        </div>
        {settings.traditional.rules === 'mcr' && (
          <div className="row" style={{ gap: '1.2rem', marginTop: 8 }}>
            <label className="field">
              {t('set.mcrMinFan')} (house rule)
              <select
                value={settings.traditional.mcrMinFan}
                onChange={(e) =>
                  onChange({ traditional: { ...settings.traditional, mcrMinFan: Number(e.target.value) } })
                }
              >
                {[1, 3, 5, 8, 16, 24, 32, 48, 64, 88].map((v) => (
                  <option key={v} value={v}>
                    {v} fan{v === 8 ? ' (oficial)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('set.mcrFlowerBonus')} (house rule)
              <select
                value={settings.traditional.mcrFlowerBonus ? 'on' : 'off'}
                onChange={(e) =>
                  onChange({ traditional: { ...settings.traditional, mcrFlowerBonus: e.target.value === 'on' } })
                }
              >
                <option value="on">Ligado — flor/estação com o número do vento do lugar dá +1 fan</option>
                <option value="off">Desligado — só 1 fan por flor/estação</option>
              </select>
            </label>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          Limitações por nível: <b>fácil</b> quebra formas úteis e não defende; <b>médio</b> joga a melhor forma mas
          ignora perigo e pontuação; <b>difícil</b> adiciona descarte seguro e noção de valor, sem defesa completa
          (betaori). Aplica-se à próxima partida.
        </p>
      </div>
    </div>
  );
}
