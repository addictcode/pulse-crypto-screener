import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Chart } from './Chart';
import { DISPLAY, DOWN, Flash, INK, Outro, Slam, UI, UP, shake } from './parts';
import { type Lang, type MarketEvent, pct } from './story';
import { Cues, cuts } from './sfx';
import { TEXT } from './text.ts';
import { burst } from './volume.ts';

export type VolumeVideoProps = { event: MarketEvent; variant: number; lang: Lang; sfx?: boolean };

/**
 * "Volume exploded": volume bars fill the screen at a scale made for ordinary minutes, then the
 * burst grows through the top of the frame with its multiple counting up, the scale steps back to
 * fit it, and only then the price shows underneath. Violet, so it reads as its own format.
 */
export const VOLUME = { hook: 36, burst: 156, end: 54, outro: 40 };
export const VOLUME_DURATION = Object.values(VOLUME).reduce((a, b) => a + b, 0);

const INK_BG = '#0d0a17';
const BAR = '#8b6cf6';
const HOT = '#ff5ad1';
const W = 1000;
const TOP = 260; // where the bars may reach before the scale steps back
const BASE = 1250; // the bars' floor

const Burst = ({ event, lang }: { event: MarketEvent; lang: Lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = TEXT[lang].volume;
  const { average, times } = burst(event);
  const bars = event.candles.slice(0, event.at + 1);
  const first = event.at - 5;
  // ordinary minutes first, quickly; then the last six grow, slowly enough to feel
  const normal = interpolate(frame, [0, 34], [0, first], { extrapolateRight: 'clamp' });
  const grow = interpolate(frame, [40, 84], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  // the scale: an average minute is a fifth of the room, until the burst is out; then it fits all
  const room = BASE - TOP;
  const fitted = room / Math.max(...bars.map((c) => c.v));
  const ordinary = room / 5 / average;
  const scale = interpolate(frame, [92, 112], [ordinary, Math.min(ordinary, fitted)], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const slot = W / bars.length;
  const peak = Math.max(...bars.slice(first).map((c) => c.v * grow));
  const shown = Math.max(1, Math.floor((peak / average) * 1));
  const out = frame >= 84;
  const { x, y } = out ? shake(frame - 84, `${event.id}vb`, 34) : { x: 0, y: 0 };
  const price = interpolate(frame, [118, 136], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const stamp = spring({ frame: frame - 130, fps, config: { damping: 11, stiffness: 220 } });
  const up = event.type === 'PUMP';
  const avgY = BASE - average * scale;
  return (
    <AbsoluteFill style={{ background: INK_BG, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 120, left: 70, fontFamily: UI, fontWeight: 600, fontSize: 44, color: '#8c84b0' }}>{text.label}</div>
      <svg width={1080} height={1920} style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${x}px, ${y}px)` }}>
        <line x1={40} x2={1040} y1={avgY} y2={avgY} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="14 12" />
        <text x={44} y={avgY - 16} textAnchor="start" fill="#b9b2d8" fontFamily="Onest, sans-serif" fontSize={34} fontWeight={600}>
          {text.average}
        </text>
        {bars.map((c, i) => {
          const v = i < first ? (i < normal ? c.v : 0) : c.v * grow;
          const h = v * scale;
          const hot = i >= first;
          return <rect key={c.t} x={40 + slot * i + slot * 0.12} y={BASE - h} width={slot * 0.76} height={h} fill={hot ? HOT : BAR} opacity={hot ? 1 : 0.8} rx={4} />;
        })}
      </svg>
      {grow > 0 ? (
        <div style={{ position: 'absolute', top: 300, left: 0, right: 0, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 210, color: '#ffffff', textShadow: `0 0 60px ${HOT}`, fontVariantNumeric: 'tabular-nums', opacity: 1 - price * 0.7 }}>
          ×{Math.min(times, shown)}
        </div>
      ) : null}
      <div style={{ position: 'absolute', top: 1290, left: 20, opacity: price, transform: `translateY(${(1 - price) * 80}px)` }}>
        <Chart candles={event.candles.slice(0, event.at + 1)} shown={event.at + 1} width={1040} height={380} rangeTo={event.at + 1} mark={null} grid="#1c1730" />
      </div>
      {frame >= 130 ? (
        <div style={{ position: 'absolute', top: 760, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp})` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 150, color: up ? UP : DOWN, textShadow: '0 10px 50px rgba(0,0,0,.9)' }}>{pct(event.move)}</span>
          <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 48, color: INK, textShadow: '0 4px 30px rgba(0,0,0,.9)' }}>{TEXT[lang].in5}</div>
        </div>
      ) : null}
      <Flash at={84} color={HOT} />
    </AbsoluteFill>
  );
};

export const VolumeVideo = ({ event, variant, lang, sfx }: VolumeVideoProps) => {
  const text = TEXT[lang].volume;
  const cues = [...cuts(Object.values(VOLUME)), { at: VOLUME.hook + 84, kind: 'hit' as const }, { at: VOLUME.hook + 130, kind: 'click' as const }];
  return (
    <AbsoluteFill style={{ background: INK_BG }}>
      <Cues on={sfx} list={cues} />
      <Series>
        <Series.Sequence durationInFrames={VOLUME.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={88} seed={`${event.id}vh${variant}`}>
              {text.hooks[variant % text.hooks.length]}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={VOLUME.burst}>
          <Burst event={event} lang={lang} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={VOLUME.end}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={84} seed={`${event.id}ve`}>
              {text.end(burst(event).times, event.move)}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={VOLUME.outro}>
          <Outro lang={lang} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
