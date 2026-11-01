// N visitors at once: 70% on the landing page, 30% in the terminal, each staying a while with the
// stream open, then leaving and another coming. Ramps up to VUS (default 300) and holds.
//   docker run --rm -i --network pulse-load_default -v "$PWD/loadtest:/t" grafana/k6:0.57.0 run -e VUS=300 /t/visitors.js
import { address, landing, terminal } from './common.js';

const VUS = Number(__ENV.VUS || 300);
const STAY = Number(__ENV.STAY || 60);

export const options = {
  scenarios: {
    visitors: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: VUS },
        { duration: __ENV.HOLD || '3m', target: VUS },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: `${STAY + 10}s`,
    },
  },
  thresholds: {
    'http_req_duration{name:/api/candles}': ['p(95)<1500'],
    stream_refused: ['rate<0.01'],
    stream_first_message_ms: ['p(95)<3000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const ip = address();
  if (__VU % 10 < 7) landing(ip, STAY);
  else terminal(ip, STAY);
}
