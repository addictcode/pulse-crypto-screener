/**
 * Every word the videos say, in frames and in post descriptions, by language. The English set is
 * written for English-speaking crypto TikTok (POV, "Nobody: / The market:", "Expectation /
 * Reality"), not translated line by line.
 *
 * Nothing here may date a video or name a coin: no ticker, no date, no time of day. The numbers
 * come from the candles; nothing is promised.
 */

export type Lang = 'ru' | 'en';
export const LANGS: Lang[] = ['ru', 'en'];

/** rocket: kept going; trap: turned against the move; flat: neither */
export type Plot = 'rocket' | 'trap' | 'flat';

/** What a hook or punchline may use: the real numbers of the event, signed percent. */
export type Numbers = { hour: number; further: number; move: number };

/** A hook and its punchline go together, with the post description that fits them. */
export type Pair = { hook: (n: Numbers) => string; punch: (n: Numbers) => string; caption: string };

export type PlotKey = `${Plot}-${'up' | 'down'}`;

export const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;
export const abs = (v: number) => `${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;

type Text = {
  /** the meme template's tellings, five per plot and direction */
  pairs: Record<PlotKey, Pair[]>;
  /** the quiet beat before the chart */
  calm: string[];
  /** the label over every chart */
  chartLabel: string;
  /** under the stamped percent */
  in5: string;
  /** Pulse's notification: what happened, and when */
  notice: (up: boolean, size: string) => string;
  now: string;
  outro: { tagline: string; link: string; note: string; guess: string; top3: string };
  guess: { hooks: string[]; question: string; up: string; down: string; comment: string; answer: (hour: number) => string; captions: string[] };
  top3: { hooks: string[]; captions: string[] };
  counter: { hooks: string[]; after: (hour: number) => string; captions: string[] };
  pulse: { hooks: string[]; label: string; minute: (m: number) => string; oneOf: string; captions: string[] };
  traps: { hooks: string[]; label: (n: number) => string; breakout: (up: boolean) => string; back: (hour: number) => string; end: string; captions: string[] };
  volume: { hooks: string[]; label: string; average: string; end: (n: number, move: number) => string; captions: string[] };
  split: { hooks: string[]; before: (m: number) => string; after: string; end: (m: number, calm: number, move: number) => string; captions: string[] };
  timelapse: { hooks: string[]; label: string; speed: string; hours: (h: number) => string; end: (day: number, move: number) => string; captions: string[] };
  /** at the end of every post description */
  note: string;
  tags: string;
};

const ruFlat: Pair[] = [
  { hook: () => 'Что произошло,\nпока ты моргнул:', punch: (s) => `А через час ${pct(s.hour)}.\nНу и кто тут умный?`, caption: 'Моргнул — пропустил' },
  { hook: () => 'Никто:\n\nРынок:', punch: (s) => `Через час: ${pct(s.hour)}`, caption: 'Рынок просто так' },
  { hook: () => '5 минут.\nВсего 5 минут.', punch: (s) => `${abs(s.move)} за 5 минут.\nЧерез час: ${pct(s.hour)}`, caption: 'Пять минут, которые всё решили' },
  { hook: () => 'Когда отошёл\nза кофе ☕', punch: (s) => `Пока пил кофе:\n${pct(s.move)}`, caption: 'Никогда не отходи за кофе' },
  { hook: () => 'Скорость этого рынка:', punch: (s) => `${pct(s.move)} за 5 минут.\nЭто не баг.`, caption: 'Фьючерсы не ждут' },
];

const enFlat: Pair[] = [
  { hook: () => 'What happened\nwhile you blinked:', punch: (s) => `An hour later: ${pct(s.hour)}.\nSo who's the genius?`, caption: 'Blink and you miss it' },
  { hook: () => 'Nobody:\n\nThe market:', punch: (s) => `One hour later: ${pct(s.hour)}`, caption: 'The market, just because' },
  { hook: () => '5 minutes.\nJust 5 minutes.', punch: (s) => `${abs(s.move)} in 5 minutes.\nAn hour later: ${pct(s.hour)}`, caption: 'Five minutes that changed everything' },
  { hook: () => 'When you step away\nfor coffee ☕', punch: (s) => `While you got coffee:\n${pct(s.move)}`, caption: 'Never step away for coffee' },
  { hook: () => 'The speed of\nthis market:', punch: (s) => `${pct(s.move)} in 5 minutes.\nNot a bug.`, caption: "Futures don't wait" },
];

export const TEXT: Record<Lang, Text> = {
  ru: {
    pairs: {
      'rocket-up': [
        { hook: () => 'POV: ты продал\nза минуту до этого', punch: (s) => `…и это было только начало:\nещё ${pct(s.further)}`, caption: 'Классика: продал ровно перед ракетой' },
        { hook: () => 'Поставил тейк\nна +2% 😌', punch: (s) => `Рынок:\nещё ${pct(s.further)}`, caption: 'Тейк на +2% — это стратегия' },
        { hook: () => 'Шортисты:\n«ну теперь-то откат» 😎', punch: (s) => `Откат через час:\nещё ${pct(s.further)} 💀`, caption: 'Шортить ракету — смелое решение' },
        { hook: () => 'Ты: «уже слишком\nвысоко, не зайду»', punch: (s) => `График через час:\nещё ${pct(s.further)}`, caption: 'Слишком высоко — говорили они' },
        { hook: () => 'Никто:\n\nАльткоины внезапно:', punch: (s) => `И не остановились:\nещё ${pct(s.further)}`, caption: 'Пока ты спишь, рынок не спит' },
      ],
      'rocket-down': [
        { hook: () => 'POV: ты зашёл в лонг\n«на откате»', punch: (s) => `…и это было только начало:\nещё ${pct(s.further)}`, caption: 'Откат, говорили они' },
        { hook: () => '«Это просто\nкоррекция»', punch: (s) => `Коррекция через час:\nещё ${pct(s.further)} 💀`, caption: 'Здоровая коррекция' },
        { hook: () => 'Лонгисты:\n«ниже уже некуда» 😎', punch: (s) => `Нашлось куда:\nещё ${pct(s.further)}`, caption: 'Ниже некуда — всегда есть куда' },
        { hook: () => 'Когда купил дип', punch: (s) => `У дипа был\nещё один дип: ${pct(s.further)}`, caption: 'Buy the dip, они сказали' },
        { hook: () => 'Никто:\n\nАльткоины внезапно:', punch: (s) => `И это не дно:\nещё ${pct(s.further)}`, caption: 'Рынок не прощает' },
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
      'flat-up': ruFlat,
      'flat-down': ruFlat,
    },
    calm: ['Ничего не предвещало.', 'Тихо.\nСлишком тихо.', 'Обычный день\nна рынке.', 'Спокойный флэт…', 'Ничего\nне происходит.'],
    chartLabel: 'фьючерсы · 1 мин',
    in5: 'за 5 минут',
    notice: (up, size) => `${up ? 'Резкий рост' : 'Резкое падение'}: ${size} за пять минут`,
    now: 'сейчас',
    outro: {
      tagline: 'видит рынок раньше тебя',
      link: 'ссылка в профиле',
      note: 'Реальные данные Binance. Не финансовый совет.',
      guess: 'подпишись, чтобы угадать следующую',
      top3: 'Pulse видит такие свечи сразу',
    },
    guess: {
      hooks: ['Угадай,\nчто дальше 👇', 'Лонг или шорт?', 'Куда пойдёт\nцена?', 'Ты бы зашёл?', 'Проверим\nтвою интуицию'],
      question: 'Что дальше?',
      up: '⬆ ВВЕРХ',
      down: '⬇ ВНИЗ',
      comment: 'Пиши ответ в комменты 👇',
      answer: (h) => (Math.abs(h) < 1 ? `Никуда 🙃\n${pct(h)} за час` : h > 0 ? `⬆ Вверх:\n${pct(h)} за час` : `⬇ Вниз:\n${pct(h)} за час`),
      captions: ['Угадал? Пиши в комменты', 'Лонг или шорт — отвечай честно', 'Проверь себя: вверх или вниз?', 'Зашёл бы?', 'Интуиция или удача?'],
    },
    top3: {
      hooks: ['Топ-3 самых\nрезких свечей', '3 свечи,\nот которых трясёт', '5 минут.\nТри раза.', 'Самые резкие\n5 минут рынка', 'Три свечи,\nкоторые никто не ждал'],
      captions: ['Какая из трёх страшнее?', 'Номер один — это жесть', 'Три свечи, пять минут каждая', 'Ты бы удержал позицию?', 'Рынок не спит'],
    },
    counter: {
      hooks: ['Засекай.\n5 минут.', 'Как выглядят\n5 минут на фьючерсах', 'Смотри\nна цифру 👇', 'Пять минут.\nНе моргай.', 'Что рынок\nделает за 5 минут'],
      after: (h) => `А за следующий час:\n${pct(h)}`,
      captions: ['Пять минут, и всё', 'Не моргай', 'Вот так выглядит волатильность', 'Это не ускоренная съёмка', 'Пять минут из жизни рынка'],
    },
    pulse: {
      hooks: ['Так выглядит час\nна фьючерсах', '30 монет.\n1 час.', 'Следи\nза плитками 👇', 'Какая из них\nвзорвётся?', 'Пульс рынка'],
      label: '30 монет · изменение за 5 мин',
      minute: (m) => `${m} мин`,
      oneOf: '1 из 30',
      captions: ['Час рынка за 6 секунд', 'Одна из тридцати', 'Вот так выглядит рынок целиком', 'Заметил её раньше?', 'Тридцать монет, одна свеча'],
    },
    traps: {
      hooks: ['3 раза за неделю\nрынок сделал это', 'Пробой… и назад.\nТри раза', 'Ловушка.\nЛовушка.\nЛовушка.', 'Купил пробой?\nСмотри, что дальше', 'Любимый трюк\nрынка'],
      label: (n) => `Ловушка ${n}/3`,
      breakout: (up) => (up ? 'Пробой вверх…' : 'Пробой вниз…'),
      back: (hour) => `…и назад:\n${pct(hour)} за час`,
      end: '3 из 3\nразвернулись',
      captions: ['Пробой, который не пробой ×3', 'Не гонись за свечой', 'Три ловушки за неделю', 'Узнаёшь этот трюк?', 'Ловушка срабатывает снова и снова'],
    },
    volume: {
      hooks: ['Смотри на объём,\nне на цену', 'Объём\nвзорвался 💥', 'Сначала объём.\nПотом цена.', 'Это не цена.\nЭто объём.', 'Обычные минуты?\nСмотри внимательно'],
      label: 'объём · 1 мин',
      average: 'среднее',
      end: (n, move) => `Объём: ×${n}\nк среднему\nЦена: ${pct(move)}\nза 5 минут`,
      captions: ['Вот что значит «объём взорвался»', 'Смотри на столбики', 'Объём и цена в одни и те же минуты', 'Такое видно по объёму', 'Обычный объём — и вдруг это'],
    },
    split: {
      hooks: ['Одна и та же монета.\nРазница — 5 минут', 'Было / стало', 'До и после.\n5 минут между ними', 'Слева — тишина.\nСправа — 5 минут', 'Найди\nотличия 👇'],
      before: (m) => `${m} минут до`,
      after: '5 минут',
      end: (m, calm, move) => `${m} минут: ${pct(calm)}\n5 минут: ${pct(move)}`,
      captions: ['Было / стало за 5 минут', 'Одна монета, два мира', 'Тишина перед бурей', 'Долго ничего, потом это', 'Найди отличия'],
    },
    timelapse: {
      hooks: ['24 часа\nза 6 секунд', 'Сутки на рынке.\nУскорено.', 'Найди момент,\nкогда всё случилось 👇', 'Целый день.\nИ пять минут.', 'Весь день\nв одном ролике'],
      label: '24 часа · свечи по 5 мин',
      speed: 'ускорено ×14 400',
      hours: (h) => `${h} ч`,
      end: (day, move) => `За сутки: ${pct(day)}\nИз них 5 минут:\n${pct(move)}`,
      captions: ['Сутки за 6 секунд', 'Успел заметить до паузы?', 'Весь день и пять минут из него', 'Вот так выглядит день на фьючерсах', 'Ускорено в 14 400 раз'],
    },
    note: 'Реальный график, реальные цифры. Pulse показывает рынок, а не предсказывает его. Не финансовый совет.',
    tags: '#крипта #трейдинг #фьючерсы #биткоин #криптовалюта #binance #альткоины',
  },
  en: {
    pairs: {
      'rocket-up': [
        { hook: () => 'POV: you sold\none minute before this', punch: (s) => `…and that was just the start:\n${pct(s.further)} more`, caption: 'Sold right before the rocket. Classic' },
        { hook: () => 'Me: takes profit\nat +2% 😌', punch: (s) => `The market:\n${pct(s.further)} more`, caption: 'Taking profit at +2% is a strategy' },
        { hook: () => 'Shorts:\n"ok NOW it pulls back" 😎', punch: (s) => `The pullback:\n${pct(s.further)} more 💀`, caption: 'Shorting a rocket is a bold move' },
        { hook: () => 'Me: "too high,\nI\'ll skip this one"', punch: (s) => `The chart an hour later:\n${pct(s.further)} more`, caption: 'Too high, they said' },
        { hook: () => 'Nobody:\n\nAltcoins out\nof nowhere:', punch: (s) => `And it didn't stop:\n${pct(s.further)} more`, caption: 'The market never sleeps' },
      ],
      'rocket-down': [
        { hook: () => 'POV: you longed\n"the dip"', punch: (s) => `…and that was just the start:\n${pct(s.further)} more`, caption: 'Buying the dip, they said' },
        { hook: () => '"It\'s just a\nhealthy correction"', punch: (s) => `The correction:\n${pct(s.further)} more 💀`, caption: 'Very healthy correction' },
        { hook: () => 'Longs:\n"it can\'t go\nany lower" 😎', punch: (s) => `It could:\n${pct(s.further)} more`, caption: 'There is always a lower' },
        { hook: () => 'When you\nbuy the dip', punch: (s) => `The dip had\nanother dip: ${pct(s.further)}`, caption: 'Buy the dip, they said' },
        { hook: () => 'Nobody:\n\nThe market out\nof nowhere:', punch: (s) => `And that wasn't the bottom:\n${pct(s.further)} more`, caption: 'The market does not forgive' },
      ],
      'trap-up': [
        { hook: () => 'Bought the\nbreakout 🚀', punch: (s) => `One hour later:\n${pct(s.hour)} 🤡`, caption: "The breakout that wasn't" },
        { hook: (s) => `${pct(s.move)} in 5 minutes.\nMe: apes in`, punch: (s) => `Me an hour later:\n${pct(s.hour)}`, caption: 'FOMO is the best indicator. Inverted' },
        { hook: () => 'Expectation:', punch: (s) => `Reality:\n${pct(s.hour)} in an hour`, caption: 'Expectation vs reality' },
        { hook: () => 'When you finally\nfind the courage\nto enter', punch: (s) => `The market an hour later:\n${pct(s.hour)}`, caption: 'The market was waiting just for you' },
        { hook: () => 'FOMO:\nactivated', punch: (s) => `FOMO an hour later:\n${pct(s.hour)} 🫠`, caption: 'Never chase a candle' },
      ],
      'trap-down': [
        { hook: () => 'Sold the\nexact bottom', punch: (s) => `One hour later:\n${pct(s.hour)} 🤡`, caption: 'Sold the bottom. Classic' },
        { hook: (s) => `${pct(s.move)} in 5 minutes.\nMe: shorts it`, punch: (s) => `Me an hour later:\n${pct(s.hour)} against me`, caption: 'Shorting the bottom' },
        { hook: () => 'Expectation:', punch: (s) => `Reality:\n${pct(s.hour)} in an hour`, caption: 'Expectation vs reality' },
        { hook: () => 'Panic.\nSell everything.', punch: (s) => `One hour later:\n${pct(s.hour)} 🫠`, caption: 'Panic is a terrible advisor' },
        { hook: () => 'A short with the\nperfect entry', punch: (s) => `The perfect entry\nan hour later: ${pct(s.hour)}`, caption: 'Perfect entry, imperfect market' },
      ],
      'flat-up': enFlat,
      'flat-down': enFlat,
    },
    calm: ['Nothing to\nsee here.', 'Quiet.\nToo quiet.', 'Just another day\nin the market.', 'Calm and\nsideways…', 'Nothing is\nhappening.'],
    chartLabel: 'futures · 1m',
    in5: 'in 5 minutes',
    notice: (up, size) => `${up ? 'Sharp pump' : 'Sharp dump'}: ${size} in five minutes`,
    now: 'now',
    outro: {
      tagline: 'sees the market before you do',
      link: 'link in bio',
      note: 'Real Binance data. Not financial advice.',
      guess: 'follow to guess the next one',
      top3: 'Pulse sees candles like these live',
    },
    guess: {
      hooks: ['Guess what\nhappens next 👇', 'Long or short?', 'Where does\nit go next?', 'Would you\nenter here?', "Let's test\nyour instinct"],
      question: "What's next?",
      up: '⬆ UP',
      down: '⬇ DOWN',
      comment: 'Drop your answer below 👇',
      answer: (h) => (Math.abs(h) < 1 ? `Nowhere 🙃\n${pct(h)} in an hour` : h > 0 ? `⬆ Up:\n${pct(h)} in an hour` : `⬇ Down:\n${pct(h)} in an hour`),
      captions: ['Called it? Tell me in the comments', 'Long or short, be honest', 'Test yourself: up or down?', 'Would you take this trade?', 'Instinct or luck?'],
    },
    top3: {
      hooks: ['Top 3 most\nviolent candles', '3 candles that\nwill shake you', '5 minutes.\nThree times.', 'The wildest\n5 minutes', 'Three candles\nnobody saw coming'],
      captions: ['Which one is the scariest?', 'Number one is insane', 'Three candles, five minutes each', 'Would you hold through this?', 'The market never sleeps'],
    },
    counter: {
      hooks: ['Start the clock.\n5 minutes.', 'What 5 minutes\nof futures\nlook like', 'Watch\nthe number 👇', "Five minutes.\nDon't blink.", 'What the market\ndoes in 5 minutes'],
      after: (h) => `And the next hour:\n${pct(h)}`,
      captions: ["Five minutes, that's it", "Don't blink", 'This is what volatility looks like', 'This is not sped up', 'Five minutes in the life of the market'],
    },
    pulse: {
      hooks: ['This is one hour\non futures', '30 coins.\n1 hour.', 'Watch\nthe tiles 👇', 'Which one\nexplodes?', 'The pulse\nof the market'],
      label: '30 coins · 5-min change',
      minute: (m) => `${m} min`,
      oneOf: '1 of 30',
      captions: ['An hour of the market in 6 seconds', 'One out of thirty', 'This is the whole market at once', 'Did you spot it first?', 'Thirty coins, one candle'],
    },
    traps: {
      hooks: ['The market did this\n3 times in a week', 'Breakout… and back.\nThree times', 'Trap.\nTrap.\nTrap.', 'Bought the breakout?\nWatch this', "The market's\nfavourite trick"],
      label: (n) => `Trap ${n}/3`,
      breakout: (up) => (up ? 'Breakout…' : 'Breakdown…'),
      back: (hour) => `…and back:\n${pct(hour)} in an hour`,
      end: '3 out of 3\nreversed',
      captions: ["The breakout that wasn't ×3", 'Never chase a candle', 'Three traps in a week', 'Recognise this trick?', 'The trap works again and again'],
    },
    volume: {
      hooks: ['Watch the volume,\nnot the price', 'Volume\nexploded 💥', 'Volume first.\nThen price.', "This isn't price.\nThis is volume.", 'Just normal minutes?\nLook closer'],
      label: 'volume · 1m',
      average: 'average',
      end: (n, move) => `Volume: ×${n}\nthe average\nPrice: ${pct(move)}\nin 5 minutes`,
      captions: ['This is what a volume explosion looks like', 'Watch the bars', 'Volume and price, same minutes', 'You can see it in the volume', 'Normal volume, then this'],
    },
    split: {
      hooks: ['Same coin.\nThe difference:\n5 minutes', 'Before / after', 'Before and after.\n5 minutes apart', 'Left: silence.\nRight: 5 minutes', 'Spot the\ndifference 👇'],
      before: (m) => `${m} min before`,
      after: '5 minutes',
      end: (m, calm, move) => `${m} minutes: ${pct(calm)}\n5 minutes: ${pct(move)}`,
      captions: ['Before / after in 5 minutes', 'Same coin, two worlds', 'The calm before the storm', 'Nothing for ages, then this', 'Spot the difference'],
    },
    timelapse: {
      hooks: ['24 hours\nin 6 seconds', 'A day in the market.\nSped up.', 'Spot the moment\nit all happened 👇', 'A whole day.\nAnd five minutes.', 'A full day\nin one clip'],
      label: '24 hours · 5m candles',
      speed: 'sped up ×14,400',
      hours: (h) => `${h} h`,
      end: (day, move) => `The whole day: ${pct(day)}\n5 of those minutes:\n${pct(move)}`,
      captions: ['A day in 6 seconds', 'Did you spot it before the pause?', 'A whole day and five minutes of it', 'This is a day on futures', 'Sped up 14,400 times'],
    },
    note: 'Real chart, real numbers. Pulse shows the market, it does not predict it. Not financial advice.',
    tags: '#crypto #trading #bitcoin #altcoins #futures #binance',
  },
};

/** A post description: the caption, the honesty note and the hashtags, without a doubled stop. */
export const post = (lang: Lang, caption: string) => `${caption}${/[.!?…]$/.test(caption) ? '' : '.'} ${TEXT[lang].note}\n${TEXT[lang].tags}`;
