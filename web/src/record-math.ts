import type { OutcomeStats } from './types';

/** One horizon of one kind of signal, turned to face the way the signal pointed. */
export interface Followed {
  n: number;
  /** average move in the signal's direction, percent; negative when the price went against it */
  move: number;
  /** share of signals after which the price went the signal's way, 0..1 */
  share: number;
}

/**
 * "WIF dumped" pointing down and the price falling afterwards is the signal being right, so a
 * down signal's numbers are flipped. Signals without a direction have no right way to go.
 */
export function followed(stats: OutcomeStats, horizon: number): Followed | null {
  const cell = stats.horizons[horizon];
  if (!cell || stats.direction === 0 || cell.n === 0 || cell.avg === null || cell.upShare === null) return null;
  const up = stats.direction > 0;
  return { n: cell.n, move: up ? cell.avg : -cell.avg, share: up ? cell.upShare : 1 - cell.upShare };
}

/** Every directional signal at one horizon taken together, each kind weighted by its count. */
export function overall(all: OutcomeStats[], horizon: number): Followed | null {
  let n = 0;
  let move = 0;
  let share = 0;
  for (const stats of all) {
    const f = followed(stats, horizon);
    if (!f) continue;
    n += f.n;
    move += f.move * f.n;
    share += f.share * f.n;
  }
  return n === 0 ? null : { n, move: move / n, share: share / n };
}
