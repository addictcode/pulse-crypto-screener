import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { BG, Brand, DISPLAY, DOWN, Flash, INK, MUTE, Outro, Slam, UI, UP } from './parts';
import { type Beat, type Episode, PARTS, beatFrames, episodeFrames } from './series';
import type { Lang } from './text';

export type SeriesVideoProps = { episode: Episode; part: number; lang: Lang };

export const seriesFrames = episodeFrames;

const fmt = (lang: Lang, n: number) => Math.round(n).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');

/** Fades and lifts a block in over a few frames. */
function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 160 } });
  return { opacity: p, transform: `translateY(${(1 - p) * 40}px)` };
}

const Lines = ({ text, size, color = INK, delay = 0 }: { text: string; size: number; color?: string; delay?: number }) => {
  const style = useEnter(delay);
  return (
    <div style={{ ...style, fontFamily: UI, fontWeight: 600, fontSize: size, color, textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.25, padding: '0 80px' }}>
      {text}
    </div>
  );
};

const Stat = ({ value, label, lang }: { value: number; label: string; lang: Lang }) => {
  const frame = useCurrentFrame();
  const n = interpolate(frame, [0, 40], [0, value], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 30 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 190, color: INK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>{fmt(lang, n)}</div>
      <Lines text={label} size={52} color={MUTE} delay={10} />
    </AbsoluteFill>
  );
};

/** Two bars out of 100%: the signals against a coin toss. The coin wins, and the bar shows it. */
const Compare = ({ title, a, b }: Extract<Beat, { kind: 'compare' }>) => {
  const frame = useCurrentFrame();
  const grow = (delay: number) => interpolate(frame, [delay, delay + 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const bar = (label: string, value: number, color: string, delay: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: 340 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 110, color, fontVariantNumeric: 'tabular-nums' }}>{Math.round(value * grow(delay))}%</div>
      <div style={{ width: 200, height: 700, background: '#15161a', borderRadius: 18, display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: `${value * grow(delay)}%`, background: color, borderRadius: 18 }} />
      </div>
      <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 46, color: INK }}>{label}</div>
    </div>
  );
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 230, gap: 60 }}>
      <Lines text={title} size={54} />
      <div style={{ display: 'flex', gap: 80 }}>
        {bar(a.label, a.value, DOWN, 12)}
        {bar(b.label, b.value, MUTE, 24)}
      </div>
    </AbsoluteFill>
  );
};

/** An average with its 95% interval on an axis from −0.6% to +0.6%; zero is the line that matters. */
const Range = ({ title, value, low, high, verdict }: Extract<Beat, { kind: 'range' }>) => {
  const frame = useCurrentFrame();
  const width = 880;
  const x = (v: number) => ((v + 0.6) / 1.2) * width;
  const open = interpolate(frame, [10, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const lo = value + (low - value) * open;
  const hi = value + (high - value) * open;
  const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 300, gap: 90 }}>
      <Lines text={title} size={56} />
      <div style={{ position: 'relative', width, height: 220 }}>
        <div style={{ position: 'absolute', top: 108, left: 0, right: 0, height: 4, background: '#2c2e34' }} />
        <div style={{ position: 'absolute', top: 30, bottom: 0, left: x(0) - 3, width: 6, background: INK }} />
        <div style={{ position: 'absolute', top: 0, left: x(0) - 20, fontFamily: UI, fontSize: 34, color: INK }}>0</div>
        <div style={{ position: 'absolute', top: 90, left: x(lo), width: x(hi) - x(lo), height: 40, background: 'rgba(246, 70, 93, .35)', borderRadius: 20 }} />
        <div style={{ position: 'absolute', top: 92, left: x(value) - 18, width: 36, height: 36, borderRadius: 18, background: DOWN }} />
        <div style={{ position: 'absolute', top: 160, left: x(value) - 100, width: 200, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 44, color: INK }}>{pct(value)}</div>
      </div>
      <Lines text={verdict} size={58} delay={40} />
    </AbsoluteFill>
  );
};

/** The same test on the first and the second half of the data, side by side. */
const Halves = ({ title, first, second }: Extract<Beat, { kind: 'halves' }>) => {
  const side = (h: Extract<Beat, { kind: 'halves' }>['first'], delay: number) => {
    const style = useEnter(delay);
    return (
      <div style={{ ...style, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: '40px 20px', borderRadius: 30, background: '#111216', border: `3px solid ${h.ok ? UP : DOWN}` }}>
        <div style={{ fontSize: 120 }}>{h.ok ? '✅' : '❌'}</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 84, color: INK, fontVariantNumeric: 'tabular-nums' }}>{h.value}</div>
        <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 40, color: MUTE, textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.25 }}>{h.note}</div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 300, gap: 70 }}>
      <Lines text={title} size={58} />
      <div style={{ display: 'flex', gap: 40, width: 940 }}>
        {side(first, 10)}
        {side(second, 34)}
      </div>
    </AbsoluteFill>
  );
};

/** What the move made against what the trade costs, and the sum. */
const Versus = ({ a, b, result }: Extract<Beat, { kind: 'versus' }>) => {
  const row = (label: string, value: string, color: string, delay: number) => {
    const style = useEnter(delay);
    return (
      <div style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 130, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 46, color: MUTE }}>{label}</div>
      </div>
    );
  };
  const sum = useEnter(50);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 50 }}>
      {row(a.label, a.value, UP, 0)}
      {row(b.label, b.value, DOWN, 22)}
      <div style={{ ...sum, width: 700, height: 6, background: INK }} />
      <div style={{ ...sum, fontFamily: DISPLAY, fontWeight: 800, fontSize: 170, color: INK }}>{result}</div>
    </AbsoluteFill>
  );
};

const BeatView = ({ beat, seed, lang }: { beat: Beat; seed: string; lang: Lang }) => {
  switch (beat.kind) {
    case 'title':
      return (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Slam size={beat.text.length > 40 ? 76 : 92} seed={seed}>
            {beat.text}
          </Slam>
        </AbsoluteFill>
      );
    case 'text':
      return (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Lines text={beat.text} size={68} />
        </AbsoluteFill>
      );
    case 'stat':
      return <Stat value={beat.value} label={beat.label} lang={lang} />;
    case 'compare':
      return <Compare {...beat} />;
    case 'range':
      return <Range {...beat} />;
    case 'halves':
      return <Halves {...beat} />;
    case 'versus':
      return <Versus {...beat} />;
    case 'outro':
      return <Outro lang={lang} line={beat.line} />;
  }
};

/** One episode of the series: beats cut hard one after another, the part number always on screen. */
export const SeriesVideo = ({ episode, part, lang }: SeriesVideoProps) => {
  const label = lang === 'ru' ? `Часть ${part}/${PARTS}` : `Part ${part}/${PARTS}`;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Series>
        {episode.beats.map((beat, i) => (
          <Series.Sequence key={i} durationInFrames={beatFrames(beat)}>
            <BeatView beat={beat} seed={`${episode.slug}${i}`} lang={lang} />
            {beat.kind === 'title' ? <Flash at={0} /> : null}
          </Series.Sequence>
        ))}
      </Series>
      <div style={{ position: 'absolute', top: 110, left: 70, right: 70, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 40, color: MUTE }}>{label}</span>
        <Brand size={36} color={MUTE} />
      </div>
    </AbsoluteFill>
  );
};
