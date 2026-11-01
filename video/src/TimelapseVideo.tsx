import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { DISPLAY, DOWN, Flash, INK, Outro, Slam, UI, UP, shake } from './parts';
import { type Lang, type MarketEvent, pct } from './story';
import { TEXT } from './text.ts';

/** 24 hours of five minute bars around an event, [o, h, l, c, v] rows (scripts/days.mjs). */
export type Day = { start: number; at: number; bars: number[][] };
export type TimelapseVideoProps = { event: MarketEvent; day: Day; variant: number; lang: Lang };

/**
 * "24 hours in 6 seconds": the whole day races by as a glowing line, the clock counts the hours
 * gone (not the time of day: the videos never tell when), and at the event the day stops for a
 * beat with the five minute move stamped on it. Night blue, so it reads as its own format.
 */
export const TIMELAPSE = { hook: 36, run: 216, end: 60, outro: 40 };
export const TIMELAPSE_DURATION = Object.values(TIMELAPSE).reduce((a, b) => a + b, 0);
const DRAW = 180; // frames for the 288 bars
const PAUSE = 36; // frames the day stands still at the event

const NIGHT = '#0a0f1e';
const GRID = '#141b2e';
const LINE = '#6cc7ff';
const W = 1040;
const H = 900;

/** Bars drawn by run frame f: the day at a steady pace, holding still at the event. */
function shownAt(f: number, at: number, total: number) {
  const reach = ((at + 1) / total) * DRAW;
  if (f < reach) return (f / DRAW) * total;
  if (f < reach + PAUSE) return at + 1;
  return Math.min(total, ((f - PAUSE) / DRAW) * total);
}

const DayChart = ({ day, shown, glow, zoom = 1 }: { day: Day; shown: number; glow: number; zoom?: number }) => {
  const bars = day.bars;
  const hi = Math.max(...bars.map((b) => b[1]));
  const lo = Math.min(...bars.map((b) => b[2]));
  const pad = (hi - lo) * 0.06;
  const y = (p: number) => ((hi + pad - p) / (hi - lo + 2 * pad)) * H;
  const slot = W / bars.length;
  const n = Math.max(1, Math.min(bars.length, Math.ceil(shown)));
  const points = bars.slice(0, n).map((b, i) => `${(slot * (i + 0.5)).toFixed(1)},${y(b[3]).toFixed(1)}`);
  const head = points[points.length - 1].split(',').map(Number);
  const ex = slot * (day.at + 0.5);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ transform: `scale(${zoom})`, transformOrigin: `${ex}px ${H / 2}px`, overflow: 'visible' }}>
      <defs>
        <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={LINE} stopOpacity={0.28} />
          <stop offset="1" stopColor={LINE} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke={GRID} strokeWidth={2} />
      ))}
      {/* every bar's range, faint: a spike shows even when its close came back */}
      {bars.slice(0, n).map((b, i) => (
        <line key={i} x1={slot * (i + 0.5)} x2={slot * (i + 0.5)} y1={y(b[1])} y2={y(b[2])} stroke={LINE} strokeOpacity={0.35} strokeWidth={2} />
      ))}
      <polygon points={`${slot * 0.5},${H} ${points.join(' ')} ${head[0]},${H}`} fill="url(#area)" />
      <polyline points={points.join(' ')} fill="none" stroke={LINE} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
      {shown > day.at ? (
        <>
          <rect x={ex - slot * 3} y={0} width={slot * 6} height={H} fill="#ffffff" opacity={0.06 + 0.12 * glow} />
          <circle cx={ex} cy={y(bars[day.at][3])} r={18 + 40 * glow} fill="none" stroke="#ffffff" strokeOpacity={0.7 * glow} strokeWidth={4} />
        </>
      ) : null}
      <circle cx={head[0]} cy={head[1]} r={12} fill="#ffffff" />
      <circle cx={head[0]} cy={head[1]} r={30} fill={LINE} opacity={0.25} />
    </svg>
  );
};

const Run = ({ event, day, lang }: { event: MarketEvent; day: Day; lang: Lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = TEXT[lang].timelapse;
  const total = day.bars.length;
  const shown = shownAt(frame, day.at, total);
  const stop = Math.round(((day.at + 1) / total) * DRAW);
  const paused = frame - stop;
  const inPause = paused >= 0 && paused < PAUSE;
  const stamp = spring({ frame: paused, fps, config: { damping: 11, stiffness: 220 } });
  const glow = inPause ? 1 - paused / PAUSE / 2 : paused >= PAUSE ? 0.3 : 0;
  const zoom = inPause ? 1 + 0.12 * Math.sin((Math.min(paused, PAUSE) / PAUSE) * Math.PI) : 1;
  const { x, y } = paused >= 0 ? shake(paused, `${event.id}tl`, 30) : { x: 0, y: 0 };
  const hours = Math.min(24, Math.floor((shown / total) * 24));
  const up = event.type === 'PUMP';
  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      <div style={{ position: 'absolute', top: 120, left: 70, right: 70, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 40, color: '#7d8bb0' }}>{text.label}</span>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 40, color: '#7d8bb0' }}>{text.speed}</span>
      </div>
      <div style={{ position: 'absolute', top: 210, left: 0, right: 0, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 200, color: inPause ? '#ffffff' : INK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>
        {text.hours(hours)}
      </div>
      <div style={{ position: 'absolute', top: 600, left: 20, transform: `translate(${x}px, ${y}px)` }}>
        <DayChart day={day} shown={shown} glow={glow} zoom={zoom} />
      </div>
      {paused >= 0 ? (
        <div style={{ position: 'absolute', top: 1470, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp})`, opacity: inPause ? 1 : Math.max(0, 1 - (paused - PAUSE) / 8) }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 150, color: up ? UP : DOWN, textShadow: '0 10px 50px rgba(0,0,0,.8)' }}>{pct(event.move)}</span>
          <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 48, color: INK }}>{TEXT[lang].in5}</div>
        </div>
      ) : null}
      <Flash at={stop} />
    </AbsoluteFill>
  );
};

const End = ({ event, day, lang }: { event: MarketEvent; day: Day; lang: Lang }) => {
  const frame = useCurrentFrame();
  const net = (day.bars[day.bars.length - 1][3] / day.bars[0][0] - 1) * 100;
  const o = interpolate(frame, [0, 10], [0, 0.45], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      <div style={{ position: 'absolute', top: 760, left: 20, opacity: o }}>
        <DayChart day={day} shown={day.bars.length} glow={0.6} />
      </div>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 300 }}>
        <Slam size={80} seed={`${event.id}tle`}>
          {TEXT[lang].timelapse.end(net, event.move)}
        </Slam>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const TimelapseVideo = ({ event, day, variant, lang }: TimelapseVideoProps) => {
  const text = TEXT[lang].timelapse;
  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      <Series>
        <Series.Sequence durationInFrames={TIMELAPSE.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={92} seed={`${event.id}tlh${variant}`}>
              {text.hooks[variant % text.hooks.length]}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={TIMELAPSE.run}>
          <Run event={event} day={day} lang={lang} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={TIMELAPSE.end}>
          <End event={event} day={day} lang={lang} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={TIMELAPSE.outro}>
          <Outro lang={lang} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
