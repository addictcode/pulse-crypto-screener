/**
 * What a video says about one market event. The story comes from the candles alone: how far the
 * move went in five minutes and what the price did over the next hour. The captions are meme
 * formats with the real numbers in them; nothing is promised, nothing is made up.
 *
 * Videos are posted later and in any order, so nothing in them dates them or ties them to a coin:
 * no ticker, no date, no clock. The chart and the numbers are real, the coin stays anonymous.
 */

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

/** rocket: kept going; trap: turned against the move; flat: neither */
export type Plot = 'rocket' | 'trap' | 'flat';

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

export const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;
const abs = (v: number) => `${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;

type Pair = { hook: (s: Story) => string; punch: (s: Story) => string; caption: string };

/**
 * Hook and punchline go together, so each telling is a pair. Keyed by plot and by whether the
 * move was up or down: "bought the breakout" only makes sense for a pump.
 */
const PAIRS: Record<`${Plot}-${'up' | 'down'}`, Pair[]> = {
  'rocket-up': [
    { hook: () => 'POV: ты продал\nза минуту до этого', punch: (s) => `…и это было только начало:\nещё ${pct(s.further)}`, caption: 'Классика: продал ровно перед ракетой' },
    { hook: () => 'Поставил тейк\nна +2% 😌', punch: (s) => `Рынок:\nещё ${pct(s.further)}`, caption: 'Тейк на +2% — это стратегия' },
    { hook: () => 'Шортисты:\n«ну теперь-то откат» 😎', punch: (s) => `Откат через час:\nещё ${pct(s.further)} 💀`, caption: 'Шортить ракету — смелое решение' },
    { hook: () => 'Ты: «уже слишком\nвысоко, не зайду»', punch: (s) => `График через час:\nещё ${pct(s.further)}`, caption: 'Слишком высоко — говорили они' },
    { hook: () => 'Никто:\n\nАльткоины в 3 ночи:', punch: (s) => `И не остановились:\nещё ${pct(s.further)}`, caption: 'Пока ты спишь, рынок не спит' },
  ],
  'rocket-down': [
    { hook: () => 'POV: ты зашёл в лонг\n«на откате»', punch: (s) => `…и это было только начало:\nещё ${pct(s.further)}`, caption: 'Откат, говорили они' },
    { hook: () => '«Это просто\nкоррекция»', punch: (s) => `Коррекция через час:\nещё ${pct(s.further)} 💀`, caption: 'Здоровая коррекция' },
    { hook: () => 'Лонгисты:\n«ниже уже некуда» 😎', punch: (s) => `Нашлось куда:\nещё ${pct(s.further)}`, caption: 'Ниже некуда — всегда есть куда' },
    { hook: () => 'Когда купил дип', punch: (s) => `У дипа был\nещё один дип: ${pct(s.further)}`, caption: 'Buy the dip, они сказали' },
    { hook: () => 'Никто:\n\nАльткоины в 3 ночи:', punch: (s) => `И это не дно:\nещё ${pct(s.further)}`, caption: 'Ночной рынок не прощает' },
  ],
  'trap-up': [
    { hook: () => 'Купил на пробое 🚀', punch: (s) => `Через час: ${pct(s.hour)} 🤡`, caption: 'Пробой, который не пробой' },
    { hook: (s) => `${pct(s.move)} за 5 минут.\nТы: заходишь`, punch: (s) => `Ты через час:\n${pct(s.hour)}`, caption: 'FOMO — лучший индикатор. Наоборот' },
    { hook: () => 'Ожидание:', punch: (s) => `Реальность:\n${pct(s.hour)} за час`, caption: 'Ожидание vs реальность' },
    { hook: () => 'Когда наконец\nрешился войти', punch: (s) => `Рынок через час:\n${pct(s.hour)}`, caption: 'Рынок ждал только тебя' },
    { hook: () => 'FOMO включилось', punch: (s) => `FOMO через час:\n${pct(s.hour)} 🫠`, caption: 'Не гонись за свечой' },
  ],
  'trap-down': [
    { hook: () => 'Продал на самом дне', punch: (s) => `Через час: ${pct(s.hour)} 🤡`, caption: 'Продал дно — классика' },
    { hook: (s) => `${pct(s.move)} за 5 минут.\nТы: шортишь`, punch: (s) => `Ты через час:\n${pct(s.hour)} против тебя`, caption: 'Шорт в самый низ' },
    { hook: () => 'Ожидание:', punch: (s) => `Реальность:\n${pct(s.hour)} за час`, caption: 'Ожидание vs реальность' },
    { hook: () => 'Паника.\nПродаю всё.', punch: (s) => `Через час:\n${pct(s.hour)} 🫠`, caption: 'Паника — плохой советник' },
    { hook: () => 'Шорт с идеальной\nточкой входа', punch: (s) => `Идеальная точка\nчерез час: ${pct(s.hour)}`, caption: 'Идеальный вход, неидеальный рынок' },
  ],
  'flat-up': [
    { hook: () => 'Что произошло,\nпока ты моргнул:', punch: (s) => `А через час ${pct(s.hour)}.\nНу и кто тут умный?`, caption: 'Моргнул — пропустил' },
    { hook: () => 'Никто:\n\nРынок:', punch: (s) => `Через час: ${pct(s.hour)}`, caption: 'Рынок просто так' },
    { hook: () => '5 минут.\nВсего 5 минут.', punch: (s) => `${abs(s.move)} за 5 минут.\nЧерез час: ${pct(s.hour)}`, caption: 'Пять минут, которые всё решили' },
    { hook: () => 'Когда отошёл\nза кофе ☕', punch: (s) => `Пока пил кофе:\n${pct(s.move)}`, caption: 'Никогда не отходи за кофе' },
    { hook: () => 'Скорость этого рынка:', punch: (s) => `${pct(s.move)} за 5 минут.\nЭто не баг.`, caption: 'Фьючерсы не ждут' },
  ],
  'flat-down': [
    { hook: () => 'Что произошло,\nпока ты моргнул:', punch: (s) => `А через час ${pct(s.hour)}.\nНу и кто тут умный?`, caption: 'Моргнул — пропустил' },
    { hook: () => 'Никто:\n\nРынок:', punch: (s) => `Через час: ${pct(s.hour)}`, caption: 'Рынок просто так' },
    { hook: () => '5 минут.\nВсего 5 минут.', punch: (s) => `${abs(s.move)} за 5 минут.\nЧерез час: ${pct(s.hour)}`, caption: 'Пять минут, которые всё решили' },
    { hook: () => 'Когда отошёл\nза кофе ☕', punch: (s) => `Пока пил кофе:\n${pct(s.move)}`, caption: 'Никогда не отходи за кофе' },
    { hook: () => 'Скорость этого рынка:', punch: (s) => `${pct(s.move)} за 5 минут.\nЭто не баг.`, caption: 'Фьючерсы не ждут' },
  ],
};

/** The quiet beat before the chart: the calm the move breaks. */
const CALM = ['Ничего не предвещало.', 'Тихо.\nСлишком тихо.', 'Обычный день\nна рынке.', 'Спокойный флэт…', 'Ничего\nне происходит.'];

/** How many ways one event can be told. */
export const TELLINGS = 5;

export function story(e: MarketEvent, variant: number): Story {
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
  const pair = PAIRS[`${plot}-${up ? 'up' : 'down'}`][variant % TELLINGS];
  const s: Story = { plot, up, hour, further, move: e.move, calm: CALM[(variant + e.id.charCodeAt(0)) % CALM.length], hook: '', punch: '', caption: pair.caption };
  s.hook = pair.hook(s);
  s.punch = pair.punch(s);
  return s;
}
