import { AbsoluteFill, Easing, Series, interpolate, useCurrentFrame } from 'remotion';

import { Chart } from './Chart';
import { BG, DISPLAY, DOWN, Flash, INK, MUTE, Outro, Slam, UI, UP, shake } from './parts';
import { type Lang, type MarketEvent, pct, story } from './story';
import { Cues, cuts } from './sfx';
import { TEXT } from './text.ts';

export type CounterVideoProps = { event: MarketEvent; variant: number; lang: Lang; sfx?: boolean };

/**
 * A stopwatch over the five minutes: a huge running percent, the clock from 00:00 to 05:00 and the
 * candles drawing underneath. The number is the story; the chart only proves it.
 */
export const COUNTER = { hook: 36, run: 126, after: 54, outro: 40 };
export const COUNTER_DURATION = Object.values(COUNTER).reduce((a, b) => a + b, 0);

export const COUNTER_TELLINGS = 5;

/** From the calm before to the signal candle, frame by frame. */
const START = 18;
const END = 108;

const Run = ({ event }: { event: MarketEvent }) => {
  const frame = useCurrentFrame();
  const up = event.type === 'PUMP';
  const first = event.at - 5;
  // counted from the price at 00:00, so the number moves with the candles drawn under it, and
  // ending on the extreme of the signal candle
  const window = event.candles.slice(first, event.at + 1);
  const base = window[0].o;
  const last = window[window.length - 1];
  const path = [base, ...window.slice(0, -1).map((c) => c.c), up ? last.h : last.l];
  const progress = interpolate(frame, [START, END], [0, path.length - 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const i = Math.floor(progress);
  const price = i >= path.length - 1 ? path[path.length - 1] : path[i] + (path[i + 1] - path[i]) * (progress - i);
  const value = (price / base - 1) * 100;
  const seconds = Math.round(interpolate(frame, [START, END], [0, 300], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const reach = interpolate(frame, [0, START, END], [event.at - 30, first, event.at + 1], { extrapolateRight: 'clamp' });
  const done = frame - END;
  const { x, y } = done >= 0 ? shake(done, `${event.id}c`, 36) : { x: 0, y: 0 };
  const color = Math.abs(value) < 0.05 ? INK : value > 0 ? UP : DOWN;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', top: 150, left: 0, right: 0, textAlign: 'center', fontFamily: UI, fontWeight: 600, fontSize: 64, color: MUTE, fontVariantNumeric: 'tabular-nums' }}>
        ⏱ {clock}
      </div>
      <div style={{ position: 'absolute', top: 290, left: 0, right: 0, textAlign: 'center', transform: `translate(${x}px, ${y}px) scale(${done >= 0 ? 1 + 0.1 * Math.max(0, 1 - done / 8) : 1})` }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 230, color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>{pct(value)}</span>
      </div>
      <div style={{ position: 'absolute', top: 700, left: 20, opacity: 0.9 }}>
        <Chart candles={event.candles.slice(0, event.at + 4)} shown={reach} width={1040} height={760} rangeTo={event.at + 1} mark={null} />
      </div>
      <Flash at={END} />
    </AbsoluteFill>
  );
};

const After = ({ event, text }: { event: MarketEvent; text: string }) => {
  const frame = useCurrentFrame();
  const reach = interpolate(frame, [0, 30], [event.at + 1, event.at + 61], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', top: 700, left: 20, opacity: 0.6 }}>
        <Chart candles={event.candles.slice(0, event.at + 61)} shown={reach} width={1040} height={760} rangeTo={event.at + 61} mark={event.at} />
      </div>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 300 }}>
        <Slam size={84} seed={`${event.id}ca`}>
          {text}
        </Slam>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const CounterVideo = ({ event, variant, lang, sfx }: CounterVideoProps) => {
  const s = story(event, 0, lang);
  const text = TEXT[lang].counter;
  const cues = [...cuts(Object.values(COUNTER)), { at: COUNTER.hook + END, kind: 'hit' as const }];
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Cues on={sfx} list={cues} />
      <Series>
        <Series.Sequence durationInFrames={COUNTER.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={92} seed={`${event.id}ch${variant}`}>
              {text.hooks[variant % text.hooks.length]}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={COUNTER.run}>
          <Run event={event} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={COUNTER.after}>
          <After event={event} text={text.after(s.hour)} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={COUNTER.outro}>
          <Outro lang={lang} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
