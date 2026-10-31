/** The data side of the before / after template, kept apart from the JSX so the render script can use it. */
import type { MarketEvent } from './story.ts';

/** The halves: the move is the last five minutes up to the event minute, the calm everything before. */
export function halves(event: MarketEvent) {
  const calm = event.candles.slice(0, event.at - 5);
  const move = event.candles.slice(event.at - 5, event.at + 1);
  const change = (calm[calm.length - 1].c / calm[0].o - 1) * 100;
  return { calm, move, change };
}

/** Only events whose "before" really was calm: it moved less than a third of the move. */
export const splitFits = (event: MarketEvent) => event.at >= 25 && Math.abs(halves(event).change) < Math.abs(event.move) / 3;
