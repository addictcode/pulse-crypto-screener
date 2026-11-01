import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Chart } from './Chart';
import { DISPLAY, DOWN, Flash, Outro, PAPER, PAPER_INK, PAPER_MUTE, Slam, UI, UP, shake } from './parts';
import { type Lang, type MarketEvent, pct } from './story';
import { TEXT } from './text.ts';

export type Top3VideoProps = { events: MarketEvent[]; variant: number; lang: Lang };

/**
 * A countdown of three real moves, the biggest last. Light paper instead of the dark terminal, so
 * in a feed of Pulse videos this one reads as something else.
 */
export const TOP3 = { hook: 36, rank: 66, outro: 40 };
export const TOP3_DURATION = TOP3.hook + 3 * TOP3.rank + TOP3.outro;

export const TOP3_TELLINGS = 5;

const Rank = ({ event, place, lang }: { event: MarketEvent; place: number; lang: Lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // the place number fills the screen for a beat, then the chart takes over
  const showChart = frame >= 14;
  const reach = interpolate(frame, [14, 40], [event.at - 22, event.at + 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  const hit = frame - 40;
  const stamp = spring({ frame: hit, fps, config: { damping: 10, stiffness: 240 } });
  const { x, y } = hit >= 0 ? shake(hit, `${event.id}t3`, 30) : { x: 0, y: 0 };
  const up = event.type === 'PUMP';
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {!showChart ? (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Slam size={420} color={PAPER_INK} seed={`${event.id}n${place}`}>
            {`#${place}`}
          </Slam>
        </AbsoluteFill>
      ) : (
        <>
          <div style={{ position: 'absolute', top: 130, left: 70, right: 70, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 120, color: PAPER_INK }}>#{place}</span>
            <span style={{ fontFamily: UI, fontWeight: 600, fontSize: 40, color: PAPER_MUTE }}>{TEXT[lang].chartLabel}</span>
          </div>
          <div style={{ position: 'absolute', top: 360, left: 20, transform: `translate(${x}px, ${y}px)` }}>
            <Chart candles={event.candles.slice(0, event.at + 6)} shown={reach} width={1040} height={900} rangeTo={event.at + 1} mark={null} grid="#dddcd6" />
          </div>
          {hit >= 0 ? (
            <div style={{ position: 'absolute', top: 1290, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp})` }}>
              <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 180, color: up ? UP : DOWN }}>{pct(event.move)}</span>
              <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 50, color: PAPER_INK }}>{TEXT[lang].in5}</div>
            </div>
          ) : null}
        </>
      )}
      <Flash at={0} color="#000" />
    </AbsoluteFill>
  );
};

export const Top3Video = ({ events, variant, lang }: Top3VideoProps) => {
  const text = TEXT[lang];
  // the countdown ends on the biggest move
  const ranked = [...events].sort((a, b) => Math.abs(a.move) - Math.abs(b.move));
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <Series>
        <Series.Sequence durationInFrames={TOP3.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={96} color={PAPER_INK} seed={`t3h${variant}`}>
              {text.top3.hooks[variant % text.top3.hooks.length]}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        {ranked.map((event, i) => (
          <Series.Sequence key={event.id} durationInFrames={TOP3.rank}>
            <Rank event={event} place={3 - i} lang={lang} />
          </Series.Sequence>
        ))}
        <Series.Sequence durationInFrames={TOP3.outro}>
          <Outro lang={lang} light line={text.outro.top3} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
