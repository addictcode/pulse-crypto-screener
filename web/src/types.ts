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

export type StreamMessage =
  | { type: 'snapshot'; ts: number; rows: SymbolMetrics[]; liquidations: Liquidation[] }
  | { type: 'delta'; ts: number; rows: SymbolMetrics[] }
  | { type: 'liquidations'; items: Liquidation[] }
  | { type: 'sparklines'; series: Record<string, number[]> };

export interface CandleDto {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
