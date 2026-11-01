import { describe, expect, it } from 'vitest';

import { telegramTargets } from './telegram';

describe('telegramTargets', () => {
  it('links to the bot with a start from the site, and to the channel', () => {
    expect(telegramTargets({ bot: 'PulseBot', channel: 'pulse_signals' })).toEqual([
      { kind: 'bot', name: 'PulseBot', href: 'https://t.me/PulseBot?start=site', label: 'Signals in Telegram' },
      { kind: 'channel', name: 'pulse_signals', href: 'https://t.me/pulse_signals', label: 'Channel' },
    ]);
  });

  it('gives no button for a link that is not set up', () => {
    expect(telegramTargets({ bot: '', channel: '' })).toEqual([]);
    expect(telegramTargets({ bot: '', channel: 'pulse_signals' }).map((x) => x.kind)).toEqual(['channel']);
  });
});
