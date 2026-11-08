// The rules of the game at /play/, apart from the page so they can be tested: which answer is
// right, the coin, the score and what the result says. See video/scripts/play-rounds.mjs for the
// rounds themselves.
import { load, save } from './storage';

/** [open, high, low, close] of one minute. */
export type Bar = [number, number, number, number];

export interface Round {
  id: string;
  coin: string;
  /** YYYY-MM-DD, shown only after the answer */
  day: string;
  type: 'PUMP' | 'DUMP';
  /** index of the signal candle: the question stops after it */
  at: number;
  /** the close the question stops on */
  price: number;
  /** percent from that close to the close an hour later */
  hour: number;
  candles: Bar[];
}

export type Pick = 'up' | 'down';

export const ROUNDS = 10;

export const answerOf = (r: Round): Pick => (r.hour > 0 ? 'up' : 'down');

/** A fair coin; the page passes Math.random, tests a fixed sequence. */
export const coinToss = (random: () => number): Pick => (random() < 0.5 ? 'up' : 'down');

/** A series in progress: kept in localStorage, so a reload continues where it stopped. */
export interface Series {
  pack: number;
  picks: Pick[];
  coins: Pick[];
}

export interface Totals {
  games: number;
  rounds: number;
  you: number;
  coin: number;
}

export function score(rounds: Round[], series: Series): { you: number; coin: number } {
  let you = 0;
  let coin = 0;
  series.picks.forEach((pick, i) => {
    if (pick === answerOf(rounds[i])) you++;
    if (series.coins[i] === answerOf(rounds[i])) coin++;
  });
  return { you, coin };
}

/**
 * What the result says, as keys of the dictionary. Honest whichever way it went: ten rounds are
 * few, a coin lands anywhere from 3 to 7 in about nine games out of ten, and a good score is no
 * sign of a talent for trading.
 */
export function verdict(you: number, coin: number): string {
  if (you > coin) return 'You beat the coin this time. Over ten rounds luck alone does that often: a coin itself gets anywhere from 3 to 7 right in about nine games out of ten.';
  if (you === coin) return 'A draw with the coin. That is what guessing the next hour usually looks like.';
  return 'The coin won this time. No shame in it: the next hour is hard to call for anyone.';
}

/** The pack for a new game: one not played yet, or, once all were, the one played longest ago. */
export function nextPack(packs: number, played: number[]): number {
  for (let i = 1; i <= packs; i++) if (!played.includes(i)) return i;
  return played.find((p) => p >= 1 && p <= packs) ?? 1;
}

/** Remembers a finished pack at the end of the list, so the oldest comes first. */
export const markPlayed = (played: number[], pack: number) => [...played.filter((p) => p !== pack), pack];

const KEY_SERIES = 'playSeries';
const KEY_TOTALS = 'playTotals';
const KEY_PLAYED = 'playPacks';

export const storedSeries = () => load<Series | null>(KEY_SERIES, null);
export const storeSeries = (series: Series | null) => save(KEY_SERIES, series);
export const storedTotals = () => load<Totals>(KEY_TOTALS, { games: 0, rounds: 0, you: 0, coin: 0 });
export const storedPlayed = () => load<number[]>(KEY_PLAYED, []);

/** Adds a finished game to what this browser remembers and returns the new totals. */
export function finish(pack: number, you: number, coin: number): Totals {
  const totals = storedTotals();
  const next = { games: totals.games + 1, rounds: totals.rounds + ROUNDS, you: totals.you + you, coin: totals.coin + coin };
  save(KEY_TOTALS, next);
  save(KEY_PLAYED, markPlayed(storedPlayed(), pack));
  storeSeries(null);
  return next;
}

/**
 * The price range the chart may use. Until the answer it knows only the candles shown: a scale
 * already stretched to where the price goes next would give the answer away (as in GuessVideo).
 */
export function priceRange(candles: Bar[], upTo: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < Math.min(upTo, candles.length); i++) {
    lo = Math.min(lo, candles[i][2]);
    hi = Math.max(hi, candles[i][1]);
  }
  const pad = (hi - lo) * 0.08 || hi * 0.001;
  return [lo - pad, hi + pad];
}
