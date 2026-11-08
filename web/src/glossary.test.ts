import { describe, expect, it } from 'vitest';

import { TERMS, meaning } from './glossary';
import { RU } from './locale-ru';

const KINDS = ['PUMP', 'DUMP', 'VOLUME', 'OPEN_INTEREST', 'FUNDING', 'LIQUIDATIONS', 'WALL', 'PUMP_1M', 'DUMP_5M', 'OI_UP', 'OI_DOWN', 'LIQ_LONGS', 'LIQ_SHORTS', 'LIQUIDATION'] as const;

describe('the glossary', () => {
  it('explains every event in the feed', () => {
    for (const kind of KINDS) expect(meaning(kind).length).toBeGreaterThan(20);
  });

  it('never says where the price goes', () => {
    const texts = [...Object.values(TERMS), ...KINDS.map(meaning)];
    for (const text of texts) {
      expect(text.toLowerCase()).not.toMatch(/will (rise|fall|go up|go down)|forecast|predict|expect|soon|buy|sell/);
      expect((RU[text] ?? '').toLowerCase()).not.toMatch(/вырастет|упадёт|прогноз|предсказ|покупай|продавай/);
    }
  });
});
