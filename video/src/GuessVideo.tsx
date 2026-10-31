import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Chart } from './Chart';
import { BG, DISPLAY, DOWN, Flash, INK, MUTE, Outro, Slam, UI, UP, fmtPrice, shake } from './parts';
import { type MarketEvent, pct, story } from './story';

export type GuessVideoProps = { event: MarketEvent; variant: number };

/**
 * "Guess what happens next": the chart runs to the signal candle and stops, the viewer gets three
 * seconds to pick a side, then the real next hour plays. Built for comments, which the feed rewards.
 */
export const GUESS = { hook: 36, replay: 84, freeze: 72, reveal: 60, outro: 40 };
export const GUESS_DURATION = Object.values(GUESS).reduce((a, b) => a + b, 0);

const HOOKS = ['Угадай,\nчто дальше 👇', 'Лонг или шорт?', 'Куда пойдёт\nцена?', 'Ты бы зашёл?', 'Проверим\nтвою интуицию'];
export const GUESS_TELLINGS = HOOKS.length;

/**
 * The chart. Until the answer its price scale knows only the past: a scale already stretched to
 * where the price goes next would give the answer away.
 */
const Board = ({ event, reach, dim = 0, seed, hit, answered = false }: { event: MarketEvent; reach: number; dim?: number; seed: string; hit: number | null; answered?: boolean }) => {
  const { x, y } = hit !== null ? shake(hit, seed, 34) : { x: 0, y: 0 };
  const price = fmtPrice(event.candles[Math.min(event.candles.length - 1, Math.floor(reach))].c);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', top: 120, left: 70, right: 70, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 44, color: MUTE }}>фьючерсы · 1 мин</span>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 64, color: INK, fontVariantNumeric: 'tabular-nums' }}>{price}</span>
      </div>
      <div style={{ position: 'absolute', top: 300, left: 20, transform: `translate(${x}px, ${y}px)`, opacity: 1 - dim }}>
        <Chart candles={event.candles.slice(0, event.at + 61)} shown={reach} width={1040} height={1000} rangeTo={answered ? event.at + 61 : event.at + 1} mark={reach > event.at + 1 ? event.at : null} />
      </div>
    </AbsoluteFill>
  );
};

const Replay = ({ event }: { event: MarketEvent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reach = interpolate(frame, [0, 34, 50], [event.at - 30, event.at, event.at + 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  const after = frame - 50;
  const stamp = spring({ frame: after, fps, config: { damping: 11, stiffness: 220 } });
  return (
    <AbsoluteFill>
      <Board event={event} reach={reach} seed={`${event.id}g`} hit={after >= 0 ? after : null} />
      {after >= 0 ? (
        <div style={{ position: 'absolute', top: 1360, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp})` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 150, color: event.type === 'PUMP' ? UP : DOWN }}>{pct(event.move)}</span>
          <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 48, color: INK }}>за 5 минут</div>
        </div>
      ) : null}
      <Flash at={50} />
    </AbsoluteFill>
  );
};

/** The pause: two sides to pick, a countdown, a nudge to answer in the comments. */
const Freeze = ({ event }: { event: MarketEvent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const count = 3 - Math.min(2, Math.floor(frame / 24));
  const tick = frame % 24;
  const pop = spring({ frame: tick, fps, config: { damping: 12, stiffness: 260 } });
  const buttons = spring({ frame, fps, config: { damping: 14, stiffness: 200 } });
  const side = (label: string, color: string) => (
    <div style={{ flex: 1, padding: '34px 0', borderRadius: 30, background: color, color: '#fff', fontFamily: DISPLAY, fontWeight: 800, fontSize: 64, textAlign: 'center' }}>{label}</div>
  );
  return (
    <AbsoluteFill>
      <Board event={event} reach={event.at + 1} dim={0.55} seed="" hit={null} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 50 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 90, color: INK, textTransform: 'uppercase' }}>Что дальше?</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 300, color: INK, transform: `scale(${0.6 + 0.4 * pop})`, lineHeight: 1 }}>{count}</div>
        <div style={{ display: 'flex', gap: 40, width: 900, transform: `translateY(${(1 - buttons) * 200}px)`, opacity: buttons }}>
          {side('⬆ ВВЕРХ', UP)}
          {side('⬇ ВНИЗ', DOWN)}
        </div>
        <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 50, color: INK }}>Пиши ответ в комменты 👇</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Reveal = ({ event, answer }: { event: MarketEvent; answer: string }) => {
  const frame = useCurrentFrame();
  const reach = interpolate(frame, [0, 30], [event.at + 1, event.at + 61], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  return (
    <AbsoluteFill>
      <Board event={event} reach={reach} seed="" hit={null} answered />
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 440 }}>
        {frame >= 22 ? (
          <Slam size={84} seed={`${event.id}ans`}>
            {answer}
          </Slam>
        ) : null}
      </AbsoluteFill>
      <Flash at={0} />
    </AbsoluteFill>
  );
};

export const GuessVideo = ({ event, variant }: GuessVideoProps) => {
  const s = story(event, 0);
  const answer =
    Math.abs(s.hour) < 1 ? `Никуда 🙃\n${pct(s.hour)} за час` : s.hour > 0 ? `⬆ Вверх:\n${pct(s.hour)} за час` : `⬇ Вниз:\n${pct(s.hour)} за час`;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Series>
        <Series.Sequence durationInFrames={GUESS.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={92} seed={`${event.id}gh`}>
              {HOOKS[variant % HOOKS.length]}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={GUESS.replay}>
          <Replay event={event} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={GUESS.freeze}>
          <Freeze event={event} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={GUESS.reveal}>
          <Reveal event={event} answer={answer} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={GUESS.outro}>
          <Outro line="подпишись, чтобы угадать следующую" />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
