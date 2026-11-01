// A video takes off: 500 people arrive within one minute (ARRIVALS, default 500), each opens the
// landing page and watches the stream for 45 s; every fifth goes on to the terminal.
//   docker run --rm -i --network pulse-load_default -v "$PWD/loadtest:/t" grafana/k6:0.57.0 run /t/burst.js
import { sleep } from 'k6';

import { address, landing, terminal } from './common.js';

const ARRIVALS = Number(__ENV.ARRIVALS || 500);
const STAY = Number(__ENV.STAY || 45);

export const options = {
  scenarios: {
    burst: {
      executor: 'shared-iterations',
      vus: ARRIVALS,
      iterations: ARRIVALS,
      maxDuration: `${STAY + 120}s`,
    },
  },
  thresholds: {
    stream_refused: ['rate<0.01'],
    stream_first_message_ms: ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

// spread the arrivals over a minute instead of one instant
export default function () {
  const ip = address();
  const wait = (__VU * 60) / ARRIVALS;
  sleep(wait);
  if (__VU % 5 === 0) terminal(ip, STAY);
  else landing(ip, STAY);
}
