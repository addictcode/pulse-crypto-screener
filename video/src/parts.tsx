import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame } from 'remotion';

/** The pieces every template is cut from: Pulse's colours and type, the slam, the flash, the end card. */

export const BG = '#070708';
export const INK = '#e9eaec';
export const MUTE = '#8b8e96';
export const UP = '#2ebd85';
export const DOWN = '#f6465d';
/** The light theme, for templates that should not look like the rest of the feed. */
export const PAPER = '#f1f0ec';
export const PAPER_INK = '#0b0b0d';
export const PAPER_MUTE = '#6b6d73';
export const DISPLAY = 'Unbounded, sans-serif';
export const UI = 'Onest, sans-serif';

/** A few frames of decaying jitter, for impacts. */
export function shake(frame: number, seed: string, strength = 26) {
  const decay = Math.max(0, 1 - frame / 9);
  return {
    x: (random(`${seed}x${frame}`) - 0.5) * strength * decay,
    y: (random(`${seed}y${frame}`) - 0.5) * strength * decay,
  };
}

/** Text that slams in: starts large and lands in four frames. */
export const Slam = ({ children, size, color = INK, seed }: { children: string; size: number; color?: string; seed: string }) => {
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

/** Two bright frames: the cut the eye feels. */
export const Flash = ({ at, color = '#fff' }: { at: number; color?: string }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [at, at + 1, at + 3], [0, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: color, opacity: o }} />;
};

export const Brand = ({ size = 40, color = INK }: { size?: number; color?: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.35, fontFamily: UI, fontWeight: 600, fontSize: size, color }}>
    <svg width={size * 1.2} height={size * 1.2} viewBox="0 0 24 24">
      <path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M12 12 21 7M12 12v10M12 12 3 7" fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.55} />
    </svg>
    Pulse
  </div>
);

/** The end card. The disclaimer sits above TikTok's caption, which covers the bottom of the screen. */
export const Outro = ({ light = false, line = 'ссылка в профиле' }: { light?: boolean; line?: string }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  const ink = light ? PAPER_INK : INK;
  const mute = light ? PAPER_MUTE : MUTE;
  return (
    <AbsoluteFill style={{ background: light ? PAPER : BG, justifyContent: 'center', alignItems: 'center', gap: 34, opacity: o }}>
      <Brand size={96} color={ink} />
      <div style={{ fontFamily: UI, fontSize: 50, color: ink, textAlign: 'center', lineHeight: 1.3 }}>
        радар всего рынка фьючерсов
        <br />
        <span style={{ color: mute }}>{line}</span>
      </div>
      <div style={{ position: 'absolute', bottom: 380, fontFamily: UI, fontSize: 30, color: mute }}>
        Реальные данные Binance. Не финансовый совет.
      </div>
    </AbsoluteFill>
  );
};

export const fmtPrice = (price: number) => Number(price.toPrecision(5));
export const abs = (v: number) => `${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;
