/**
 * What a video says about one market event. The story comes from the candles alone: how far the
 * move went in five minutes and what the price did over the next hour. The captions are meme
 * formats with the real numbers in them; nothing is promised, nothing is made up.
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
  hook: string;
  punch: string;
  clock: string;
  clockLater: string;
};

const HOUR = 60;

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

/** The same event can be told several ways; the variant picks one. */
const HOOKS: Record<Plot, Array<(s: Story, sym: string) => string>> = {
  rocket: [
    (s, sym) => (s.up ? `POV: ты продал ${sym}\nза минуту до этого` : `POV: ты зашёл в лонг\nпо ${sym}`),
    (s, sym) => `Никто:\n\n${sym} в ${s.clock}:`,
    (s, sym) => (s.up ? `Шортисты ${sym}\nв ${s.clock}: 😎` : `Лонгисты ${sym}\nв ${s.clock}: 😎`),
  ],
  trap: [
    (s, sym) => (s.up ? `Купил ${sym}\nна пробое 🚀` : `Продал ${sym}\nна самом дне`),
    (s, sym) => `${sym}: ${pct(s.move)} за 5 минут\nТы: заходишь`,
    (_s, sym) => `${sym}.\nОжидание:`,
  ],
  flat: [
    (_s, sym) => `${sym} за 5 минут:`,
    (s, sym) => `Никто:\n\n${sym} в ${s.clock}:`,
    (_s, sym) => `Что сделал ${sym},\nпока ты моргнул:`,
  ],
};

const PUNCHES: Record<Plot, Array<(s: Story) => string>> = {
  rocket: [
    (s) => `…и это было только начало:\nещё ${pct(s.further)}`,
    (s) => `${s.clockLater}: ещё ${pct(s.further)} 💀`,
    (s) => (s.up ? `Шортисты в ${s.clockLater}: 💀` : `Лонгисты в ${s.clockLater}: 💀`),
  ],
  trap: [
    (s) => `Через час: ${pct(s.hour)} 🤡`,
    (s) => `Реальность, ${s.clockLater}:\n${pct(s.hour)}`,
    (s) => `Реальность:\n${pct(s.hour)} за час`,
  ],
  flat: [
    (s) => `А через час ${pct(s.hour)}.\nНу и кто тут умный?`,
    (s) => `Через час: ${pct(s.hour)}`,
    (s) => `Через час: ${pct(s.hour)}`,
  ],
};

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
  const s: Story = {
    plot,
    up,
    hour,
    further,
    move: e.move,
    hook: '',
    punch: '',
    clock: hhmm(e.time),
    clockLater: hhmm(e.time + HOUR * 60_000),
  };
  const hooks = HOOKS[plot];
  const punches = PUNCHES[plot];
  s.hook = hooks[variant % hooks.length](s, e.base);
  s.punch = punches[variant % punches.length](s);
  return s;
}

export { pct };
