/** The data side of the volume template, kept apart from the JSX so the render script can use it. */
import type { MarketEvent } from './story.ts';

/**
 * The volume burst: the biggest minute of the five up to the event against the average minute
 * before them, as a whole multiple. The numbers are USDT turnover from the candles.
 */
export function burst(event: MarketEvent) {
  const before = event.candles.slice(0, event.at - 5);
  const average = before.reduce((sum, c) => sum + c.v, 0) / before.length;
  const window = event.candles.slice(event.at - 5, event.at + 1);
  const peak = Math.max(...window.map((c) => c.v));
  return { average, peak, times: Math.floor(peak / average) };
}

/** A burst worth a video: at least five times the average minute. */
export const volumeFits = (event: MarketEvent) => event.at >= 25 && burst(event).times >= 5;
