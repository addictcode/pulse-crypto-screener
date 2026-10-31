import { Composition } from 'remotion';

import './fonts';
import { COUNTER_DURATION, CounterVideo, type CounterVideoProps } from './CounterVideo';
import { DURATION, EventVideo, type EventVideoProps } from './EventVideo';
import { GUESS_DURATION, GuessVideo, type GuessVideoProps } from './GuessVideo';
import { VOLUME_DURATION, VolumeVideo, type VolumeVideoProps } from './VolumeVideo';
import { SPLIT_DURATION, SplitVideo, type SplitVideoProps } from './SplitVideo';
import { TIMELAPSE_DURATION, TimelapseVideo, type TimelapseVideoProps } from './TimelapseVideo';
import { TOP3_DURATION, Top3Video, type Top3VideoProps } from './Top3Video';
import days from '../public/days.json';
import events from '../public/events.json';
import type { MarketEvent } from './story';

const all = events as MarketEvent[];
const withDay = all.find((e) => e.id in days) ?? all[0];
const vertical = { fps: 30, width: 1080, height: 1920 } as const;

/** One composition per template; the render script passes the events and the telling as props. */
export const RemotionRoot = () => (
  <>
    <Composition id="Event" component={EventVideo} durationInFrames={DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0, lang: 'ru' } satisfies EventVideoProps} />
    <Composition id="Guess" component={GuessVideo} durationInFrames={GUESS_DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0, lang: 'ru' } satisfies GuessVideoProps} />
    <Composition id="Top3" component={Top3Video} durationInFrames={TOP3_DURATION} {...vertical} defaultProps={{ events: all.slice(0, 3), variant: 0, lang: 'ru' } satisfies Top3VideoProps} />
    <Composition id="Timelapse" component={TimelapseVideo} durationInFrames={TIMELAPSE_DURATION} {...vertical} defaultProps={{ event: withDay, day: (days as Record<string, TimelapseVideoProps['day']>)[withDay.id], variant: 0, lang: 'ru' } satisfies TimelapseVideoProps} />
    <Composition id="Split" component={SplitVideo} durationInFrames={SPLIT_DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0, lang: 'ru' } satisfies SplitVideoProps} />
    <Composition id="Volume" component={VolumeVideo} durationInFrames={VOLUME_DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0, lang: 'ru' } satisfies VolumeVideoProps} />
    <Composition id="Counter" component={CounterVideo} durationInFrames={COUNTER_DURATION} {...vertical} defaultProps={{ event: all[0], variant: 0, lang: 'ru' } satisfies CounterVideoProps} />
  </>
);
