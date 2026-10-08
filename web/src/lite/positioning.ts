// dev.pulse.exchange.binance.BinanceAdapter#positioning for the standalone demo: the same five
// public statistics, asked for by the browser.

import type { Point, Positioning } from '../types';
import { BINANCE_REST } from './feed';

/** Rows of a Binance statistic into points: seconds, numbers, oldest first, blanks dropped. */
export function toPoints(rows: Array<Record<string, string | number>>, timeField: string, valueField: string, scale = 1): Point[] {
  return rows
    .filter((r) => r[valueField] !== '' && r[valueField] !== undefined && Number.isFinite(Number(r[valueField])))
    .map((r) => ({ time: Math.floor(Number(r[timeField]) / 1000), value: Math.round(Number(r[valueField]) * scale * 1e8) / 1e8 }))
    .sort((a, b) => a.time - b.time);
}

async function series(url: string, timeField: string, valueField: string, scale = 1): Promise<Point[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    return toPoints((await response.json()) as Array<Record<string, string | number>>, timeField, valueField, scale);
  } catch {
    return []; // freshly listed contracts have no statistics yet; the other series still load
  }
}

export async function positioningFromBinance(symbol: string, period: string, limit: number): Promise<Positioning> {
  const data = (path: string) => `${BINANCE_REST}/futures/data/${path}?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${limit}`;
  const [openInterest, longShortAccounts, longShortTop, takerBuySell, funding] = await Promise.all([
    series(data('openInterestHist'), 'timestamp', 'sumOpenInterestValue'),
    series(data('globalLongShortAccountRatio'), 'timestamp', 'longShortRatio'),
    series(data('topLongShortPositionRatio'), 'timestamp', 'longShortRatio'),
    series(data('takerlongshortRatio'), 'timestamp', 'buySellRatio'),
    series(`${BINANCE_REST}/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=${Math.min(limit, 200)}`, 'fundingTime', 'fundingRate', 100),
  ]);
  return { openInterest, longShortAccounts, longShortTop, takerBuySell, funding };
}
