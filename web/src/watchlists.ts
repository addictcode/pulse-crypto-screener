/** One named list of pairs. The star in the pair list adds to the list that is active. */
export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export const MAX_LISTS = 6;
export const MAX_NAME = 20;

const SYMBOL = /^[A-Z0-9]{2,24}$/;

/**
 * What storage holds may be anything: an older shape, a hand-edited value, an imported file.
 * Only well-formed lists survive. With none left, the single list of earlier versions (`legacy`,
 * a plain array of symbols) becomes the first one, so nobody loses the pairs they had starred.
 */
export function sanitizeLists(raw: unknown, legacy: unknown, firstName: string): Watchlist[] {
  const symbolsOf = (value: unknown) =>
    Array.isArray(value) ? [...new Set(value.filter((s): s is string => typeof s === 'string' && SYMBOL.test(s)))] : [];
  const lists: Watchlist[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw as Array<Partial<Watchlist> | null>) {
      const name = typeof item?.name === 'string' ? item.name.trim().slice(0, MAX_NAME) : '';
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!name || !id || lists.some((l) => l.id === id)) continue;
      lists.push({ id, name, symbols: symbolsOf(item?.symbols) });
      if (lists.length === MAX_LISTS) break;
    }
  }
  if (lists.length) return lists;
  const kept = symbolsOf(legacy);
  return [{ id: 'main', name: firstName, symbols: Array.isArray(legacy) ? kept : ['BTCUSDT', 'ETHUSDT'] }];
}

/** The same lists with `symbol` added to list `id`, or taken out of it if it was there. */
export function toggled(lists: Watchlist[], id: string, symbol: string): Watchlist[] {
  return lists.map((l) =>
    l.id !== id ? l : { ...l, symbols: l.symbols.includes(symbol) ? l.symbols.filter((s) => s !== symbol) : [...l.symbols, symbol] },
  );
}
