import { useMemo, useState } from 'react';
import { loadCustomLayouts, saveCustomLayouts, type CustomLayoutEntry } from '../../storage/profile';
import { registerCustomLayout } from '../../game-engine/layouts';
import { navigate } from '../../app/App';
import { useToast } from '../../components/ui';
import { serializeLayout, parseLayout, EDIT_LIMITS, type RawTile } from './editor-io';

const COLS = 18;
const ROWS = 12;
const MAX_LAYER = EDIT_LIMITS.layer;
const CELL = 30;
const HALF_CELL = 15;

export function EditorScreen() {
  const toast = useToast();
  const [entries, setEntries] = useState<CustomLayoutEntry[]>(() => loadCustomLayouts());
  const [layer, setLayer] = useState(0);
  const [name, setName] = useState('');
  const [half, setHalf] = useState(false);
  const [ioText, setIoText] = useState('');
  const [tiles, setTiles] = useState<Set<string>>(() => {
    // starter pattern (engine half-units: x*2, y*2)
    const s = new Set<string>();
    for (let y = 2; y < 8; y++) for (let x = 3; x < 13; x++) s.add(`0|${x * 2}|${y * 2}`);
    for (let y = 3; y < 7; y++) for (let x = 5; x < 11; x++) s.add(`1|${x * 2}|${y * 2}`);
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
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setTiles(next);
  };

  const floating = useMemo(() => {
    let n = 0;
    for (const k of tiles) {
      const [l, x, y] = k.split('|').map(Number);
      if (l === 0) continue;
      if (!tiles.has(`${l - 1}|${x}|${y}`)) n++;
    }
    return n;
  }, [tiles]);

  const rawTiles = (): RawTile[] =>
    [...tiles].map((k) => k.split('|').map(Number) as [number, number, number]);

  const save = () => {
    if (!name.trim()) {
      toast('Dê um nome ao layout.', true);
      return;
    }
    if (count === 0 || count % 2 !== 0) {
      toast('O layout precisa de um número PAR de peças (maior que zero).', true);
      return;
    }
    const raw = rawTiles();
    const id = `custom-${Date.now().toString(36)}`;
    const entry: CustomLayoutEntry = { id, name: name.trim(), tiles: raw };
    const next = [...entries, entry];
    setEntries(next);
    saveCustomLayouts(next);
    registerCustomLayout({ id, name: entry.name, source: 'custom', tiles: raw });
    toast('Layout salvo! Você já pode jogá-lo.');
  };

  const exportJson = () => {
    setIoText(serializeLayout(name.trim() || 'meu-layout', rawTiles()));
    toast('JSON gerado no campo abaixo — copie ou baixe.');
  };

  const importJson = () => {
    const res = parseLayout(ioText);
    if (!res.ok) {
      toast(res.error, true);
      return;
    }
    const s = new Set<string>(res.layout.tiles.map(([l, x, y]) => `${l}|${x}|${y}`));
    setTiles(s);
    setName(res.layout.name);
    toast(`Importado: ${res.layout.tiles.length} peças.`);
  };

  const download = () => {
    const blob = new Blob([serializeLayout(name.trim() || 'meu-layout', rawTiles())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(name.trim() || 'layout').replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const play = (id: string) => {
    window.location.hash = '#/solitaire';
    window.dispatchEvent(new CustomEvent('umo:play-layout', { detail: { layoutId: id } }));
    navigate('solitaire');
  };

  const remove = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    saveCustomLayouts(next);
  };

  /* grid geometry: integer mode draws whole-tile cells; half mode doubles resolution */
  const gcols = half ? COLS * 2 - 1 : COLS;
  const grows = half ? ROWS * 2 - 1 : ROWS;
  const cell = half ? HALF_CELL : CELL;

  return (
    <div>
      <h1 className="page-title">Editor de layouts</h1>
      <p className="page-sub">
        Desenhe um tabuleiro de Solitaire célula a célula. Com o modo <b>meia peça</b> ativado a grade usa
        meia-unidade (como a sobreposição da Tartaruga). Layouts usam os 34 desenhos básicos e são validados
        (contagem par, limites) antes de salvar; o gerador de partidas solucionáveis confere na hora de jogar.
        Importe/exporte layouts em JSON.
      </p>

      <div className="editor-layout">
        <div className="editor-canvas" style={{ height: grows * cell + 16, padding: 8 }}>
          <div style={{ position: 'relative', width: gcols * cell, height: grows * cell }}>
            {Array.from({ length: grows }).map((_, gy) =>
              Array.from({ length: gcols }).map((__, gx) => {
                const x = half ? gx : gx * 2;
                const y = half ? gy : gy * 2;
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
                    key={`${gx}-${gy}`}
                    className={`editor-cell ${cls}`}
                    style={{
                      left: gx * cell,
                      top: gy * cell,
                      width: cell - 2,
                      height: cell - 2,
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
          <div className="row" style={{ marginTop: 8 }}>
            <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} />
              Meia peça (grade fina)
            </label>
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
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={exportJson}>⬆ Exportar JSON</button>
            <button className="btn btn-sm" onClick={download}>⬇ Baixar .json</button>
            <button className="btn btn-sm" onClick={importJson}>⬇ Importar JSON</button>
          </div>
          <textarea
            className="io-area"
            style={{ width: '100%', minHeight: 90, marginTop: 6 }}
            value={ioText}
            onChange={(e) => setIoText(e.target.value)}
            placeholder='Cole aqui um layout JSON para importar, ou use "Exportar" para gerar.'
            aria-label="JSON do layout"
          />

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
