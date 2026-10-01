import { useMemo, useRef, useEffect, useState } from 'react';
import { t } from '../../i18n';
import type { SolitaireState, SolTile } from '../../game-engine/solitaire/engine';
import { isFree } from '../../game-engine/solitaire/engine';
import { expandLayout } from '../../game-engine/layouts/types';
import { getLayoutDefinition } from '../../game-engine/layouts';
import { faceName } from '../../game-engine/tiles/tiles';
import { TileFaceArt } from '../../components/TileFace';

const BASE_W = 46; // px per full tile width
const RATIO = 80 / 60;
const LAYER_DX = -5;
const LAYER_DY = -6;

export interface BoardViewProps {
  state: SolitaireState;
  /** custom bounds for editor-produced layouts */
  bounds?: { minX: number; maxX: number; minY: number; maxY: number; layers: number };
  selectedId: number | null;
  hintIds: number[];
  removingIds: number[];
  shakeId: number | null;
  onTileClick: (tile: SolTile) => void;
}

export function BoardView({ state, bounds, selectedId, hintIds, removingIds, shakeId, onTileClick }: BoardViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const b = useMemo(() => {
    if (bounds) return bounds;
    const def = getLayoutDefinition(state.layoutId);
    if (def) return def;
    const tiles = state.tiles.map((t) => [t.pos.layer, t.pos.x, t.pos.y] as [number, number, number]);
    return expandLayout({ id: 'custom', name: 'custom', source: 'custom', tiles });
  }, [state.layoutId, state.tiles, bounds]);

  const boardW = ((b.maxX - b.minX) / 2) * BASE_W + Math.abs(LAYER_DX) * b.layers + 12;
  const boardH = ((b.maxY - b.minY) / 2) * BASE_W * RATIO + Math.abs(LAYER_DY) * b.layers + 12;

  // fit-to-container scale. The *viewport* div gets the scaled dimensions so the layout
  // box matches what is painted (transform alone keeps the unscaled box and breaks centering).
  // modo ampliado (pedido 8, obs mobile): em telas pequenas o fit puro deixa
  // as peças ilegíveis; no modo 'zoom' o tabuleiro ganha um piso de escala e
  // fica navegável por scroll/toque.
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const s = Math.min(el.clientWidth / boardW, el.clientHeight / boardH, 1.35);
      const fit = Math.max(0.28, s);
      setScale(zoomed ? Math.min(1, Math.max(fit, 0.8)) : fit);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return; // jsdom / older envs
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [boardW, boardH, zoomed]);

  const tiles = state.tiles.filter((t) => !t.removed || removingIds.includes(t.id));
  const sorted = [...tiles].sort(
    (p, q) => p.pos.layer - q.pos.layer || p.pos.y - q.pos.y || p.pos.x - q.pos.x
  );

  const onKeyDown = (e: React.KeyboardEvent, tile: SolTile) => {
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    // find nearest visible tile in that direction (same layer preferred)
    const candidates = state.tiles
      .filter((t) => !t.removed && t.id !== tile.id)
      .map((t) => {
        const dx = (t.pos.x - tile.pos.x) * (dir[0] !== 0 ? Math.sign(dir[0]) : 0);
        const dy = (t.pos.y - tile.pos.y) * (dir[1] !== 0 ? Math.sign(dir[1]) : 0);
        const forward = dir[0] !== 0 ? dx > 0 : dy > 0;
        if (!forward) return null;
        const lateral = dir[0] !== 0 ? Math.abs(t.pos.y - tile.pos.y) : Math.abs(t.pos.x - tile.pos.x);
        const dist = (dir[0] !== 0 ? dx : dy) + lateral * 2 + Math.abs(t.pos.layer - tile.pos.layer) * 3;
        return { t, dist };
      })
      .filter((x): x is { t: SolTile; dist: number } => x !== null)
      .sort((a, b2) => a.dist - b2.dist);
    if (candidates.length > 0) {
      const el = wrapRef.current?.querySelector<HTMLButtonElement>(`[data-tile-id="${candidates[0].t.id}"]`);
      el?.focus();
    }
  };

  return (
    <div className={`board-wrap${zoomed ? ' scrollable' : ''}`} ref={wrapRef}>
      <button
        className="btn btn-sm board-zoom-btn"
        onClick={() => setZoomed((z) => !z)}
        aria-label={zoomed ? t('sol.zoomOut') : t('sol.zoomIn')}
      >
        {zoomed ? t('sol.zoomOutShort') : t('sol.zoomInShort')}
      </button>
      <div
        className="board-viewport"
        style={{ width: boardW * scale, height: boardH * scale }}
      >
        <div
          className="board"
          style={{
            width: boardW,
            height: boardH,
            transform: `scale(${scale})`,
          }}
        >
        {sorted.map((t) => {
          const free = !t.removed && isFree(t, state.tiles);
          const left = ((t.pos.x - b.minX) / 2) * BASE_W + t.pos.layer * LAYER_DX + 6;
          const top = ((t.pos.y - b.minY) / 2) * BASE_W * RATIO + t.pos.layer * LAYER_DY + 6;
          const cls = [
            'tile',
            free ? 'free' : 'blocked',
            selectedId === t.id ? 'selected' : '',
            hintIds.includes(t.id) ? 'hint-glow' : '',
            removingIds.includes(t.id) ? 'removing' : '',
            shakeId === t.id ? 'shake' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={t.id}
              data-tile-id={t.id}
              className={cls}
              style={{
                left,
                top,
                width: BASE_W - 3,
                height: BASE_W * RATIO - 3,
                zIndex: t.pos.layer * 1000 + t.pos.y * 4 + t.pos.x,
              }}
              aria-label={`${faceName(t.face)} — ${free ? 'livre' : 'bloqueada'}`}
              aria-pressed={selectedId === t.id}
              onClick={() => onTileClick(t)}
              onKeyDown={(e) => onKeyDown(e, t)}
            >
              <span className="tile-face-inner">
                <TileFaceArt face={t.face} />
              </span>
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}
