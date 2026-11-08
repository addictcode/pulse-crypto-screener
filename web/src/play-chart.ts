import type { Bar } from './play-game';

/** What one frame of the chart shows. */
export interface Frame {
  candles: Bar[];
  /** how many candles are on screen, from the first */
  shown: number;
  /** the price range in use; see priceRange */
  range: [number, number];
  /** index of the signal candle, marked with a line once there are candles after it */
  at: number;
  /** total width in candles, so the chart does not stretch as the hour plays */
  slots: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * A plain candlestick chart: no axis and no prices, so the coin cannot be told from the numbers
 * before the answer. Sized to the canvas box, sharp on high-density screens.
 */
export function drawFrame(canvas: HTMLCanvasElement, f: Frame) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const [lo, hi] = f.range;
  const pad = 10;
  const y = (v: number) => pad + ((hi - v) / (hi - lo || 1)) * (height - pad * 2);
  const step = width / f.slots;
  const body = Math.max(1, step * 0.62);
  const up = css('--up') || '#58e08a';
  const down = css('--down') || '#ff4a5c';

  // the question's price as a quiet guide line across the whole width
  const question = f.candles[f.at][3];
  ctx.strokeStyle = css('--rule-strong') || '#303238';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(y(question)) + 0.5);
  ctx.lineTo(width, Math.round(y(question)) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < Math.min(f.shown, f.candles.length); i++) {
    const [o, h, l, c] = f.candles[i];
    const x = step * i + step / 2;
    // outside the range (only possible before the scale catches up) the candle is clipped
    ctx.strokeStyle = ctx.fillStyle = c >= o ? up : down;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, y(h));
    ctx.lineTo(Math.round(x) + 0.5, y(l));
    ctx.stroke();
    const top = y(Math.max(o, c));
    ctx.fillRect(x - body / 2, top, body, Math.max(1, y(Math.min(o, c)) - top));
  }

  if (f.shown > f.at + 1) {
    const x = Math.round(step * (f.at + 1)) + 0.5;
    ctx.strokeStyle = css('--ink-3') || '#777a82';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
