// Indicator maths, ported from v1 and kept free of any chart code so it can be tested on plain
// arrays. Every function returns arrays aligned with the input bars: index i belongs to bar i,
// and null means "not enough history yet".

import type { CandleDto } from './types';

export type Bar = CandleDto;
export type Line = Array<number | null>;

const empty = (n: number): Line => new Array<number | null>(n).fill(null);

/**
 * Exponential moving average. Leading nulls are skipped, so the same function smooths prices
 * and other indicators that only start after a warm-up (MACD signal, HyperWave).
 */
export function ema(src: Line, len: number): Line {
  const out = empty(src.length);
  const first = src.findIndex((v) => v !== null);
  if (first < 0 || src.length - first < len) return out;
  let seed = 0;
  for (let i = first; i < first + len; i++) seed += src[i] ?? 0;
  out[first + len - 1] = seed / len;
  const k = 2 / (len + 1);
  for (let i = first + len; i < src.length; i++) out[i] = (src[i] ?? out[i - 1]!) * k + out[i - 1]! * (1 - k);
  return out;
}

export function sma(src: number[], len: number): Line {
  const out = empty(src.length);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function bollinger(closes: number[], len = 20, mult = 2) {
  const mid = empty(closes.length);
  const upper = empty(closes.length);
  const lower = empty(closes.length);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    sumSq += closes[i] * closes[i];
    if (i >= len) {
      sum -= closes[i - len];
      sumSq -= closes[i - len] * closes[i - len];
    }
    if (i < len - 1) continue;
    const mean = sum / len;
    const sd = Math.sqrt(Math.max(0, sumSq / len - mean * mean));
    mid[i] = mean;
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { mid, upper, lower };
}

const trueRange = (bars: Bar[], i: number) =>
  Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));

/** Average true range with Wilder smoothing, the way TradingView computes it. */
export function atr(bars: Bar[], len = 14): Line {
  const out = empty(bars.length);
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = trueRange(bars, i);
    if (i < len) sum += tr;
    else if (i === len) out[i] = (sum + tr) / len;
    else out[i] = (out[i - 1]! * (len - 1) + tr) / len;
  }
  return out;
}

/** Relative strength index with Wilder smoothing. */
export function rsi(src: number[], len = 14): Line {
  const out = empty(src.length);
  let gain = 0;
  let loss = 0;
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    const up = Math.max(d, 0);
    const down = Math.max(-d, 0);
    if (i <= len) {
      gain += up;
      loss += down;
      if (i === len) {
        gain /= len;
        loss /= len;
        out[i] = value();
      }
    } else {
      gain = (gain * (len - 1) + up) / len;
      loss = (loss * (len - 1) + down) / len;
      out[i] = value();
    }
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signalLen = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line: Line = closes.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const signal = ema(line, signalLen);
  const hist: Line = line.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i]! : null));
  return { line, signal, hist };
}

/**
 * Session VWAP, reset at 00:00 UTC like the exchange's daily candle. Candle volume here is in
 * USDT, so base volume is recovered as quote / typical price.
 */
export function vwap(bars: Bar[]): Line {
  const out = empty(bars.length);
  let day = -1;
  let quote = 0;
  let base = 0;
  for (let i = 0; i < bars.length; i++) {
    const d = Math.floor(bars[i].time / 86_400);
    if (d !== day) {
      day = d;
      quote = 0;
      base = 0;
    }
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    quote += bars[i].volume;
    base += tp > 0 ? bars[i].volume / tp : 0;
    out[i] = base > 0 ? quote / base : null;
  }
  return out;
}

/** Money flow index: RSI of typical price weighted by turnover. */
export function mfi(bars: Bar[], len = 14): Line {
  const out = empty(bars.length);
  const pos: number[] = new Array(bars.length).fill(0);
  const neg: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    const prev = (bars[i - 1].high + bars[i - 1].low + bars[i - 1].close) / 3;
    if (tp > prev) pos[i] = bars[i].volume;
    else if (tp < prev) neg[i] = bars[i].volume;
  }
  let p = 0;
  let n = 0;
  for (let i = 0; i < bars.length; i++) {
    p += pos[i];
    n += neg[i];
    if (i >= len) {
      p -= pos[i - len];
      n -= neg[i - len];
      out[i] = p + n > 0 ? (100 * p) / (p + n) : 50;
    }
  }
  return out;
}

/** A trend-following line: value on bar i and direction (1 up, -1 down). */
export interface Trail {
  line: Line;
  dir: number[];
  /** Bars where the direction flipped, with a 1-4 confluence score where one is computed. */
  flips: Array<{ i: number; dir: number; score?: number }>;
}

export function supertrend(bars: Bar[], len = 10, mult = 3): Trail {
  const range = atr(bars, len);
  const line = empty(bars.length);
  const dir: number[] = new Array(bars.length).fill(1);
  const flips: Trail['flips'] = [];
  let upperBand: number | null = null;
  let lowerBand: number | null = null;
  for (let i = 1; i < bars.length; i++) {
    dir[i] = dir[i - 1];
    if (range[i] === null) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const ub = hl2 + mult * range[i]!;
    const lb = hl2 - mult * range[i]!;
    const prevClose = bars[i - 1].close;
    // a band only tightens, unless the previous close already broke through it
    upperBand = upperBand === null || ub < upperBand || prevClose > upperBand ? ub : upperBand;
    lowerBand = lowerBand === null || lb > lowerBand || prevClose < lowerBand ? lb : lowerBand;
    dir[i] = dir[i - 1] === 1 ? (bars[i].close < lowerBand ? -1 : 1) : bars[i].close > upperBand ? 1 : -1;
    if (dir[i] !== dir[i - 1] && line[i - 1] !== null) flips.push({ i, dir: dir[i] });
    line[i] = dir[i] === 1 ? lowerBand : upperBand;
  }
  return { line, dir, flips };
}

/**
 * "Smart Signals" from v1: an ATR trail around a lightly smoothed price. Each flip is scored
 * 1 to 4 by how many things agree with it: trend against EMA 200, RSI side, a volume burst.
 */
export function smartTrail(bars: Bar[], mult = 3.2): Trail {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const range = atr(bars, 14);
  const src = ema(closes, 3);
  const trend = ema(closes, 200);
  const strength = rsi(closes, 14);
  const volumeAvg = sma(bars.map((b) => b.volume), 20);
  const line = empty(n);
  const dir: number[] = new Array(n).fill(1);
  const flips: Trail['flips'] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) dir[i] = dir[i - 1];
    if (range[i] === null || src[i] === null) continue;
    const m = mult * range[i]!;
    const prev = i > 0 ? line[i - 1] : null;
    if (prev === null) {
      line[i] = src[i]! - m;
      continue;
    }
    let d = dir[i - 1];
    if (d === 1) {
      line[i] = Math.max(prev, src[i]! - m);
      if (closes[i] < line[i]!) {
        d = -1;
        line[i] = src[i]! + m;
      }
    } else {
      line[i] = Math.min(prev, src[i]! + m);
      if (closes[i] > line[i]!) {
        d = 1;
        line[i] = src[i]! - m;
      }
    }
    dir[i] = d;
    if (d !== dir[i - 1]) {
      let score = 1;
      if (trend[i] !== null && (d === 1 ? closes[i] > trend[i]! : closes[i] < trend[i]!)) score++;
      if (strength[i] !== null && (d === 1 ? strength[i]! > 50 : strength[i]! < 50)) score++;
      if (volumeAvg[i] && bars[i].volume > volumeAvg[i]! * 1.3) score++;
      flips.push({ i, dir: d, score });
    }
  }
  return { line, dir, flips };
}

/** Momentum wave (RSI centred on zero), its signal line, money flow and turning points. */
export function hyperWave(bars: Bar[]) {
  const closes = bars.map((b) => b.close);
  const wave = ema(rsi(closes, 14).map((v) => (v === null ? null : (v - 50) * 2)), 4);
  const signal = ema(wave, 6);
  const flow = ema(mfi(bars, 14).map((v) => (v === null ? null : (v - 50) * 2)), 3);
  const turns: Array<{ i: number; dir: number; strong: boolean }> = [];
  for (let i = 1; i < bars.length; i++) {
    const [w, s, pw, ps] = [wave[i], signal[i], wave[i - 1], signal[i - 1]];
    if (w === null || s === null || pw === null || ps === null) continue;
    if (pw >= ps && w < s && w > 40) turns.push({ i, dir: -1, strong: w > 60 });
    else if (pw <= ps && w > s && w < -40) turns.push({ i, dir: 1, strong: w < -60 });
  }
  return { wave, signal, flow, turns };
}

/** Pivot highs and lows confirmed by `width` bars on both sides. */
export function pivots(bars: Bar[], width: number, from = width) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = Math.max(width, from); i < bars.length - width; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = i - width; k <= i + width; k++) {
      if (bars[k].high > bars[i].high) isHigh = false;
      if (bars[k].low < bars[i].low) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

/** A segment between two bars, in price; used for divergences and structure breaks. */
export interface Segment {
  from: number;
  to: number;
  fromPrice: number;
  toPrice: number;
  bull: boolean;
  label: string;
  dashed: boolean;
}

/** A zone that starts at a bar and runs to the right edge until price fills it. */
export interface Zone {
  from: number;
  top: number;
  bottom: number;
  bull: boolean;
  label?: string;
}

/**
 * Regular divergences on the last 180 bars: price makes a lower low while RSI makes a higher
 * one (bullish), or the mirror image at highs. At most three of each, newest first.
 */
export function divergences(bars: Bar[]): Segment[] {
  const width = 3;
  const strength = rsi(bars.map((b) => b.close), 14);
  const { highs, lows } = pivots(bars, width, Math.max(width + 14, bars.length - 180));
  const out: Segment[] = [];
  const scan = (points: number[], bull: boolean) => {
    let found = 0;
    for (let j = points.length - 1; j > 0 && found < 3; j--) {
      const b = points[j];
      for (let k = j - 1; k >= 0; k--) {
        const a = points[k];
        if (b - a > 70) break;
        if (b - a < 5 || strength[a] === null || strength[b] === null) continue;
        const pa = bull ? bars[a].low : bars[a].high;
        const pb = bull ? bars[b].low : bars[b].high;
        const priceDiverges = bull ? pb < pa : pb > pa;
        const rsiDiverges = bull ? strength[b]! > strength[a]! + 1.5 : strength[b]! < strength[a]! - 1.5;
        if (priceDiverges && rsiDiverges) {
          out.push({ from: a, to: b, fromPrice: pa, toPrice: pb, bull, label: bull ? 'Bull div' : 'Bear div', dashed: true });
          found++;
          break;
        }
      }
    }
  };
  scan(lows, true);
  scan(highs, false);
  return out;
}

/** Fair value gaps of the last 200 bars that price has not filled yet; the newest 14. */
export function fairValueGaps(bars: Bar[]): Zone[] {
  const gaps: Zone[] = [];
  for (let i = Math.max(2, bars.length - 200); i < bars.length; i++) {
    if (bars[i].low > bars[i - 2].high) gaps.push({ from: i - 1, top: bars[i].low, bottom: bars[i - 2].high, bull: true });
    if (bars[i].high < bars[i - 2].low) gaps.push({ from: i - 1, top: bars[i - 2].low, bottom: bars[i].high, bull: false });
  }
  const open = gaps.filter((g) => {
    for (let k = g.from + 2; k < bars.length; k++) {
      if (g.bull ? bars[k].low <= g.bottom : bars[k].high >= g.top) return false;
    }
    return true;
  });
  return open.slice(-14);
}

/**
 * Market structure. A close beyond the last confirmed swing is a break: BOS when it goes with
 * the trend, CHoCH when it flips it. The last opposite candle before a break is its order
 * block; blocks that price has since closed through are dropped.
 */
export function structure(bars: Bar[]) {
  const width = 4;
  const { highs, lows } = pivots(bars, width);
  const breaks: Segment[] = [];
  const blocks: Zone[] = [];
  let hi = 0;
  let lo = 0;
  let lastHigh: { i: number; price: number; live: boolean } | null = null;
  let lastLow: { i: number; price: number; live: boolean } | null = null;
  let trend = 0;
  for (let i = 0; i < bars.length; i++) {
    // a pivot is only known `width` bars after it, never earlier: no peeking into the future
    while (hi < highs.length && highs[hi] + width <= i) lastHigh = { i: highs[hi], price: bars[highs[hi++]].high, live: true };
    while (lo < lows.length && lows[lo] + width <= i) lastLow = { i: lows[lo], price: bars[lows[lo++]].low, live: true };
    if (lastHigh?.live && bars[i].close > lastHigh.price) {
      const label = trend === -1 ? 'CHoCH' : 'BOS';
      trend = 1;
      lastHigh.live = false;
      breaks.push({ from: lastHigh.i, to: i, fromPrice: lastHigh.price, toPrice: lastHigh.price, bull: true, label, dashed: label === 'CHoCH' });
      for (let j = i - 1; j >= Math.max(lastHigh.i, i - 20); j--) {
        if (bars[j].close < bars[j].open) {
          blocks.push({ from: j, top: bars[j].high, bottom: bars[j].low, bull: true, label: 'OB' });
          break;
        }
      }
    }
    if (lastLow?.live && bars[i].close < lastLow.price) {
      const label = trend === 1 ? 'CHoCH' : 'BOS';
      trend = -1;
      lastLow.live = false;
      breaks.push({ from: lastLow.i, to: i, fromPrice: lastLow.price, toPrice: lastLow.price, bull: false, label, dashed: label === 'CHoCH' });
      for (let j = i - 1; j >= Math.max(lastLow.i, i - 20); j--) {
        if (bars[j].close > bars[j].open) {
          blocks.push({ from: j, top: bars[j].high, bottom: bars[j].low, bull: false, label: 'OB' });
          break;
        }
      }
    }
  }
  const alive = blocks.filter((b) => {
    for (let k = b.from + 1; k < bars.length; k++) {
      if (b.bull ? bars[k].close < b.bottom : bars[k].close > b.top) return false;
    }
    return true;
  });
  return {
    breaks: breaks.slice(-12),
    blocks: [...alive.filter((b) => b.bull).slice(-3), ...alive.filter((b) => !b.bull).slice(-3)],
  };
}

// ---------- strategies with a backtest ----------

export interface Trade {
  dir: number;
  entryIndex: number;
  exitIndex: number;
  entry: number;
  stop: number;
  target: number;
  /** Result in R, the stop distance: +1.4 is 1.4 times what was risked, -1 is a full stop. */
  r: number;
  open: boolean;
}

export interface BacktestStats {
  trades: number;
  winRate: number;
  /** Win rate needed to break even at this target-to-stop ratio. */
  breakEven: number;
  profitFactor: number;
  netR: number;
  rr: number;
  /** Average result of one trade, in R: what the strategy is worth per attempt. */
  avgR: number;
  /** Deepest fall of the running total from its peak, in R. */
  drawdown: number;
}

export interface StrategyResult {
  trades: Trade[];
  open: Trade | null;
  stats: BacktestStats | null;
  /** Not enough candles on this timeframe for the strategy's filters. */
  tooFew: boolean;
}

export interface ExitRules {
  stopAtr: number;
  targetAtr: number;
  maxBars: number;
}

export interface Plan {
  dir: number;
  stop: number;
  target: number;
}

/**
 * Walks forward one position at a time: an entry on bar i fills at its close, then each next
 * bar checks the stop before the target (the pessimistic order when one bar touches both),
 * and a trade that runs out of time closes at market. Results are in R, so a timed-out trade
 * counts for what it really made, not as a full win or loss. `fee` is the exchange's cut per
 * side as a fraction of the position; it is taken off every result, in R.
 */
export function walk(bars: Bar[], planAt: (i: number) => Plan | null, maxBars: number, fee = 0) {
  const trades: Trade[] = [];
  let pos: Trade | null = null;
  const result = (p: Trade, exit: number) => {
    const risk = Math.abs(p.entry - p.stop);
    return ((exit - p.entry) * p.dir) / risk - (2 * fee * p.entry) / risk;
  };
  for (let i = 0; i < bars.length; i++) {
    if (pos && i > pos.entryIndex) {
      const b = bars[i];
      let exit: number | null = null;
      if (pos.dir === 1 ? b.low <= pos.stop : b.high >= pos.stop) exit = pos.stop;
      else if (pos.dir === 1 ? b.high >= pos.target : b.low <= pos.target) exit = pos.target;
      else if (i - pos.entryIndex >= maxBars) exit = b.close;
      if (exit !== null) {
        trades.push({ ...pos, exitIndex: i, r: result(pos, exit), open: false });
        pos = null;
      }
      continue;
    }
    if (pos) continue;
    const plan = planAt(i);
    if (!plan) continue;
    pos = { ...plan, entryIndex: i, exitIndex: bars.length - 1, entry: bars[i].close, r: 0, open: true };
  }
  if (pos) pos.r = result(pos, bars[bars.length - 1].close);
  return { trades, open: pos };
}

/** The walk with stop and target set as multiples of the bar's range (ATR). */
export function backtest(bars: Bar[], entryAt: (i: number) => number, range: Line, rules: ExitRules) {
  const { trades, open } = walk(
    bars,
    (i) => {
      if (range[i] === null || range[i]! <= 0) return null;
      const dir = entryAt(i);
      if (!dir) return null;
      const entry = bars[i].close;
      return { dir, stop: entry - dir * rules.stopAtr * range[i]!, target: entry + dir * rules.targetAtr * range[i]! };
    },
    rules.maxBars,
  );
  return { trades, open, stats: statsOf(trades, rules) };
}

export function statsOf(trades: Trade[], rules: ExitRules): BacktestStats | null {
  if (!trades.length) return null;
  const won = trades.filter((t) => t.r > 0);
  const gross = won.reduce((s, t) => s + t.r, 0);
  const lost = -trades.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  const rr = rules.targetAtr / rules.stopAtr;
  let total = 0;
  let peak = 0;
  let drawdown = 0;
  for (const t of trades) {
    total += t.r;
    peak = Math.max(peak, total);
    drawdown = Math.max(drawdown, peak - total);
  }
  return {
    trades: trades.length,
    winRate: (won.length / trades.length) * 100,
    breakEven: 100 / (1 + rr),
    profitFactor: lost > 0 ? gross / lost : gross > 0 ? Infinity : 0,
    netR: gross - lost,
    rr,
    avgR: (gross - lost) / trades.length,
    drawdown,
  };
}

const RSI2 = { stopAtr: 2.2, targetAtr: 1.4, maxBars: 24, low: 10, high: 90, trend: 200 };

/**
 * Larry Connors' RSI-2: trade pullbacks in the direction of the 200 SMA when the 2-period RSI
 * reaches an extreme. Many small wins, the target is closer than the stop.
 */
export function rsi2Strategy(bars: Bar[]): StrategyResult {
  if (bars.length < RSI2.trend + 10) return { trades: [], open: null, stats: null, tooFew: true };
  const closes = bars.map((b) => b.close);
  const trend = sma(closes, RSI2.trend);
  const fast = rsi(closes, 2);
  const range = atr(bars, 14);
  const entryAt = (i: number) => {
    if (trend[i] === null || fast[i] === null) return 0;
    if (closes[i] > trend[i]! && fast[i]! < RSI2.low) return 1;
    if (closes[i] < trend[i]! && fast[i]! > RSI2.high) return -1;
    return 0;
  };
  return { ...backtest(bars, entryAt, range, RSI2), tooFew: false };
}

const SQUEEZE = { len: 20, bbMult: 2, kcMult: 1.5, volumeMult: 1.5, lookback: 20, stopAtr: 1.3, targetAtr: 5.2, maxBars: 40 };

/**
 * Volatility squeeze breakout: Bollinger bands inside the Keltner channel mark a coil; the
 * first bar out of it that breaks the 20-bar range on a volume burst is the entry. Tight stop,
 * far target: fewer wins, bigger ones.
 */
export function squeezeStrategy(bars: Bar[]): StrategyResult {
  const { len, bbMult, kcMult, volumeMult, lookback } = SQUEEZE;
  if (bars.length < len + 40) return { trades: [], open: null, stats: null, tooFew: true };
  const closes = bars.map((b) => b.close);
  const bands = bollinger(closes, len, bbMult);
  const range = atr(bars, len);
  const volumeAvg = sma(bars.map((b) => b.volume), len);
  const squeezed = bars.map((_, i) => {
    const mid = bands.mid[i];
    if (mid === null || range[i] === null) return false;
    return bands.upper[i]! < mid + kcMult * range[i]! && bands.lower[i]! > mid - kcMult * range[i]!;
  });
  const entryAt = (i: number) => {
    if (i < lookback || squeezed[i] || bands.mid[i] === null) return 0;
    if (!squeezed.slice(Math.max(0, i - 6), i).some(Boolean)) return 0;
    if (!(volumeAvg[i]! > 0 && bars[i].volume > volumeAvg[i]! * volumeMult)) return 0;
    let high = -Infinity;
    let low = Infinity;
    for (let k = i - lookback; k < i; k++) {
      high = Math.max(high, bars[k].high);
      low = Math.min(low, bars[k].low);
    }
    if (closes[i] > high && closes[i] > bands.mid[i]!) return 1;
    if (closes[i] < low && closes[i] < bands.mid[i]!) return -1;
    return 0;
  };
  return { ...backtest(bars, entryAt, range, SQUEEZE), tooFew: false };
}

// ---------- Pulse Setups ----------

export const SETUP = {
  mid: 50,
  slow: 200,
  /** The range price has to leave, in bars. */
  range: 20,
  /** How recently volatility must have been coiled, in bars. */
  coil: 6,
  volume: 1.5,
  /** Bars whose extreme the stop hides behind, and the room it gets, in ATR. */
  swing: 5,
  minStop: 1.2,
  maxStop: 2.5,
  /** A stop closer than this share of price costs too much in fees to be worth trading. */
  minRisk: 0.004,
  rr: 3,
  maxBars: 60,
  /** Taker fee per side on Binance futures without discounts. */
  fee: 0.0005,
};

/** What the setup needs, one answer per condition, for the bar asked about. */
export interface SetupState {
  /** 1 when the trend is up, -1 when down, 0 when there is none to trade with. */
  trend: number;
  /** Volatility was squeezed within the last few bars. */
  coil: boolean;
  /** The bar closed outside the recent range, in the direction of the trend. */
  breakout: boolean;
  volume: boolean;
  /** The stop is far enough for fees not to eat the trade. */
  room: boolean;
}

export interface SetupResult extends StrategyResult {
  /** The conditions on the latest bar: what is in place and what the setup still waits for. */
  state: SetupState | null;
  /** Running total in R after each closed trade. */
  equity: number[];
}

/**
 * Pulse Setups: join a trend as it leaves a coil. The trend is the 50 EMA above (below) the 200
 * with price on the same side; the coil is Bollinger bands inside the Keltner channel a few bars
 * back; the entry is a close outside the 20-bar range on a burst of volume. The stop goes behind
 * the last swing, the target three times as far the other way, so one win pays for three losses
 * and the win rate needed to break even is 25%. Results are after fees.
 */
export function setupsStrategy(bars: Bar[]): SetupResult {
  const { mid, slow, coil, swing, minStop, maxStop, minRisk, rr, maxBars, fee } = SETUP;
  if (bars.length < slow + 30) return { trades: [], open: null, stats: null, tooFew: true, state: null, equity: [] };
  const closes = bars.map((b) => b.close);
  const e50 = ema(closes, mid);
  const e200 = ema(closes, slow);
  const unit = atr(bars, 14);
  const channel = atr(bars, 20);
  const bands = bollinger(closes, 20, 2);
  const volumeAvg = sma(bars.map((b) => b.volume), 20);
  const squeezed = bars.map((_, i) => {
    const m = bands.mid[i];
    if (m === null || channel[i] === null) return false;
    return bands.upper[i]! < m + 1.5 * channel[i]! && bands.lower[i]! > m - 1.5 * channel[i]!;
  });

  /** The stop distance for an entry on bar i in direction dir, before the fee check. */
  const riskAt = (i: number, dir: number) => {
    let extreme = dir === 1 ? Infinity : -Infinity;
    for (let k = Math.max(0, i - swing); k <= i; k++) {
      extreme = dir === 1 ? Math.min(extreme, bars[k].low) : Math.max(extreme, bars[k].high);
    }
    const behind = Math.abs(closes[i] - extreme) + 0.2 * unit[i]!;
    return Math.min(Math.max(behind, minStop * unit[i]!), maxStop * unit[i]!);
  };

  const stateAt = (i: number): SetupState | null => {
    if (i < slow + 10 || e200[i] === null || unit[i] === null || volumeAvg[i] === null) return null;
    const up = e50[i]! > e200[i]! && closes[i] > e200[i]!;
    const down = e50[i]! < e200[i]! && closes[i] < e200[i]!;
    const trend = up ? 1 : down ? -1 : 0;
    let high = -Infinity;
    let low = Infinity;
    for (let k = i - SETUP.range; k < i; k++) {
      high = Math.max(high, bars[k].high);
      low = Math.min(low, bars[k].low);
    }
    return {
      trend,
      coil: squeezed.slice(Math.max(0, i - coil), i).some(Boolean),
      breakout: trend === 1 ? closes[i] > high : trend === -1 ? closes[i] < low : false,
      volume: bars[i].volume >= volumeAvg[i]! * SETUP.volume,
      room: trend !== 0 && riskAt(i, trend) / closes[i] >= minRisk,
    };
  };

  const planAt = (i: number): Plan | null => {
    const s = stateAt(i);
    if (!s || !s.trend || !s.coil || !s.breakout || !s.volume || !s.room) return null;
    const risk = riskAt(i, s.trend);
    return { dir: s.trend, stop: closes[i] - s.trend * risk, target: closes[i] + s.trend * risk * rr };
  };

  const { trades, open } = walk(bars, planAt, maxBars, fee);
  let total = 0;
  return {
    trades,
    open,
    stats: statsOf(trades, { stopAtr: 1, targetAtr: rr, maxBars }),
    tooFew: false,
    state: stateAt(bars.length - 1),
    equity: trades.map((t) => (total += t.r)),
  };
}
