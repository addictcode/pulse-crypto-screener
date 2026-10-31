import { Composition } from 'remotion';

import './fonts';
import { COUNTER_DURATION, CounterVideo, type CounterVideoProps } from './CounterVideo';
import { DURATION, EventVideo, type EventVideoProps } from './EventVideo';
import { GUESS_DURATION, GuessVideo, type GuessVideoProps } from './GuessVideo';
import { TOP3_DURATION, Top3Video, type Top3VideoProps } from './Top3Video';
import events from '../public/events.json';
import type { MarketEvent } from './story';

const all = events as MarketEvent[];
const vertical = { fps: 30, width: 1080, height: 1920 } as const;

/** One composition per template; the render script passes the events and the telling as props. */
export const RemotionRoot = () => (
  <>
    <Composition id="Event" component={EventVideo} durationInFrames={DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0 } satisfies EventVideoProps} />
    <Composition id="Guess" component={GuessVideo} durationInFrames={GUESS_DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0 } satisfies GuessVideoProps} />
    <Composition id="Top3" component={Top3Video} durationInFrames={TOP3_DURATION} {...vertical} defaultProps={{ events: all.slice(0, 3), variant: 0 } satisfies Top3VideoProps} />
    <Composition id="Counter" component={CounterVideo} durationInFrames={COUNTER_DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0 } satisfies CounterVideoProps} />
  </>
);
