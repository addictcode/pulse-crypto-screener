// dev.pulse.compare.VenueComparison for the standalone demo: Bybit's tickers are read straight
// from the browser and joined with the market the page already holds.

import type { Market } from '../market';
import type { SymbolMetrics, VenueGap } from '../types';
import { BINANCE_REST } from './feed';
import { round } from './metrics';

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  fundingRate: string;
  fundingIntervalHour: string;
  openInterestValue: string;
  turnover24h: string;
}

const PERIODS_PER_YEAR = 3 * 365;
const number = (text: string): number | null => (text === '' || text === undefined || Number.isNaN(Number(text)) ? null : Number(text));

/** Binance funding minus Bybit funding, both brought to 8 hours: the two pay at different intervals. */
export function compareVenues(home: SymbolMetrics, homeHours: number, away: BybitTicker): VenueGap | null {
  const price = number(away.lastPrice);
  if (!price || home.price <= 0) return null;
  const funding = number(away.fundingRate);
  const fundingPct = funding === null ? null : funding * 100;
  const hours = number(away.fundingIntervalHour) || 8;
  const oi = number(away.openInterestValue);
  const spread8h = home.funding === null || fundingPct === null ? null : (home.funding * 8) / homeHours - (fundingPct * 8) / hours;
  return {
    symbol: home.symbol,
    price,
    gap: round((price / home.price - 1) * 100, 3),
    funding: round(fundingPct, 4),
    fundingHours: hours,
    homeHours,
    spread8h: round(spread8h, 4),
    spreadApr: round(spread8h === null ? null : spread8h * PERIODS_PER_YEAR, 1),
    oi: round(oi, 0),
    oiShare: round(home.oi === null || oi === null || home.oi + oi <= 0 ? null : oi / (home.oi + oi), 3),
    vol24h: Math.round(number(away.turnover24h) ?? 0),
  };
}

let fundingHours: Promise<Map<string, number>> | null = null;

function binanceFundingHours(): Promise<Map<string, number>> {
  fundingHours ??= fetch(`${BINANCE_REST}/fapi/v1/fundingInfo`)
    .then((r) => r.json() as Promise<Array<{ symbol: string; fundingIntervalHours: number }>>)
    .then((rows) => new Map(rows.filter((f) => f.fundingIntervalHours > 0).map((f) => [f.symbol, f.fundingIntervalHours])))
    .catch(() => new Map());
  return fundingHours;
}

export async function compareWithBybit(market: Market): Promise<VenueGap[]> {
  const [hours, response] = await Promise.all([binanceFundingHours(), fetch('https://api.bybit.com/v5/market/tickers?category=linear')]);
  if (!response.ok) return [];
  const body = (await response.json()) as { retCode: number; result?: { list?: BybitTicker[] } };
  if (body.retCode !== 0) return [];
  const gaps: VenueGap[] = [];
  for (const ticker of body.result?.list ?? []) {
    const home = market.rows.get(ticker.symbol);
    const gap = home && compareVenues(home, hours.get(ticker.symbol) ?? 8, ticker);
    if (gap) gaps.push(gap);
  }
  return gaps;
}
