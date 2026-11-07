/**
 * "I tested 60,329 crypto signals": a six-part series told from the research in
 * research/signals-2026-10.md (91 days of Binance minute candles, 150 pairs, the rules of
 * SignalRules, outcomes an hour later, a train half and a test half split by time).
 *
 * Every number below is copied from that report; change them only together with it. Part 6's
 * "the hour after a signal moves almost twice as much" is research/oi-funding-2026-11.md (PUMP ×1.8,
 * OPEN_INTEREST ×2.4 against the pair's usual hour, both halves). Each
 * episode is a list of beats; a beat is what is on screen plus what the voice says over it, so
 * the narration script and the video come from the same place and cannot drift apart.
 */
import type { Lang } from './text';

export type Beat =
  /** a statement that lands like a headline */
  | { kind: 'title'; text: string; say: string }
  /** a few lines, read at a calm pace */
  | { kind: 'text'; text: string; say: string }
  /** one big number counting up, with what it counts */
  | { kind: 'stat'; value: number; label: string; say: string }
  /** two bars side by side: what the signals did against a coin toss */
  | { kind: 'compare'; title: string; a: { label: string; value: number }; b: { label: string; value: number }; say: string }
  /** an average and its 95% interval on an axis around zero: does it clear zero? */
  | { kind: 'range'; title: string; value: number; low: number; high: number; verdict: string; say: string }
  /** the same test on the first and the second half of the data */
  | { kind: 'halves'; title: string; first: { value: string; ok: boolean; note: string }; second: { value: string; ok: boolean; note: string }; say: string }
  /** a sum: what the move earned against what a trade costs */
  | { kind: 'versus'; a: { label: string; value: string }; b: { label: string; value: string }; result: string; say: string }
  | { kind: 'outro'; line: string; say: string };

export type Episode = { slug: string; title: string; caption: string; beats: Beat[] };

export const PARTS = 6;

const ru: Episode[] = [
  {
    slug: 'signals-1',
    title: 'Я проверил 60 329 крипто-сигналов',
    caption: 'Проверил 60 329 сигналов на 91 дне реальных данных. Сигналы угадывают реже монетки. Часть 1 из 6',
    beats: [
      { kind: 'title', text: 'Я проверил\n60 329\nкрипто-сигналов', say: 'Все продают крипто-сигналы. Я решил проверить, работают ли они вообще.' },
      { kind: 'text', text: 'Пампы, дампы,\nвсплески объёма.\n150 монет. 91 день.', say: 'Пампы, дампы, всплески объёма. Сто пятьдесят самых торгуемых монет, девяносто один день минутных свечей Binance.' },
      { kind: 'stat', value: 60329, label: 'сигналов, и каждый\nпроверен через час', say: 'Получилось шестьдесят тысяч сигналов. И про каждый я посмотрел, что стало с ценой через час.' },
      { kind: 'compare', title: 'Через час цена пошла\nтуда, куда указал сигнал', a: { label: 'Сигналы', value: 45 }, b: { label: 'Монетка', value: 50 }, say: 'Цена пошла туда, куда указывал сигнал, в сорока пяти процентах случаев. Подбросить монетку — пятьдесят.' },
      { kind: 'title', text: 'Сигналы угадывают\nреже монетки.', say: 'Сигналы угадывают реже, чем монетка.' },
      { kind: 'text', text: 'Почему так —\nразберу по частям.', say: 'Почему так, и что тогда вообще делать с сигналами, — разберу в следующих частях.' },
      { kind: 'outro', line: 'часть 1 из 6 · подпишись', say: 'Подпишись, чтобы не пропустить.' },
    ],
  },
  {
    slug: 'signals-2',
    title: 'Памп — значит покупай?',
    caption: 'Покупать на пампе — в среднем ноль после комиссии. Проверено на 9 956 пампах. Часть 2 из 6',
    beats: [
      { kind: 'title', text: 'Памп —\nзначит покупай?', say: 'Монета резко выросла. Покупать, пока не поздно?' },
      { kind: 'stat', value: 9956, label: 'пампов за 91 день,\nот +2% за 5 минут', say: 'Я взял почти десять тысяч пампов — каждый раз, когда монета выросла на два процента и больше за пять минут.' },
      { kind: 'compare', title: 'Через час цена\nпродолжила расти', a: { label: 'Пампы', value: 44 }, b: { label: 'Монетка', value: 50 }, say: 'Через час рост продолжился только в сорока четырёх процентах случаев.' },
      { kind: 'versus', a: { label: 'средний рост дальше', value: '+0.10%' }, b: { label: 'комиссия за сделку', value: '−0.10%' }, result: '≈ 0', say: 'В среднем цена прошла дальше на одну десятую процента. Ровно столько стоит комиссия за вход и выход.' },
      { kind: 'title', text: 'Купил на пампе —\nв среднем ноль.', say: 'Купил на пампе — в среднем ноль. А с проскальзыванием — минус.' },
      { kind: 'outro', line: 'часть 2 из 6 · подпишись', say: 'Дальше — что с дампами.' },
    ],
  },
  {
    slug: 'signals-3',
    title: 'Дамп — значит шорти?',
    caption: 'После дампа цена чаще отскакивает, чем падает дальше. Но это не правило. Часть 3 из 6',
    beats: [
      { kind: 'title', text: 'Дамп —\nзначит шорти?', say: 'Монета резко падает. Шортить вдогонку?' },
      { kind: 'stat', value: 9247, label: 'дампов за 91 день,\nот −2% за 5 минут', say: 'Девять с лишним тысяч дампов.' },
      { kind: 'compare', title: 'Через час цена\nпродолжила падать', a: { label: 'Дампы', value: 45 }, b: { label: 'Монетка', value: 50 }, say: 'Падение продолжилось только в сорока пяти процентах случаев. Чаще цена отскакивала.' },
      { kind: 'halves', title: 'Отскок после дампа', first: { value: '−0.19%', ok: false, note: 'первая половина:\nне отличить от нуля' }, second: { value: '−0.27%', ok: true, note: 'вторая половина:\nустойчиво' }, say: 'На второй половине данных отскок устойчивый. Но на первой — его не отличить от случайности.' },
      { kind: 'title', text: 'Один период —\nне правило.', say: 'А значит, это наблюдение за один период, а не правило, на котором можно зарабатывать.' },
      { kind: 'outro', line: 'часть 3 из 6 · подпишись', say: 'В следующей части — как стратегии обманывают тебя.' },
    ],
  },
  {
    slug: 'signals-4',
    title: 'Как стратегии из TikTok тебя обманывают',
    caption: 'Закономерность, которая работала на прошлом и исчезла на будущем. Вот почему стратегии из TikTok не работают. Часть 4 из 6',
    beats: [
      { kind: 'title', text: 'Как стратегии\nиз TikTok\nтебя обманывают', say: 'Сейчас покажу, почему почти все стратегии из TikTok не работают.' },
      { kind: 'text', text: 'Гипотеза:\nпамп на большом объёме\nидёт дальше.', say: 'Гипотеза: если памп идёт на большом объёме, он продолжится. Звучит логично.' },
      { kind: 'halves', title: 'Объём ×4 против обычного', first: { value: '−0.53%', ok: true, note: 'первая половина:\n«закономерность!»' }, second: { value: '+0.02%', ok: false, note: 'вторая половина:\nисчезла' }, say: 'На первой половине данных разница огромная — вот она, закономерность. А на второй половине она просто исчезла.' },
      { kind: 'title', text: 'Работало в прошлом\n≠ работает\nв будущем.', say: 'Найти закономерность в прошлом легко. Это не значит, что она сработает завтра.' },
      { kind: 'text', text: 'Всегда проверяй\nна данных,\nкоторые не видел.', say: 'Поэтому любую стратегию проверяй на данных, которые не видел, когда её придумывал.' },
      { kind: 'outro', line: 'часть 4 из 6 · подпишись', say: 'Дальше — время суток, тренд и ликвидность.' },
    ],
  },
  {
    slug: 'signals-5',
    title: 'Сессия США? Тренд? Ликвидность?',
    caption: 'Проверил три популярных фильтра для сигналов. Ни один не дал преимущества. Часть 5 из 6',
    beats: [
      { kind: 'title', text: 'Сессия США?\nПо тренду?\nКрупные монеты?', say: 'Может, сигналы работают при правильном фильтре? Проверил три популярных.' },
      { kind: 'range', title: 'Сигналы в сессию США\nпротив остальных часов', value: 0.02, low: -0.21, high: 0.26, verdict: 'накрывает ноль —\nразницы нет', say: 'Сессия США. Разница с остальными часами — ноль, в пределах случайности.' },
      { kind: 'range', title: 'По тренду 4 часа\nпротив тренда', value: 0.06, low: -0.26, high: 0.37, verdict: 'накрывает ноль —\nразницы нет', say: 'Торговать по тренду старшего таймфрейма. Тоже ноль.' },
      { kind: 'range', title: 'Крупные монеты\nпротив мелких', value: -0.09, low: -0.25, high: 0.07, verdict: 'накрывает ноль —\nразницы нет', say: 'Только крупные монеты. И снова ноль.' },
      { kind: 'title', text: 'Ни один фильтр\nне дал преимущества.', say: 'Ни один фильтр не дал преимущества.' },
      { kind: 'outro', line: 'часть 5 из 6 · подпишись', say: 'В последней части — так зачем тогда вообще сигналы.' },
    ],
  },
  {
    slug: 'signals-6',
    title: 'Так зачем тогда сигналы?',
    caption: 'Сигнал — не прогноз. Это то, что происходит на рынке прямо сейчас. Часть 6 из 6',
    beats: [
      { kind: 'title', text: 'Так зачем тогда\nсигналы?', say: 'Если сигналы не предсказывают цену, зачем они нужны?' },
      { kind: 'text', text: 'Сигнал — не прогноз.\nЭто то, что происходит\nпрямо сейчас.', say: 'Сигнал — это не прогноз. Это то, что происходит на рынке прямо сейчас.' },
      { kind: 'text', text: 'Куда — неизвестно.\nНо час после сигнала\nв среднем почти вдвое\nразмашистее обычного.', say: 'Куда пойдёт цена — неизвестно. Но час после пампа или скачка открытого интереса в среднем почти вдвое размашистее обычного часа этой монеты. Рынок проснулся.' },
      { kind: 'text', text: 'Памп. Ликвидации.\nСтена в стакане.\nТы видишь это первым.', say: 'Памп, каскад ликвидаций, огромная стена в стакане — ты видишь это раньше, чем остальные.' },
      { kind: 'text', text: 'Решение — за тобой.\nИ с честными цифрами.', say: 'А решение остаётся за тобой. Только теперь — с честными цифрами, а не с обещаниями.' },
      { kind: 'outro', line: 'Pulse — радар рынка · ссылка в профиле', say: 'Pulse — радар всего рынка фьючерсов. Ссылка в профиле.' },
    ],
  },
];

const en: Episode[] = [
  {
    slug: 'signals-1',
    title: 'I tested 60,329 crypto signals',
    caption: 'Tested 60,329 signals on 91 days of real data. They called it right less often than a coin flip. Part 1 of 6',
    beats: [
      { kind: 'title', text: 'I tested\n60,329\ncrypto signals', say: 'Everyone sells crypto signals. So I tested whether they work at all.' },
      { kind: 'text', text: 'Pumps, dumps,\nvolume spikes.\n150 coins. 91 days.', say: 'Pumps, dumps, volume spikes. The 150 most traded coins, 91 days of Binance minute candles.' },
      { kind: 'stat', value: 60329, label: 'signals, each one\nchecked an hour later', say: 'Sixty thousand signals. For every one, I checked what the price did an hour later.' },
      { kind: 'compare', title: 'An hour later, price went\nwhere the signal pointed', a: { label: 'Signals', value: 45 }, b: { label: 'Coin flip', value: 50 }, say: 'Price went where the signal pointed 45 percent of the time. A coin flip gets 50.' },
      { kind: 'title', text: 'Signals lose\nto a coin flip.', say: 'Signals lose to a coin flip.' },
      { kind: 'text', text: 'Why? I’ll break it\ndown part by part.', say: 'Why that happens, and what signals are actually good for, in the next parts.' },
      { kind: 'outro', line: 'part 1 of 6 · follow', say: 'Follow so you don’t miss it.' },
    ],
  },
  {
    slug: 'signals-2',
    title: 'Pump means buy?',
    caption: 'Buying the pump makes zero on average after fees. Tested on 9,956 pumps. Part 2 of 6',
    beats: [
      { kind: 'title', text: 'Pump\nmeans buy?', say: 'A coin just shot up. Buy before it’s too late?' },
      { kind: 'stat', value: 9956, label: 'pumps in 91 days,\n+2% or more in 5 minutes', say: 'I took almost ten thousand pumps, every time a coin rose two percent or more in five minutes.' },
      { kind: 'compare', title: 'An hour later,\nprice kept rising', a: { label: 'Pumps', value: 44 }, b: { label: 'Coin flip', value: 50 }, say: 'An hour later, it kept rising only 44 percent of the time.' },
      { kind: 'versus', a: { label: 'average move further up', value: '+0.10%' }, b: { label: 'fees for the trade', value: '−0.10%' }, result: '≈ 0', say: 'On average it went a tenth of a percent further. That’s exactly what fees cost you in and out.' },
      { kind: 'title', text: 'Buying the pump:\nzero on average.', say: 'Buying the pump makes zero on average. With slippage, less.' },
      { kind: 'outro', line: 'part 2 of 6 · follow', say: 'Next: what happens after dumps.' },
    ],
  },
  {
    slug: 'signals-3',
    title: 'Dump means short?',
    caption: 'After a dump, price bounces more often than it keeps falling. But it’s not a rule. Part 3 of 6',
    beats: [
      { kind: 'title', text: 'Dump\nmeans short?', say: 'A coin is crashing. Short it on the way down?' },
      { kind: 'stat', value: 9247, label: 'dumps in 91 days,\n−2% or more in 5 minutes', say: 'Over nine thousand dumps.' },
      { kind: 'compare', title: 'An hour later,\nprice kept falling', a: { label: 'Dumps', value: 45 }, b: { label: 'Coin flip', value: 50 }, say: 'The fall continued only 45 percent of the time. More often, price bounced.' },
      { kind: 'halves', title: 'The bounce after a dump', first: { value: '−0.19%', ok: false, note: 'first half:\nlooks like noise' }, second: { value: '−0.27%', ok: true, note: 'second half:\nholds up' }, say: 'In the second half of the data the bounce holds up. In the first half, you can’t tell it from noise.' },
      { kind: 'title', text: 'One period\nisn’t a rule.', say: 'So it’s an observation from one period, not a rule you can trade.' },
      { kind: 'outro', line: 'part 3 of 6 · follow', say: 'Next: how strategies fool you.' },
    ],
  },
  {
    slug: 'signals-4',
    title: 'How TikTok strategies fool you',
    caption: 'A pattern that worked on the past and vanished on the future. That’s why TikTok strategies fail. Part 4 of 6',
    beats: [
      { kind: 'title', text: 'How TikTok\nstrategies\nfool you', say: 'Here’s why almost every strategy you see on TikTok doesn’t work.' },
      { kind: 'text', text: 'Hypothesis:\na pump on big volume\nkeeps going.', say: 'Hypothesis: if a pump comes on big volume, it keeps going. Sounds logical.' },
      { kind: 'halves', title: 'Volume ×4 vs normal', first: { value: '−0.53%', ok: true, note: 'first half:\n“a pattern!”' }, second: { value: '+0.02%', ok: false, note: 'second half:\ngone' }, say: 'In the first half of the data, a huge difference. There’s your pattern. In the second half, it simply vanished.' },
      { kind: 'title', text: 'Worked in the past\n≠ works\nin the future.', say: 'Finding a pattern in the past is easy. It doesn’t mean it works tomorrow.' },
      { kind: 'text', text: 'Always test\non data\nyou haven’t seen.', say: 'So test every strategy on data you didn’t look at while building it.' },
      { kind: 'outro', line: 'part 4 of 6 · follow', say: 'Next: time of day, trend and liquidity.' },
    ],
  },
  {
    slug: 'signals-5',
    title: 'US session? Trend? Big coins?',
    caption: 'Tested three popular signal filters. None of them gave an edge. Part 5 of 6',
    beats: [
      { kind: 'title', text: 'US session?\nWith the trend?\nBig coins only?', say: 'Maybe signals work with the right filter? I tested three popular ones.' },
      { kind: 'range', title: 'Signals in the US session\nvs other hours', value: 0.02, low: -0.21, high: 0.26, verdict: 'covers zero —\nno difference', say: 'The US session. Difference from other hours: zero, within chance.' },
      { kind: 'range', title: 'With the 4h trend\nvs against it', value: 0.06, low: -0.26, high: 0.37, verdict: 'covers zero —\nno difference', say: 'Trading with the higher timeframe trend. Also zero.' },
      { kind: 'range', title: 'Big coins\nvs small ones', value: -0.09, low: -0.25, high: 0.07, verdict: 'covers zero —\nno difference', say: 'Big coins only. Zero again.' },
      { kind: 'title', text: 'No filter\ngave an edge.', say: 'Not one filter gave an edge.' },
      { kind: 'outro', line: 'part 5 of 6 · follow', say: 'Last part: so why signals at all.' },
    ],
  },
  {
    slug: 'signals-6',
    title: 'So why signals at all?',
    caption: 'A signal isn’t a prediction. It’s what’s happening in the market right now. Part 6 of 6',
    beats: [
      { kind: 'title', text: 'So why\nsignals at all?', say: 'If signals don’t predict price, why bother?' },
      { kind: 'text', text: 'A signal isn’t a forecast.\nIt’s what’s happening\nright now.', say: 'A signal isn’t a forecast. It’s what’s happening in the market right now.' },
      { kind: 'text', text: 'Which way? Unknown.\nBut on average the hour\nafter a signal moves\nalmost twice as much.', say: 'Which way the price goes is unknown. But the hour after a pump or an open interest jump moves, on average, almost twice as much as that coin’s usual hour. The market just woke up.' },
      { kind: 'text', text: 'A pump. Liquidations.\nA wall in the order book.\nYou see it first.', say: 'A pump, a liquidation cascade, a huge wall in the order book. You see it before everyone else.' },
      { kind: 'text', text: 'The decision is yours.\nWith honest numbers.', say: 'The decision is still yours. Just with honest numbers instead of promises.' },
      { kind: 'outro', line: 'Pulse — a market radar · link in bio', say: 'Pulse, a radar for the whole futures market. Link in bio.' },
    ],
  },
];

export const SERIES: Record<Lang, Episode[]> = { ru, en };

/** Frames a beat stays on screen at 30 fps: long enough to read it, short enough to keep pace. */
export function beatFrames(beat: Beat): number {
  const base: Record<Beat['kind'], number> = { title: 66, text: 84, stat: 84, compare: 108, range: 96, halves: 126, versus: 108, outro: 66 };
  const words = beat.say.split(/\s+/).length;
  // the narration sets the floor: about two and a half words a second
  return Math.max(base[beat.kind], Math.round((words / 2.5) * 30));
}

export function episodeFrames(episode: Episode): number {
  return episode.beats.reduce((sum, beat) => sum + beatFrames(beat), 0);
}

/** The narration for the voice, with the time each line starts. */
export function script(episode: Episode, lang: Lang): string {
  let at = 0;
  const lines = episode.beats.map((beat) => {
    const start = at / 30;
    at += beatFrames(beat);
    const clock = `${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, '0')}`;
    return `${clock}  ${beat.say}`;
  });
  const header = lang === 'ru' ? `## ${episode.title}\nДлина ${Math.round(at / 30)} с.` : `## ${episode.title}\nLength ${Math.round(at / 30)} s.`;
  return `${header}\n\n${lines.join('\n')}\n`;
}
