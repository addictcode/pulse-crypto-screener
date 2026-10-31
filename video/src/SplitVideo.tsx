import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { BG, DISPLAY, DOWN, Flash, INK, MUTE, Outro, Slam, UI, UP, shake } from './parts';
import { halves } from './split.ts';
import { type Candle, type Lang, type MarketEvent, pct } from './story';
import { TEXT } from './text.ts';

export type SplitVideoProps = { event: MarketEvent; variant: number; lang: Lang };

/**
 * "Before / after": the screen split down the middle, the quiet minutes before the move on the
 * left in grey, the five minutes of the move on the right in colour, both on one price scale, so
 * the difference is the whole picture.
 */
export const SPLIT = { hook: 42, show: 150, end: 54, outro: 40 };
export const SPLIT_DURATION = Object.values(SPLIT).reduce((a, b) => a + b, 0);

const HALF = 540;
const CH = 1000;

const Candles = ({ bars, shown, lo, hi, width, mono }: { bars: Candle[]; shown: number; lo: number; hi: number; width: number; mono: boolean }) => {
  const y = (p: number) => ((hi - p) / (hi - lo)) * CH;
  const slot = width / bars.length;
  const body = Math.max(3, slot * 0.66);
  const visible = bars.slice(0, Math.ceil(shown));
  return (
    <svg width={width} height={CH} viewBox={`0 0 ${width} ${CH}`}>
      {visible.map((c, i) => {
        const grow = i === visible.length - 1 ? shown - Math.floor(shown) || 1 : 1;
        const close = c.o + (c.c - c.o) * grow;
        const high = c.o + (c.h - c.o) * grow;
        const low = c.o + (c.l - c.o) * grow;
        const color = mono ? '#5d6068' : close >= c.o ? UP : DOWN;
        const x = slot * (i + 0.5);
        return (
          <g key={c.t}>
            <line x1={x} x2={x} y1={y(high)} y2={y(low)} stroke={color} strokeWidth={Math.max(2, slot * 0.12)} />
            <rect x={x - body / 2} y={y(Math.max(c.o, close))} width={body} height={Math.max(2, Math.abs(y(c.o) - y(close)))} fill={color} />
          </g>
        );
      })}
    </svg>
  );
};

const Show = ({ event, lang }: { event: MarketEvent; lang: Lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = TEXT[lang].split;
  const { calm, move, change } = halves(event);
  const all = [...calm, ...move];
  const hi0 = Math.max(...all.map((c) => c.h));
  const lo0 = Math.min(...all.map((c) => c.l));
  const pad = (hi0 - lo0) * 0.08;
  const [lo, hi] = [lo0 - pad, hi0 + pad];
  const divider = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const left = interpolate(frame, [6, 50], [0, calm.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const right = interpolate(frame, [62, 112], [0, move.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const hit = frame - 112;
  const stamp = spring({ frame: hit, fps, config: { damping: 10, stiffness: 230 } });
  const { x, y } = hit >= 0 ? shake(hit, `${event.id}sp`, 30) : { x: 0, y: 0 };
  const up = event.type === 'PUMP';
  const label = (s: string, color: string) => <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 40, color, textAlign: 'center' }}>{s}</div>;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: HALF, bottom: 0, background: '#0f1013' }} />
      <div style={{ position: 'absolute', left: HALF, top: 0, width: HALF, bottom: 0, background: `radial-gradient(circle at 50% 50%, ${up ? 'rgba(46,189,133,.14)' : 'rgba(246,70,93,.14)'}, transparent 70%)`, opacity: hit >= 0 ? 1 : 0.3 }} />
      <div style={{ position: 'absolute', left: HALF - 2, top: 200, width: 4, height: 1300 * divider, background: '#2a2c33' }} />
      <div style={{ position: 'absolute', top: 160, left: 0, width: HALF }}>{label(text.before(calm.length), MUTE)}</div>
      <div style={{ position: 'absolute', top: 160, left: HALF, width: HALF }}>{label(text.after, INK)}</div>
      <div style={{ position: 'absolute', top: 290, left: 20 }}>
        <Candles bars={calm} shown={left} lo={lo} hi={hi} width={HALF - 40} mono />
      </div>
      <div style={{ position: 'absolute', top: 290, left: HALF + 40, transform: `translate(${x}px, ${y}px)` }}>
        <Candles bars={move} shown={right} lo={lo} hi={hi} width={HALF - 80} mono={false} />
      </div>
      {left >= calm.length ? (
        <div style={{ position: 'absolute', top: 1340, left: 0, width: HALF, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 86, color: MUTE }}>{pct(change)}</div>
      ) : null}
      {hit >= 0 ? (
        <div style={{ position: 'absolute', top: 1310, left: HALF, width: HALF, textAlign: 'center', transform: `scale(${stamp})` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 130, color: up ? UP : DOWN }}>{pct(event.move)}</span>
        </div>
      ) : null}
      <Flash at={112} />
    </AbsoluteFill>
  );
};

export const SplitVideo = ({ event, variant, lang }: SplitVideoProps) => {
  const text = TEXT[lang].split;
  const { calm, change } = halves(event);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Series>
        <Series.Sequence durationInFrames={SPLIT.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={84} seed={`${event.id}sph${variant}`}>
              {text.hooks[variant % text.hooks.length]}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={SPLIT.show}>
          <Show event={event} lang={lang} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SPLIT.end}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={84} seed={`${event.id}spe`}>
              {text.end(calm.length, change, event.move)}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={SPLIT.outro}>
          <Outro lang={lang} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
