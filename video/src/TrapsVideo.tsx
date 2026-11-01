import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { Chart } from './Chart';
import { DISPLAY, DOWN, Flash, INK, Outro, Slam, UI, UP, shake } from './parts';
import { type Lang, type MarketEvent, pct, story } from './story';
import { Cues, cuts } from './sfx';
import { TEXT } from './text.ts';

export type TrapsVideoProps = { events: MarketEvent[]; variant: number; lang: Lang; sfx?: boolean };

/**
 * "A series of traps": three moves in a row that broke out and came back within the hour, each in
 * a few seconds: the breakout, then the way back. Caution tape and amber, so it reads as a warning.
 */
export const TRAPS = { hook: 40, trap: 84, end: 48, outro: 40 };
export const TRAPS_DURATION = TRAPS.hook + 3 * TRAPS.trap + TRAPS.end + TRAPS.outro;

const BG = '#0d0b07';
const AMBER = '#ffb020';
const HIT = 30;
const BACK = 44;

const Tape = ({ top, offset }: { top: number; offset: number }) => (
  <div
    style={{
      position: 'absolute',
      top,
      left: -40,
      right: -40,
      height: 46,
      background: `repeating-linear-gradient(-45deg, ${AMBER} 0 34px, #111 34px 68px)`,
      backgroundPosition: `${offset}px 0`,
      opacity: 0.9,
    }}
  />
);

const Trap = ({ event, n, lang }: { event: MarketEvent; n: number; lang: Lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = TEXT[lang].traps;
  const s = story(event, 0, lang);
  const reach = interpolate(frame, [0, HIT, BACK, BACK + 30], [event.at - 25, event.at + 1, event.at + 1, event.at + 61], {
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });
  const stamp = spring({ frame: frame - HIT, fps, config: { damping: 11, stiffness: 230 } });
  const back = spring({ frame: frame - BACK - 14, fps, config: { damping: 12, stiffness: 200 } });
  const { x, y } = frame >= BACK + 14 ? shake(frame - BACK - 14, `${event.id}tr${n}`, 30) : { x: 0, y: 0 };
  const up = event.type === 'PUMP';
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Tape top={90} offset={frame * 3} />
      <div style={{ position: 'absolute', top: 180, left: 0, right: 0, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 76, color: AMBER, textTransform: 'uppercase' }}>{text.label(n)}</div>
      <div style={{ position: 'absolute', top: 360, left: 20, transform: `translate(${x}px, ${y}px)` }}>
        <Chart candles={event.candles.slice(0, event.at + 61)} shown={reach} width={1040} height={820} rangeTo={event.at + 61} mark={frame >= BACK ? event.at : null} grid="#1d1a12" />
      </div>
      {frame >= HIT && frame < BACK + 14 ? (
        <div style={{ position: 'absolute', top: 1220, left: 0, right: 0, textAlign: 'center', transform: `scale(${stamp})` }}>
          <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 56, color: INK }}>{text.breakout(up)}</div>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 140, color: up ? UP : DOWN }}>{pct(event.move)}</span>
        </div>
      ) : null}
      {frame >= BACK + 14 ? (
        <div style={{ position: 'absolute', top: 1220, left: 0, right: 0, textAlign: 'center', transform: `scale(${back})` }}>
          <Slam size={78} color={up ? DOWN : UP} seed={`${event.id}trb`}>
            {text.back(s.hour)}
          </Slam>
        </div>
      ) : null}
      <Tape top={1540} offset={-frame * 3} />
      <Flash at={0} color={AMBER} />
    </AbsoluteFill>
  );
};

export const TrapsVideo = ({ events, variant, lang, sfx }: TrapsVideoProps) => {
  const text = TEXT[lang].traps;
  const cues = [
    ...cuts([TRAPS.hook, TRAPS.trap, TRAPS.trap, TRAPS.trap, TRAPS.end, TRAPS.outro]),
    ...[0, 1, 2].flatMap((k) => [
      { at: TRAPS.hook + k * TRAPS.trap + HIT, kind: 'click' as const },
      { at: TRAPS.hook + k * TRAPS.trap + BACK + 14, kind: 'hit' as const },
    ]),
  ];
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Cues on={sfx} list={cues} />
      <Series>
        <Series.Sequence durationInFrames={TRAPS.hook}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Tape top={560} offset={0} />
            <Slam size={84} seed={`trh${variant}${events[0].id}`}>
              {text.hooks[variant % text.hooks.length]}
            </Slam>
            <Tape top={1320} offset={30} />
          </AbsoluteFill>
        </Series.Sequence>
        {events.map((event, i) => (
          <Series.Sequence key={event.id} durationInFrames={TRAPS.trap}>
            <Trap event={event} n={i + 1} lang={lang} />
          </Series.Sequence>
        ))}
        <Series.Sequence durationInFrames={TRAPS.end}>
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Slam size={100} color={AMBER} seed={`tre${events[0].id}`}>
              {text.end}
            </Slam>
          </AbsoluteFill>
        </Series.Sequence>
        <Series.Sequence durationInFrames={TRAPS.outro}>
          <Outro lang={lang} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
