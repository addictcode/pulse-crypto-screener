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

export type StreamMessage =
  | { type: 'snapshot'; ts: number; rows: SymbolMetrics[]; liquidations: Liquidation[] }
  | { type: 'delta'; ts: number; rows: SymbolMetrics[] }
  | { type: 'liquidations'; items: Liquidation[] }
  | { type: 'sparklines'; series: Record<string, number[]> }
  | { type: 'walls'; ts: number; walls: Wall[]; coverage: Record<string, number> };

export interface CandleDto {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
