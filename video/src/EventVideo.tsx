import { AbsoluteFill, Easing, Series, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Chart } from './Chart';
import { type MarketEvent, pct, story } from './story';

export type EventVideoProps = { event: MarketEvent; variant: number };

const BG = '#070708';
const INK = '#e9eaec';
const MUTE = '#8b8e96';
const UP = '#2ebd85';
const DOWN = '#f6465d';
const DISPLAY = 'Unbounded, sans-serif';
const UI = 'Onest, sans-serif';

/** Scene lengths in frames at 30 fps: short and hard-cut, the way the feed is watched. */
export const SCENES = { hook: 42, ticker: 24, replay: 96, punch: 48, outro: 45 };
export const DURATION = Object.values(SCENES).reduce((a, b) => a + b, 0);

/** A few frames of decaying jitter, for impacts. */
function shake(frame: number, seed: string, strength = 26) {
  const decay = Math.max(0, 1 - frame / 9);
  return {
    x: (random(`${seed}x${frame}`) - 0.5) * strength * decay,
    y: (random(`${seed}y${frame}`) - 0.5) * strength * decay,
  };
}

/** Text that slams in: starts large and lands in four frames. */
const Slam = ({ children, size, color = INK, seed }: { children: string; size: number; color?: string; seed: string }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 4], [1.6, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const { x, y } = shake(frame - 3, seed);
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.08,
        color,
        textAlign: 'center',
        whiteSpace: 'pre-line',
        textTransform: 'uppercase',
        letterSpacing: '-0.02em',
        transform: `translate(${x}px, ${y}px) scale(${scale})`,
        padding: '0 70px',
      }}
    >
      {children}
    </div>
  );
};

/** Two white frames: the cut the eye feels. */
const Flash = ({ at }: { at: number }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [at, at + 1, at + 3], [0, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: '#fff', opacity: o }} />;
};

const Brand = ({ size = 40 }: { size?: number }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.35, fontFamily: UI, fontWeight: 600, fontSize: size, color: INK }}>
    <svg width={size * 1.2} height={size * 1.2} viewBox="0 0 24 24">
      <path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M12 12 21 7M12 12v10M12 12 3 7" fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.55} />
    </svg>
    Pulse
  </div>
);

const Hook = ({ text, id }: { text: string; id: string }) => (
  <AbsoluteFill style={{ background: BG, justifyContent: 'center', alignItems: 'center' }}>
    <Slam size={text.length > 34 ? 72 : 88} seed={`${id}hook`}>
      {text}
    </Slam>
  </AbsoluteFill>
);

const Ticker = ({ event }: { event: MarketEvent }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 24], [1.15, 1]);
  return (
    <AbsoluteFill style={{ background: BG, justifyContent: 'center', alignItems: 'center', gap: 20 }}>
      {/* Unbounded is wide: a long ticker gets a smaller size instead of running off the screen */}
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: Math.min(260, 1000 / event.base.length), color: INK, transform: `scale(${scale})`, letterSpacing: '-0.03em' }}>
        {event.base}
      </div>
      <div style={{ fontFamily: UI, fontSize: 46, color: MUTE }}>
        {new Date(event.time).toISOString().slice(0, 10)} · {new Date(event.time).toISOString().slice(11, 16)} UTC · Binance
      </div>
    </AbsoluteFill>
  );
};

const Replay = ({ event, line }: { event: MarketEvent; line: string }) => {
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
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 92, color: INK }}>{event.base}</span>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 64, color: INK, fontVariantNumeric: 'tabular-nums' }}>{price}</span>
      </div>
      <div style={{ position: 'absolute', top: 330, left: 20, transform: `translate(${x}px, ${y}px) scale(${punch})`, transformOrigin: '70% 50%' }}>
        <Chart candles={event.candles.slice(0, event.at + 31)} shown={reach} width={1040} height={1020} rangeTo={event.at + 1} mark={after >= 0 ? event.at : null} />
      </div>
      {after >= 0 ? (
        <div style={{ position: 'absolute', top: 470, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp}) rotate(${-4 * stamp}deg)` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 170, color, textShadow: '0 10px 60px rgba(0,0,0,.9)' }}>{pct(event.move)}</span>
          <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 52, color: INK, textShadow: '0 4px 30px rgba(0,0,0,.9)' }}>за 5 минут</div>
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
          <span style={{ fontFamily: UI, fontSize: 32, color: MUTE }}>сейчас</span>
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

const Outro = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG, justifyContent: 'center', alignItems: 'center', gap: 34, opacity: o }}>
      <Brand size={96} />
      <div style={{ fontFamily: UI, fontSize: 50, color: INK, textAlign: 'center', lineHeight: 1.3 }}>
        радар всего рынка фьючерсов
        <br />
        <span style={{ color: MUTE }}>ссылка в профиле</span>
      </div>
      <div style={{ position: 'absolute', bottom: 380, fontFamily: UI, fontSize: 30, color: MUTE }}>
        Реальные данные Binance. Не финансовый совет.
      </div>
    </AbsoluteFill>
  );
};

export const EventVideo = ({ event, variant }: EventVideoProps) => {
  const s = story(event, variant);
  const size = Math.abs(event.move);
  const line = `${event.base} ${event.type === 'PUMP' ? 'вырос' : 'упал'} на ${size.toFixed(size >= 10 ? 0 : 1)}% за пять минут`;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Series>
        <Series.Sequence durationInFrames={SCENES.hook}>
          <Hook text={s.hook} id={event.id} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.ticker}>
          <Ticker event={event} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.replay}>
          <Replay event={event} line={line} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.punch}>
          <Punch event={event} text={s.punch} further={s.further} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.outro}>
          <Outro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
