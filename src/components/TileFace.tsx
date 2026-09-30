import { memo } from 'react';
import type { TileFace as Face } from '../game-engine/tiles/tiles';

/**
 * SVG face art for a mahjong tile, drawn in a 60x80 viewBox.
 * Pure vector — no external fonts required (CJK glyphs fall back to system serif).
 */

const CJK = "'Noto Serif SC', 'Noto Serif CJK SC', 'Yu Mincho', 'MS Mincho', serif";

interface CircleProps { cx: number; cy: number; r: number; color: string }
function Coin({ cx, cy, r, color }: CircleProps) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <circle cx={cx} cy={cy} r={r * 0.62} fill="none" stroke="#f7f1e0" strokeWidth={r * 0.22} />
      <circle cx={cx} cy={cy} r={r * 0.24} fill="#f7f1e0" />
    </g>
  );
}

function Stick({ x, y, h, color }: { x: number; y: number; h: number; color: string }) {
  const w = 5;
  return (
    <g>
      <rect x={x - w / 2} y={y} width={w} height={h} rx={w / 2} fill={color} />
      <rect x={x - w / 2} y={y + h * 0.3} width={w} height={1.6} fill="#f7f1e0" opacity={0.85} />
      <rect x={x - w / 2} y={y + h * 0.62} width={w} height={1.6} fill="#f7f1e0" opacity={0.85} />
    </g>
  );
}

const PIN_LAYOUTS: Record<number, [number, number][]> = {
  1: [[30, 40]],
  2: [[30, 24], [30, 56]],
  3: [[16, 20], [30, 40], [44, 60]],
  4: [[18, 24], [42, 24], [18, 56], [42, 56]],
  5: [[17, 22], [43, 22], [30, 40], [17, 58], [43, 58]],
  6: [[18, 17], [42, 17], [18, 40], [42, 40], [18, 63], [42, 63]],
  7: [[17, 14], [30, 24], [43, 34], [18, 52], [42, 52], [18, 68], [42, 68]],
  8: [[18, 12], [42, 12], [18, 30], [42, 30], [18, 50], [42, 50], [18, 68], [42, 68]],
  9: [[15, 17], [30, 17], [45, 17], [15, 40], [30, 40], [45, 40], [15, 63], [30, 63], [45, 63]],
};

function PinFace({ rank }: { rank: number }) {
  const pts = PIN_LAYOUTS[rank] ?? [];
  const r = rank === 1 ? 15 : rank >= 6 ? 7.2 : 8.4;
  return (
    <g>
      {pts.map(([cx, cy], i) => {
        let color = '#14619e';
        if (rank === 5 && i === 2) color = '#b3202c';
        if (rank === 3 && i === 1) color = '#1c7a44';
        if (rank === 7 && i < 3) color = i === 1 ? '#b3202c' : '#1c7a44';
        if (rank === 9 && cy === 17) color = '#b3202c';
        if (rank === 1) color = '#14619e';
        return <Coin key={i} cx={cx} cy={cy} r={r} color={color} />;
      })}
      {rank === 1 && <circle cx={30} cy={40} r={15} fill="none" stroke="#b3202c" strokeWidth={2.4} />}
    </g>
  );
}

const SOU_LAYOUTS: Record<number, [number, number][]> = {
  2: [[30, 22], [30, 46]],
  3: [[30, 12], [18, 44], [42, 44]],
  4: [[18, 16], [42, 16], [18, 46], [42, 46]],
  5: [[17, 14], [43, 14], [17, 46], [43, 46]],
  6: [[15, 14], [30, 14], [45, 14], [15, 46], [30, 46], [45, 46]],
  7: [[15, 40], [30, 40], [45, 40], [15, 62], [30, 62], [45, 62]],
  8: [[15, 10], [30, 10], [45, 10], [15, 28], [30, 28], [45, 28], [15, 46], [30, 46], [45, 46]],
  9: [[15, 10], [30, 10], [45, 10], [15, 32], [30, 32], [45, 32], [15, 54], [30, 54], [45, 54]],
};

function SouFace({ rank }: { rank: number }) {
  if (rank === 1) {
    // stylized bird
    return (
      <g>
        <ellipse cx={30} cy={42} rx={11} ry={16} fill="#1c7a44" />
        <ellipse cx={30} cy={26} rx={7} ry={7} fill="#1c7a44" />
        <path d="M37 24 L47 27 L37 30 Z" fill="#b3202c" />
        <circle cx={32.5} cy={24.5} r={1.6} fill="#f7f1e0" />
        <path d="M20 46 Q30 62 40 46 L38 68 Q30 74 22 68 Z" fill="#1c7a44" />
        <path d="M24 52 L36 52 M25 58 L35 58" stroke="#f7f1e0" strokeWidth={1.4} />
      </g>
    );
  }
  const pts = SOU_LAYOUTS[rank] ?? [];
  const h = rank === 8 ? 14 : rank === 9 ? 16 : rank >= 6 ? 20 : 22;
  return (
    <g>
      {rank === 5 && <Stick x={30} y={30} h={22} color="#b3202c" />}
      {rank === 7 && <Stick x={30} y={12} h={22} color="#b3202c" />}
      {pts.map(([x, y], i) => {
        let color = '#1c7a44';
        if (rank === 9 && y === 10) color = '#b3202c';
        return <Stick key={i} x={x} y={y} h={h} color={color} />;
      })}
    </g>
  );
}

const MAN_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_GLYPHS = ['東', '南', '西', '北'];
const DRAGON_INFO: [string, string][] = [['中', '#b3202c'], ['發', '#1c7a44'], ['白', '#14619e']];
const FLOWER_GLYPHS = ['梅', '蘭', '菊', '竹'];
const SEASON_GLYPHS = ['春', '夏', '秋', '冬'];

export const TileFaceArt = memo(function TileFaceArt({ face }: { face: Face }) {
  switch (face.suit) {
    case 'pin':
      return (
        <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
          <PinFace rank={face.rank} />
        </svg>
      );
    case 'sou':
      return (
        <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
          <SouFace rank={face.rank} />
        </svg>
      );
    case 'man':
      return (
        <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
          <text x={30} y={34} textAnchor="middle" fontSize={26} fontFamily={CJK} fill="#14265e" fontWeight={700}>
            {MAN_NUMS[face.rank - 1]}
          </text>
          <text x={30} y={68} textAnchor="middle" fontSize={28} fontFamily={CJK} fill="#b3202c" fontWeight={700}>
            萬
          </text>
        </svg>
      );
    case 'wind':
      return (
        <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
          <text x={30} y={56} textAnchor="middle" fontSize={42} fontFamily={CJK} fill="#1b2a22" fontWeight={700}>
            {WIND_GLYPHS[face.rank - 1]}
          </text>
        </svg>
      );
    case 'dragon': {
      const [glyph, color] = DRAGON_INFO[face.rank - 1];
      if (face.rank === 3) {
        // white dragon: framed rectangle
        return (
          <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
            <rect x={14} y={18} width={32} height={44} fill="none" stroke={color} strokeWidth={3.4} />
            <rect x={19} y={23} width={22} height={34} fill="none" stroke={color} strokeWidth={1.6} />
          </svg>
        );
      }
      return (
        <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
          <text x={30} y={57} textAnchor="middle" fontSize={44} fontFamily={CJK} fill={color} fontWeight={700}>
            {glyph}
          </text>
        </svg>
      );
    }
    case 'flower':
      return (
        <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
          <text x={30} y={54} textAnchor="middle" fontSize={38} fontFamily={CJK} fill="#9a2d78" fontWeight={700}>
            {FLOWER_GLYPHS[face.rank - 1]}
          </text>
          <text x={10} y={16} textAnchor="middle" fontSize={12} fontFamily={CJK} fill="#9a2d78">
            {face.rank}
          </text>
        </svg>
      );
    case 'season':
      return (
        <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
          <text x={30} y={54} textAnchor="middle" fontSize={38} fontFamily={CJK} fill="#14619e" fontWeight={700}>
            {SEASON_GLYPHS[face.rank - 1]}
          </text>
          <text x={10} y={16} textAnchor="middle" fontSize={12} fontFamily={CJK} fill="#14619e">
            {face.rank}
          </text>
        </svg>
      );
  }
});

/** Face-down tile art */
export function TileBack() {
  return (
    <svg viewBox="0 0 60 80" className="tile-svg" aria-hidden="true">
      <rect x={4} y={4} width={52} height={72} rx={6} fill="#0f5c3c" />
      <rect x={8} y={8} width={44} height={64} rx={4} fill="none" stroke="rgba(212,175,55,0.55)" strokeWidth={1.5} />
      <text x={30} y={50} textAnchor="middle" fontSize={26} fontFamily={CJK} fill="rgba(212,175,55,0.85)" fontWeight={700}>
        麻
      </text>
    </svg>
  );
}
