import type { Candle } from './story';

const UP = '#2ebd85';
const DOWN = '#f6465d';

type Props = {
  candles: Candle[];
  /** how many candles are drawn, fractional for a growing last one */
  shown: number;
  width: number;
  height: number;
  /** candles kept in the price range even before they are drawn, so the scale does not jump */
  rangeTo: number;
  /** index of the signal minute, marked with a line */
  mark: number | null;
};

/** Minute candles with volume underneath, drawn as SVG so every frame renders the same way. */
export const Chart = ({ candles, shown, width, height, rangeTo, mark }: Props) => {
  const visible = candles.slice(0, Math.ceil(shown));
  const ranged = candles.slice(0, Math.max(1, rangeTo));
  const hi = Math.max(...ranged.map((c) => c.h));
  const lo = Math.min(...ranged.map((c) => c.l));
  const pad = (hi - lo) * 0.08;
  const top = hi + pad;
  const bottom = lo - pad;
  const priceH = height * 0.8;
  const y = (p: number) => ((top - p) / (top - bottom)) * priceH;
  const slot = width / candles.length;
  const body = Math.max(2, slot * 0.68);
  const maxV = Math.max(...ranged.map((c) => c.v));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {[0.2, 0.4, 0.6, 0.8].map((f) => (
        <line key={f} x1={0} x2={width} y1={priceH * f} y2={priceH * f} stroke="#1a1b1f" strokeWidth={2} />
      ))}
      {mark !== null && shown > mark ? (
        <line x1={slot * (mark + 0.5)} x2={slot * (mark + 0.5)} y1={0} y2={height} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="10 10" />
      ) : null}
      {visible.map((c, i) => {
        // the newest candle grows from its open, like a live one
        const grow = i === visible.length - 1 ? shown - Math.floor(shown) || 1 : 1;
        const close = c.o + (c.c - c.o) * grow;
        const high = c.o + (c.h - c.o) * grow;
        const low = c.o + (c.l - c.o) * grow;
        const color = close >= c.o ? UP : DOWN;
        const x = slot * (i + 0.5);
        const vh = (c.v / maxV) * height * 0.17 * grow;
        return (
          <g key={c.t}>
            <rect x={x - body / 2} y={height - vh} width={body} height={vh} fill={color} opacity={0.35} />
            <line x1={x} x2={x} y1={y(high)} y2={y(low)} stroke={color} strokeWidth={Math.max(2, slot * 0.14)} />
            <rect x={x - body / 2} y={y(Math.max(c.o, close))} width={body} height={Math.max(2, Math.abs(y(c.o) - y(close)))} fill={color} />
          </g>
        );
      })}
    </svg>
  );
};
