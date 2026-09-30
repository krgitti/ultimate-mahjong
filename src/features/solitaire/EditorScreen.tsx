import { useMemo, useState } from 'react';
import { loadCustomLayouts, saveCustomLayouts, type CustomLayoutEntry } from '../../storage/profile';
import { registerCustomLayout } from '../../game-engine/layouts';
import { navigate } from '../../app/App';
import { useToast } from '../../components/ui';

const COLS = 18;
const ROWS = 12;
const MAX_LAYER = 4;
const CELL = 30;

export function EditorScreen() {
  const toast = useToast();
  const [entries, setEntries] = useState<CustomLayoutEntry[]>(() => loadCustomLayouts());
  const [layer, setLayer] = useState(0);
  const [name, setName] = useState('');
  const [tiles, setTiles] = useState<Set<string>>(() => {
    // start from a small starter pattern (2 layers pyramid-ish)
    const s = new Set<string>();
    for (let y = 2; y < 8; y++) for (let x = 3; x < 13; x++) s.add(`0|${x}|${y}`);
    for (let y = 3; y < 7; y++) for (let x = 5; x < 11; x++) s.add(`1|${x}|${y}`);
    return s;
  });

  const count = tiles.size;
  const perLayer = useMemo(() => {
    const m: Record<number, number> = {};
    for (const k of tiles) {
      const l = Number(k.split('|')[0]);
      m[l] = (m[l] ?? 0) + 1;
    }
    return m;
  }, [tiles]);

  const toggle = (l: number, x: number, y: number) => {
    const k = `${l}|${x}|${y}`;
    const next = new Set(tiles);
    if (next.has(k)) {
      next.delete(k);
      // removing a tile must also remove any tile stacked exactly above? No — allow floating; validator warns.
    } else {
      next.add(k);
    }
    setTiles(next);
  };

  const floating = useMemo(() => {
    let n = 0;
    for (const k of tiles) {
      const [l, x, y] = k.split('|').map(Number);
      if (l === 0) continue;
      const has = tiles.has(`${l - 1}|${x}|${y}`);
      if (!has) n++;
    }
    return n;
  }, [tiles]);

  const save = () => {
    if (!name.trim()) {
      toast('Dê um nome ao layout.', true);
      return;
    }
    if (count === 0 || count % 2 !== 0) {
      toast('O layout precisa de um número PAR de peças (maior que zero).', true);
      return;
    }
    const raw: [number, number, number][] = [...tiles].map((k) => {
      const [l, x, y] = k.split('|').map(Number);
      return [l, x * 2, y * 2];
    });
    const id = `custom-${Date.now().toString(36)}`;
    const entry: CustomLayoutEntry = { id, name: name.trim(), tiles: raw };
    const next = [...entries, entry];
    setEntries(next);
    saveCustomLayouts(next);
    registerCustomLayout({ id, name: entry.name, source: 'custom', tiles: raw });
    toast('Layout salvo! Você já pode jogá-lo.');
  };

  const play = (id: string) => {
    window.location.hash = '#/solitaire';
    // trigger via a CustomEvent so SolitaireScreen picks the layout up
    window.dispatchEvent(new CustomEvent('umo:play-layout', { detail: { layoutId: id } }));
    navigate('solitaire');
  };

  const remove = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    saveCustomLayouts(next);
  };

  return (
    <div>
      <h1 className="page-title">Editor de layouts</h1>
      <p className="page-sub">
        Desenhe um tabuleiro de Solitaire célula a célula (grade de peças inteiras). Layouts personalizados usam apenas
        os 34 desenhos básicos (4 cópias cada, repetindo se necessário) e são validados pelo gerador de partidas
        solucionáveis antes de jogar. Limitação: o editor não faz deslocamentos de meia peça.
      </p>

      <div className="editor-layout">
        <div className="editor-canvas" style={{ height: ROWS * CELL + 16, padding: 8 }}>
          <div style={{ position: 'relative', width: COLS * CELL, height: ROWS * CELL }}>
            {Array.from({ length: ROWS }).map((_, y) =>
              Array.from({ length: COLS }).map((__, x) => {
                const filledHere = tiles.has(`${layer}|${x}|${y}`);
                let below = 0;
                for (let l = 0; l < layer; l++) if (tiles.has(`${l}|${x}|${y}`)) below = l + 1;
                const cls = filledHere
                  ? `filled-${Math.min(layer, 3)}`
                  : below > 0
                    ? `filled-${Math.min(below - 1, 3)}`
                    : '';
                return (
                  <button
                    key={`${x}-${y}`}
                    className={`editor-cell ${cls}`}
                    style={{
                      left: x * CELL,
                      top: y * CELL,
                      width: CELL - 2,
                      height: CELL - 2,
                      opacity: filledHere ? 1 : below > 0 ? 0.35 : 1,
                    }}
                    aria-label={`célula ${x},${y} camada ${layer}${filledHere ? ' (ocupada)' : ''}`}
                    onClick={() => toggle(layer, x, y)}
                  />
                );
              })
            )}
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Camada</h3>
          <div className="row">
            {Array.from({ length: MAX_LAYER + 1 }).map((_, l) => (
              <button
                key={l}
                className={`btn btn-sm${layer === l ? ' btn-primary' : ''}`}
                onClick={() => setLayer(l)}
              >
                {l} {perLayer[l] ? `(${perLayer[l]})` : ''}
              </button>
            ))}
          </div>
          <p className="muted small">
            Peças: <b>{count}</b> {count % 2 !== 0 && <span style={{ color: '#ffd9d7' }}>(precisa ser par!)</span>}
            {floating > 0 && <span style={{ color: '#ffe1df' }}> · {floating} peça(s) flutuando sem apoio</span>}
          </p>
          <label className="field" style={{ marginTop: 8 }}>
            Nome do layout
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meu tabuleiro" />
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={save}>💾 Salvar</button>
            <button className="btn btn-sm" onClick={() => setTiles(new Set())}>🗑 Limpar</button>
          </div>

          {entries.length > 0 && (
            <>
              <h3 className="panel-title" style={{ marginTop: 12 }}>Seus layouts</h3>
              {entries.map((e) => (
                <div key={e.id} className="row" style={{ marginBottom: 6 }}>
                  <span className="small" style={{ flex: 1 }}>{e.name} <span className="muted">({e.tiles.length} pçs)</span></span>
                  <button className="btn btn-sm" onClick={() => play(e.id)}>Jogar</button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(e.id)}>✕</button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
