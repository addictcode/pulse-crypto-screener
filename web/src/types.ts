// Mirrors of the backend records. Keep in sync with dev.pulse.market.SymbolMetrics
// and dev.pulse.stream.StreamMessage. Percent fields are already in percent; null means
// the backend does not have enough history yet.

export interface SymbolMetrics {
  symbol: string;
  price: number;
  ch1m: number | null;
  ch5m: number | null;
  ch15m: number | null;
  ch1h: number | null;
  ch24h: number | null;
  high24h: number | null;
  low24h: number | null;
  vol24h: number;
  surge: number | null;
  natr: number | null;
  funding: number | null;
  nextFunding: number | null;
  oi: number | null;
  oiCh15m: number | null;
  liq5m: number;
}

export interface Liquidation {
  symbol: string;
  side: 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  time: number;
}

/** Mirror of dev.pulse.depth.Wall. distance is signed percent from the mid, age in seconds. */
export interface Wall {
  symbol: string;
  side: 'BID' | 'ASK';
  price: number;
  size: number;
  distance: number;
  multiple: number;
  age: number;
  eatMinutes: number | null;
}

export type SignalType = 'PUMP' | 'DUMP' | 'VOLUME' | 'OPEN_INTEREST' | 'FUNDING' | 'LIQUIDATIONS' | 'WALL';

/** Mirror of dev.pulse.signal.Signal. value is in the type's unit (%, multiple, USD). */
export interface Signal {
  id: number;
  type: SignalType;
  symbol: string;
  time: number;
  price: number;
  value: number;
  title: string;
  detail: string;
  /** Which way the event points: 1 up, -1 down, 0 unknown. */
  direction: number;
  /** Price change in percent after the signal; null until that horizon has passed. */
  ret5m: number | null;
  ret15m: number | null;
  ret1h: number | null;
}

/** Mirror of dev.pulse.signal.OutcomeStats: how one kind of signal played out. */
export interface OutcomeStats {
  type: SignalType;
  direction: number;
  label: string;
  horizons: Array<{ horizon: string; n: number; avg: number | null; upShare: number | null }>;
}

/** Mirror of dev.pulse.compare.VenueGap: one symbol on Binance against the same contract on Bybit. */
export interface VenueGap {
  symbol: string;
  price: number;
  /** How far Bybit trades from Binance, in percent. */
  gap: number | null;
  funding: number | null;
  fundingHours: number;
  /** The Binance funding interval in hours. */
  homeHours: number;
  /** Binance funding minus Bybit funding, both per 8 hours. */
  spread8h: number | null;
  spreadApr: number | null;
  oi: number | null;
  oiShare: number | null;
  vol24h: number;
}

/** One reading of a statistic: epoch seconds and the figure. */
export interface Point {
  time: number;
  value: number;
}

/** Mirror of dev.pulse.market.Positioning. Every series is oldest first and may be empty. */
export interface Positioning {
  /** Open interest in USD. */
  openInterest: Point[];
  /** Accounts net long divided by accounts net short. */
  longShortAccounts: Point[];
  /** The same ratio by position size among the largest traders. */
  longShortTop: Point[];
  /** Volume of market buys divided by market sells. */
  takerBuySell: Point[];
  /** Funding rate in percent at each payment. */
  funding: Point[];
}

export type TapeKind =
  | 'PUMP_1M' | 'PUMP_5M' | 'DUMP_1M' | 'DUMP_5M' | 'VOLUME' | 'OI_UP' | 'OI_DOWN' | 'LIQ_LONGS' | 'LIQ_SHORTS';

/** Mirror of dev.pulse.signal.TapeItem: the loose live feed. */
export interface TapeItem {
  kind: TapeKind;
  symbol: string;
  time: number;
  price: number;
  value: number;
}

export type StreamMessage =
  | { type: 'snapshot'; ts: number; rows: SymbolMetrics[]; liquidations: Liquidation[] }
  /** Changed fields only (plus the symbol); now and then whole rows. */
  | { type: 'delta'; ts: number; rows: Array<Partial<SymbolMetrics> & { symbol: string }> }
  | { type: 'liquidations'; items: Liquidation[] }
  | { type: 'sparklines'; series: Record<string, number[]> }
  | { type: 'walls'; ts: number; walls: Wall[]; coverage: Record<string, number> }
  | { type: 'signals'; items: Signal[] }
  | { type: 'outcomes'; items: Signal[] }
  | { type: 'tape'; items: TapeItem[] };

export interface CandleDto {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
