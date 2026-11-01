/** The data side of the trap series, kept apart from the JSX so the render script can use it. */
import { type MarketEvent, story } from './story.ts';

const WEEK = 7 * 24 * 60 * 60_000;

/**
 * Threes of traps (moves that turned against themselves within the hour, see story.ts), in time
 * order, each three within a week: the hook says "3 times in a week" and it must be true. Next
 * threes overlap by one event, so an event is in two videos at most.
 */
export function trapSeries(events: MarketEvent[]): MarketEvent[][] {
  const traps = events.filter((e) => story(e, 0).plot === 'trap').sort((a, b) => a.time - b.time);
  const out: MarketEvent[][] = [];
  for (let i = 0; i + 3 <= traps.length; ) {
    const three = traps.slice(i, i + 3);
    if (three[2].time - three[0].time <= WEEK) {
      out.push(three);
      i += 2;
    } else i++;
  }
  return out;
}
