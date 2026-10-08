import { base, usd } from './format';
import { lang } from './i18n';
import type { Signal } from './types';

/**
 * The headline of a signal in the reader's language. English comes ready from the backend;
 * Russian is rebuilt from the signal's fields, which carry everything except the wall size.
 */
export function signalTitle(s: Signal): string {
  if (lang === 'en') return s.title;
  const sym = base(s.symbol);
  const up = s.direction > 0;
  const down = s.direction < 0;
  const v = (digits: number) => s.value.toFixed(digits).replace('.', ',');
  switch (s.type) {
    case 'PUMP':
      return `${sym} растёт на ${v(1)}% за 5 минут`;
    case 'DUMP':
      return `${sym} падает на ${v(1)}% за 5 минут`;
    case 'VOLUME':
      return `${sym}: объём в ${v(1)}× выше часового темпа`;
    case 'OPEN_INTEREST':
      return `Открытый интерес ${sym} ${up ? 'вырос' : down ? 'упал' : 'изменился'} на ${v(1)}% за 15 минут`;
    case 'FUNDING':
      return up
        ? `${sym}: фандинг +${v(3)}%, лонги платят шортам`
        : down
          ? `${sym}: фандинг −${v(3)}%, шорты платят лонгам`
          : `${sym}: фандинг ${v(3)}% от нуля`;
    case 'LIQUIDATIONS':
      return `${sym}: ${usd(s.value)} ${down ? 'лонгов' : up ? 'шортов' : 'позиций'} ликвидировано за 5 минут`;
    case 'WALL':
      return up
        ? `${sym} в ${v(2)}% над стеной на покупку`
        : down
          ? `${sym} в ${v(2)}% под стеной на продажу`
          : `${sym} в ${v(2)}% от стены`;
  }
}

/** The context line under the headline; only the backend's English version exists. */
export const signalDetail = (s: Signal) => (lang === 'en' ? s.detail : '');
