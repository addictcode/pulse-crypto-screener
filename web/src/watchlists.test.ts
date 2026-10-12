import { describe, expect, it } from 'vitest';

import { MAX_LISTS, sanitizeLists, toggled } from './watchlists';

describe('watchlists', () => {
  it('turns the single list of earlier versions into the first list', () => {
    expect(sanitizeLists(null, ['SOLUSDT', 'WIFUSDT'], 'Watchlist')).toEqual([{ id: 'main', name: 'Watchlist', symbols: ['SOLUSDT', 'WIFUSDT'] }]);
  });

  it('keeps an emptied old list empty and starts a newcomer with the two majors', () => {
    expect(sanitizeLists(null, [], 'Watchlist')[0].symbols).toEqual([]);
    expect(sanitizeLists(null, null, 'Watchlist')[0].symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('drops what is not a list and what is not a symbol', () => {
    const lists = sanitizeLists(
      [{ id: 'a', name: ' Majors ', symbols: ['BTCUSDT', 'btc', 7, 'BTCUSDT'] }, { id: 'a', name: 'Twin' }, { name: 'No id' }, null, 'text'],
      ['SOLUSDT'],
      'Watchlist',
    );
    expect(lists).toEqual([{ id: 'a', name: 'Majors', symbols: ['BTCUSDT'] }]);
  });

  it('never keeps more lists than the screen has room for', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `List ${i}`, symbols: [] }));
    expect(sanitizeLists(many, null, 'Watchlist')).toHaveLength(MAX_LISTS);
  });

  it('adds a pair to one list and takes it out again, leaving the others alone', () => {
    const lists = [
      { id: 'a', name: 'A', symbols: ['BTCUSDT'] },
      { id: 'b', name: 'B', symbols: ['BTCUSDT'] },
    ];
    const added = toggled(lists, 'a', 'SOLUSDT');
    expect(added[0].symbols).toEqual(['BTCUSDT', 'SOLUSDT']);
    expect(toggled(added, 'a', 'BTCUSDT')[0].symbols).toEqual(['SOLUSDT']);
    expect(added[1]).toBe(lists[1]);
  });
});
