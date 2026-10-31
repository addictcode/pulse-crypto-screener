import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Chart } from './Chart';
import { BG, Brand, DISPLAY, DOWN, Flash, INK, MUTE, Outro, Slam, UI, UP, shake } from './parts';
import { type Lang, type MarketEvent, pct, story } from './story';
import { TEXT } from './text.ts';

export type EventVideoProps = { event: MarketEvent; variant: number; lang: Lang };

/** Scene lengths in frames at 30 fps: short and hard-cut, the way the feed is watched. */
export const SCENES = { hook: 42, calm: 24, replay: 96, punch: 48, outro: 45 };
export const DURATION = Object.values(SCENES).reduce((a, b) => a + b, 0);

const Hook = ({ text, id }: { text: string; id: string }) => (
  <AbsoluteFill style={{ background: BG, justifyContent: 'center', alignItems: 'center' }}>
    <Slam size={text.length > 34 ? 72 : 88} seed={`${id}hook`}>
      {text}
    </Slam>
  </AbsoluteFill>
);

/** The quiet beat before the move: a flat line and a calm sentence, cut short by the chart. */
const Calm = ({ text, id }: { text: string; id: string }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG, justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <div key={id} style={{ fontFamily: UI, fontWeight: 600, fontSize: 76, color: MUTE, textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.2 }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Replay = ({ event, line, lang }: { event: MarketEvent; line: string; lang: Lang }) => {
  const text = TEXT[lang];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const up = event.type === 'PUMP';
  const color = up ? UP : DOWN;
  // the history races in, then the signal candle grows slowly enough to feel
  const reach = interpolate(frame, [0, 34, 52], [event.at - 25, event.at, event.at + 1], {
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });
  const hit = 52;
  const after = frame - hit;
  const punch = after >= 0 ? 1 + 0.08 * Math.max(0, 1 - after / 8) : 1;
  const { x, y } = after >= 0 ? shake(after, `${event.id}hit`, 40) : { x: 0, y: 0 };
  const stamp = spring({ frame: after, fps, config: { damping: 11, stiffness: 220 } });
  const note = spring({ frame: after - 10, fps, config: { damping: 16, stiffness: 180 } });
  const price = Number(event.candles[Math.min(event.candles.length - 1, Math.floor(reach))].c.toPrecision(5));
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', top: 120, left: 70, right: 70, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 44, color: MUTE }}>{text.chartLabel}</span>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 64, color: INK, fontVariantNumeric: 'tabular-nums' }}>{price}</span>
      </div>
      <div style={{ position: 'absolute', top: 330, left: 20, transform: `translate(${x}px, ${y}px) scale(${punch})`, transformOrigin: '70% 50%' }}>
        <Chart candles={event.candles.slice(0, event.at + 31)} shown={reach} width={1040} height={1020} rangeTo={event.at + 1} mark={after >= 0 ? event.at : null} />
      </div>
      {after >= 0 ? (
        <div style={{ position: 'absolute', top: 470, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp}) rotate(${-4 * stamp}deg)` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 170, color, textShadow: '0 10px 60px rgba(0,0,0,.9)' }}>{pct(event.move)}</span>
          <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 52, color: INK, textShadow: '0 4px 30px rgba(0,0,0,.9)' }}>{text.in5}</div>
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 60,
          right: 60,
          // above TikTok's own caption and buttons, which cover the bottom of the screen
          bottom: 360,
          padding: '30px 34px',
          borderRadius: 34,
          background: 'rgba(28, 29, 33, .96)',
          border: '2px solid #2c2e34',
          opacity: note,
          transform: `translateY(${(1 - note) * 120}px)`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <Brand size={34} />
          <span style={{ fontFamily: UI, fontSize: 32, color: MUTE }}>{text.now}</span>
        </div>
        <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 42, color: INK, lineHeight: 1.25 }}>{line}</div>
      </div>
      <Flash at={hit} />
    </AbsoluteFill>
  );
};

const Punch = ({ event, text, further }: { event: MarketEvent; text: string; further: number }) => {
  const frame = useCurrentFrame();
  const reach = interpolate(frame, [0, 30], [event.at + 1, Math.min(event.candles.length, event.at + 61)], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', top: 720, left: 20, opacity: 0.55 }}>
        <Chart candles={event.candles.slice(0, event.at + 61)} shown={reach} width={1040} height={900} rangeTo={event.at + 61} mark={event.at} />
      </div>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 300 }}>
        <Slam size={text.length > 30 ? 70 : 84} color={INK} seed={`${event.id}punch${further}`}>
          {text}
        </Slam>
      </AbsoluteFill>
      <Flash at={0} />
    </AbsoluteFill>
  );
};

export const EventVideo = ({ event, variant, lang }: EventVideoProps) => {
  const s = story(event, variant, lang);
  const size = Math.abs(event.move);
  const line = TEXT[lang].notice(event.type === 'PUMP', `${size.toFixed(size >= 10 ? 0 : 1)}%`);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Series>
        <Series.Sequence durationInFrames={SCENES.hook}>
          <Hook text={s.hook} id={event.id} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.calm}>
          <Calm text={s.calm} id={event.id} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.replay}>
          <Replay event={event} line={line} lang={lang} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.punch}>
          <Punch event={event} text={s.punch} further={s.further} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.outro}>
          <Outro lang={lang} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
