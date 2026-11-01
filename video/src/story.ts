/**
 * What a video says about one market event. The story comes from the candles alone: how far the
 * move went in five minutes and what the price did over the next hour. The captions are meme
 * formats with the real numbers in them; nothing is promised, nothing is made up.
 *
 * Videos are posted later and in any order, so nothing in them dates them or ties them to a coin:
 * no ticker, no date, no clock. The chart and the numbers are real, the coin stays anonymous.
 */

import { type Lang, type Plot, TEXT, pct } from './text.ts';

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type MarketEvent = {
  id: string;
  symbol: string;
  base: string;
  type: 'PUMP' | 'DUMP';
  time: number;
  price: number;
  /** percent in five minutes, signed */
  move: number;
  /** index of the signal minute in candles */
  at: number;
  candles: Candle[];
};

export type { Lang, Plot } from './text.ts';

export type Story = {
  plot: Plot;
  up: boolean;
  /** percent over the hour after the signal, signed */
  hour: number;
  /** the furthest the price went the signal's way within the hour, signed percent */
  further: number;
  /** the five minute move itself, signed percent */
  move: number;
  /** the quiet beat before the chart */
  calm: string;
  hook: string;
  punch: string;
  /** a description for the post */
  caption: string;
};

const HOUR = 60;

export { pct };

/** How many ways one event can be told. */
export const TELLINGS = 5;

export function story(e: MarketEvent, variant: number, lang: Lang = 'ru'): Story {
  const up = e.type === 'PUMP';
  const after = e.candles.slice(e.at, e.at + HOUR + 1);
  const last = after[after.length - 1].c;
  const hour = (last / e.price - 1) * 100;
  const extreme = up ? Math.max(...after.map((c) => c.h)) : Math.min(...after.map((c) => c.l));
  const further = (extreme / e.price - 1) * 100;
  const sign = up ? 1 : -1;
  // a third of the move given back against it is a trap; another half again its way is a rocket
  const plot: Plot =
    hour * sign <= -Math.abs(e.move) / 3 ? 'trap' : further * sign >= Math.abs(e.move) / 2 ? 'rocket' : 'flat';
  const text = TEXT[lang];
  const pair = text.pairs[`${plot}-${up ? 'up' : 'down'}`][variant % TELLINGS];
  const n = { hour, further, move: e.move };
  const calm = text.calm[(variant + e.id.charCodeAt(0)) % text.calm.length];
  return { plot, up, ...n, calm, hook: pair.hook(n), punch: pair.punch(n), caption: pair.caption };
}
