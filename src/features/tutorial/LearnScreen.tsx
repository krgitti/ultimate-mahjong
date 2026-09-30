import { useState } from 'react';
import { SolitaireTutorialRunner } from './SolitaireTutorialRunner';
import { TradTutorialRunner } from './TradTutorialRunner';

type Tut = 'none' | 'solitaire' | 'traditional';

export function LearnScreen() {
  const [active, setActive] = useState<Tut>('none');

  if (active === 'solitaire') {
    return (
      <div>
        <div className="row-between" style={{ marginBottom: '0.6rem' }}>
          <h1 className="page-title" style={{ fontSize: '1.2rem' }}>Tutorial — Mahjong Solitaire</h1>
          <button className="btn btn-sm" onClick={() => setActive('none')}>← Voltar</button>
        </div>
        <SolitaireTutorialRunner />
      </div>
    );
  }

  if (active === 'traditional') {
    return (
      <div>
        <div className="row-between" style={{ marginBottom: '0.6rem' }}>
          <h1 className="page-title" style={{ fontSize: '1.2rem' }}>Tutorial — Mahjong Tradicional</h1>
          <button className="btn btn-sm" onClick={() => setActive('none')}>← Voltar</button>
        </div>
        <TradTutorialRunner />
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Aprender</h1>
      <p className="page-sub">
        Tutoriais <strong>interativos</strong>: você joga de verdade em um tabuleiro guiado. Cada passo explica um
        conceito, destaca as peças certas e <strong>bloqueia movimentos proibidos</strong> até você fazer o movimento
        correto.
      </p>
      <div className="grid-cards">
        <button className="card" onClick={() => setActive('solitaire')}>
          <span className="card-icon" aria-hidden="true">🀫</span>
          <span className="card-name">Tutorial de Solitaire</span>
          <span className="card-desc">
            Peças livres e bloqueadas · camadas · pares compatíveis (incluindo flores e estações) · planejamento para
            não ficar sem movimentos. 6 passos, ~3 minutos.
          </span>
          <span className="card-meta">Tabuleiro guiado de 12 peças</span>
        </button>
        <button className="card" onClick={() => setActive('traditional')}>
          <span className="card-icon" aria-hidden="true">🎴</span>
          <span className="card-name">Tutorial de Mahjong Tradicional</span>
          <span className="card-desc">
            Naipes e honras · compra e descarte · chamadas (Chow, Pon, Kong, Ron) · vitória por Tsumo · leitura da
            pontuação em fan. Mesa 100% roteirizada: nada de sorte.
          </span>
          <span className="card-meta">7 passos, ~5 minutos</span>
        </button>
      </div>
      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3 className="panel-title">Atalhos de teclado (Solitaire)</h3>
        <p className="muted">
          <span className="kbd">U</span> desfazer · <span className="kbd">R</span> refazer · <span className="kbd">H</span>{' '}
          dica · <span className="kbd">S</span> embaralhar · <span className="kbd">N</span> novo jogo ·{' '}
          <span className="kbd">←↑→↓</span> navegar entre peças · <span className="kbd">Enter</span> selecionar ·{' '}
          <span className="kbd">Esc</span> limpar seleção
        </p>
      </div>
    </div>
  );
}
