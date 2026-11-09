// What makes an event fit for a video or a round of the game (PLAN-5 1.6). The archive search
// finds every sharp minute, and some of them are not the story Pulse tells:
//   - shares, funds and metals: Binance lists perpetuals on them too; a coin with a spot market is
//     crypto (as in research/archive.py and play-rounds.mjs);
//   - more than MAX_MOVE in five minutes: a listing, a delisting, a broken feed, not a market;
//   - a spike of one candle that comes all the way back: a wick in a thin book, gone before anyone
//     could see it;
//   - a coin named like a word of the captions (THE, ON, BE...): the videos never name the coin, and
//     a test that looks for tickers in the text cannot tell "the" from THE.
// events.test.mjs and play-rounds.test.mjs hold events.json and the site's rounds to these rules.

/** Five minutes, in percent; past this it is not a market move. */
export const MAX_MOVE = 30;
/** Of the move, at most this much may be left two candles on for it to count as a one-candle spike. */
export const SPIKE_LEFT = 0.2;
const WINDOW = 5;
/** Coins whose name is an everyday word in English or a short one in Russian captions. */
export const WORDS = new Set(['A', 'I', 'AT', 'BE', 'GO', 'IN', 'IS', 'IT', 'ME', 'MY', 'NO', 'OK', 'ON', 'OR', 'TO', 'UP', 'WE',
  'ALL', 'AND', 'ANY', 'ARE', 'BIG', 'BUY', 'FOR', 'NOT', 'NOW', 'ONE', 'OUT', 'THE', 'WIN', 'YES', 'YOU', 'PUMP', 'DUMP', 'MOON']);

/** A perpetual on a coin with a Binance spot market; 1000PEPE is PEPE on spot. */
export function isCrypto(symbol, spot) {
  return spot.has(symbol) || spot.has(symbol.replace(/^1000+/, '').replace(/^1M/, ''));
}

/**
 * @param bars minute candles as {o, h, l, c}, the event's candle at index {@code at}
 * @returns why the event is not fit, or null
 */
export function problem({ symbol, type, at, bars }, spot) {
  if (spot && !isCrypto(symbol, spot)) return `${symbol} is not crypto (no Binance spot market)`;
  if (WORDS.has(symbol.replace(/USDT$/, '').replace(/^1000+/, ''))) return `${symbol} is named like a word of the captions`;
  if (at < WINDOW || at + 1 >= bars.length) return 'not enough candles around the event';
  const up = type === 'PUMP';
  const window = bars.slice(at - WINDOW, at + 1);
  const base = up ? Math.min(...window.map((b) => b.l)) : Math.max(...window.map((b) => b.h));
  const peak = up ? bars[at].h : bars[at].l;
  const move = (peak / base - 1) * 100;
  if (Math.abs(move) > MAX_MOVE) return `${move.toFixed(1)}% in five minutes is past ${MAX_MOVE}%`;
  // where the price settled: the close of the event candle and of the one after, whichever kept more
  const kept = Math.max(...[bars[at].c, bars[at + 1].c].map((c) => (up ? c - base : base - c) / Math.abs(peak - base)));
  if (kept < SPIKE_LEFT) return `a one-candle spike: ${Math.round(kept * 100)}% of the move left a minute later`;
  return null;
}

/** An event of events.json in the shape problem() reads. */
export const fromEvent = (e) => ({ symbol: e.symbol, type: e.type, at: e.at, bars: e.candles });

/** A round of the site's game: candles are [o, h, l, c]; the direction is the event's. */
export const fromRound = (r) => ({
  symbol: `${r.coin}USDT`,
  type: r.type,
  at: r.at,
  bars: r.candles.map(([o, h, l, c]) => ({ o, h, l, c })),
});
