import { useState } from 'react';
import { t } from '../../i18n';
import { SolitaireTutorialRunner } from './SolitaireTutorialRunner';
import { TradTutorialRunner } from './TradTutorialRunner';

type Tut = 'none' | 'solitaire' | 'traditional';

export function LearnScreen() {
  const [active, setActive] = useState<Tut>('none');

  if (active === 'solitaire') {
    return (
      <div>
        <div className="row-between" style={{ marginBottom: '0.6rem' }}>
          <h1 className="page-title" style={{ fontSize: '1.2rem' }}>{t('learn.tutSolTitle')}</h1>
          <button className="btn btn-sm" onClick={() => setActive('none')}>← {t('learn.back')}</button>
        </div>
        <SolitaireTutorialRunner />
      </div>
    );
  }

  if (active === 'traditional') {
    return (
      <div>
        <div className="row-between" style={{ marginBottom: '0.6rem' }}>
          <h1 className="page-title" style={{ fontSize: '1.2rem' }}>{t('learn.tutTradTitle')}</h1>
          <button className="btn btn-sm" onClick={() => setActive('none')}>← {t('learn.back')}</button>
        </div>
        <TradTutorialRunner />
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">{t('nav.learn')}</h1>
      <p className="page-sub">{t('learn.sub')}</p>
      <div className="grid-cards">
        <button className="card" onClick={() => setActive('solitaire')}>
          <span className="card-icon" aria-hidden="true">🀫</span>
          <span className="card-name">{t('learn.solCardN')}</span>
          <span className="card-desc">{t('learn.solCardD')}</span>
          <span className="card-meta">{t('learn.solCardM')}</span>
        </button>
        <button className="card" onClick={() => setActive('traditional')}>
          <span className="card-icon" aria-hidden="true">🎴</span>
          <span className="card-name">{t('learn.tradCardN')}</span>
          <span className="card-desc">{t('learn.tradCardD')}</span>
          <span className="card-meta">{t('learn.tradCardM')}</span>
        </button>
      </div>
      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3 className="panel-title">{t('learn.shortcuts')}</h3>
        <p className="muted">
          <span className="kbd">U</span> {t('learn.k.undo')} · <span className="kbd">R</span> {t('learn.k.redo')} ·{' '}
          <span className="kbd">H</span> {t('learn.k.hint')} · <span className="kbd">S</span> {t('learn.k.shuffle')} ·{' '}
          <span className="kbd">N</span> {t('learn.k.new')} · <span className="kbd">←↑→↓</span> {t('learn.k.nav')} ·{' '}
          <span className="kbd">Enter</span> {t('learn.k.select')} · <span className="kbd">Esc</span> {t('learn.k.clear')}
        </p>
      </div>
    </div>
  );
}
