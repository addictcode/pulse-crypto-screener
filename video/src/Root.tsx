import { Composition } from 'remotion';

import './fonts';
import { DURATION, EventVideo, type EventVideoProps } from './EventVideo';
import events from '../public/events.json';
import type { MarketEvent } from './story';

/** One composition; the render script passes each event and caption variant as props. */
export const RemotionRoot = () => (
  <Composition
    id="Event"
    component={EventVideo}
    durationInFrames={DURATION}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ event: (events as MarketEvent[])[0], variant: 0 } satisfies EventVideoProps}
  />
);
