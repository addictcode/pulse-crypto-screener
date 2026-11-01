import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Chart } from './Chart';
import { BG, DISPLAY, DOWN, Flash, INK, MUTE, Outro, Slam, UI, UP, shake } from './parts';
import { type Lang, type MarketEvent, pct } from './story';
import { Cues, cuts } from './sfx';
import { TEXT } from './text.ts';

/** 30 anonymous coins' five minute changes for each minute of the hour (scripts/pulse.mjs). */
export type Hour = { focus: number; tiles: number[][] };
export type PulseVideoProps = { event: MarketEvent; hour: Hour; variant: number; lang: Lang; sfx?: boolean };

/**
 * "The pulse of the market": a dark grid of 30 tiles, one per coin and none named, lighting up
 * green and red with each coin's real five minute change as the hour runs; the event's tile
 * flares, grows to fill the screen and turns into its chart.
 */
export const PULSE = { hook: 36, hour: 176, zoom: 30, chart: 66, outro: 40 };
export const PULSE_DURATION = Object.values(PULSE).reduce((a, b) => a + b, 0);
const PER_MINUTE = 3;
/** the event's minute within the hour, as scripts/pulse.mjs stores it */
const AT = 50;

const COLS = 5;
const SIZE = 180;
const GAP = 16;
const LEFT = (1080 - (COLS * SIZE + (COLS - 1) * GAP)) / 2;
const TOP = 330;
const tileBox = (i: number) => ({ left: LEFT + (i % COLS) * (SIZE + GAP), top: TOP + Math.floor(i / COLS) * (SIZE + GAP) });

const Tile = ({ change, hot, i }: { change: number; hot: boolean; i: number }) => {
  const strength = Math.min(1, Math.abs(change) / 4);
  const color = change >= 0 ? '46,189,133' : '246,70,93';
  const { left, top } = tileBox(i);
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: SIZE,
        height: SIZE,
        borderRadius: 26,
        background: `rgba(${color}, ${0.06 + 0.85 * strength})`,
        border: hot ? '4px solid #ffffff' : '2px solid #1b1c21',
        boxShadow: strength > 0.6 ? `0 0 ${50 * strength}px rgba(${color}, .7)` : 'none',
        transform: `scale(${1 + 0.08 * Math.max(0, strength - 0.5)})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: UI,
        fontWeight: 700,
        fontSize: 38,
        color: strength > 0.35 ? '#ffffff' : MUTE,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {Math.abs(change) >= 0.3 ? pct(change) : ''}
    </div>
  );
};

const HourScene = ({ hour, lang, seed }: { hour: Hour; lang: Lang; seed: string }) => {
  const frame = useCurrentFrame();
  const text = TEXT[lang].pulse;
  // the clock stops at the event: what came after is not this video's story
  const minute = Math.min(AT, Math.floor(frame / PER_MINUTE));
  const hit = frame - AT * PER_MINUTE;
  const { x, y } = hit >= 0 ? shake(hit, seed, 26) : { x: 0, y: 0 };
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', top: 130, left: 70, right: 70, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 38, color: MUTE }}>{text.label}</span>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 60, color: INK, fontVariantNumeric: 'tabular-nums' }}>{text.minute(minute + 1)}</span>
      </div>
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${x}px, ${y}px)` }}>
        {hour.tiles.map((series, i) => (
          <Tile key={i} i={i} change={series[minute]} hot={hit >= 0 && i === hour.focus} />
        ))}
      </div>
      <Flash at={AT * PER_MINUTE} />
    </AbsoluteFill>
  );
};

/** The event's tile grows from its place to the whole screen. */
const Zoom = ({ hour, event }: { hour: Hour; event: MarketEvent }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, PULSE.zoom], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const { left, top } = tileBox(hour.focus);
  const change = hour.tiles[hour.focus][AT];
  const color = change >= 0 ? UP : DOWN;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div
        style={{
          position: 'absolute',
          left: left * (1 - t),
          top: top * (1 - t),
          width: SIZE + (1080 - SIZE) * t,
          height: SIZE + (1920 - SIZE) * t,
          borderRadius: 26 * (1 - t),
          background: color,
          opacity: 1 - 0.75 * t,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: 38 + 160 * t,
          color: '#fff',
        }}
      >
        {pct(change)}
      </div>
    </AbsoluteFill>
  );
};

/**
 * The tile's coin as a chart. The number is the tile's own, close to close over five minutes, so
 * the screen does not show two different "5 minutes" for one coin.
 */
const ChartScene = ({ event, change, lang }: { event: MarketEvent; change: number; lang: Lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = TEXT[lang];
  const reach = interpolate(frame, [0, 24], [event.at - 30, event.at + 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const stamp = spring({ frame: frame - 24, fps, config: { damping: 11, stiffness: 220 } });
  const up = change >= 0;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', top: 140, left: 0, right: 0, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 72, color: INK, textTransform: 'uppercase' }}>{text.pulse.oneOf}</div>
      <div style={{ position: 'absolute', top: 330, left: 20 }}>
        <Chart candles={event.candles.slice(0, event.at + 6)} shown={reach} width={1040} height={950} rangeTo={event.at + 1} mark={null} />
      </div>
      {frame >= 24 ? (
        <div style={{ position: 'absolute', top: 1320, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp})` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 160, color: up ? UP : DOWN }}>{pct(change)}</span>
          <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 50, color: INK }}>{text.in5}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const PulseVideo = ({ event, hour, variant, lang, sfx }: PulseVideoProps) => {
  const text = TEXT[lang].pulse;
  const cues = [...cuts(Object.values(PULSE)), { at: PULSE.hook + AT * PER_MINUTE, kind: 'hit' as const }];
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Cues on={sfx} list={cues} />
      <Series>
        <Series.Sequence durationInFrames={PULSE.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={90} seed={`${event.id}ph${variant}`}>
              {text.hooks[variant % text.hooks.length]}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={PULSE.hour}>
          <HourScene hour={hour} lang={lang} seed={`${event.id}pu`} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={PULSE.zoom}>
          <Zoom hour={hour} event={event} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={PULSE.chart}>
          <ChartScene event={event} change={hour.tiles[hour.focus][AT]} lang={lang} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={PULSE.outro}>
          <Outro lang={lang} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
