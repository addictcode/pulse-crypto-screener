// What one visitor does, shared by the scenarios. A visitor is one address: the stack limits per
// address (pulse.limits), so each virtual user claims its own through X-Forwarded-For, which Caddy
// believes only from private neighbours such as the k6 container on the same Docker network.
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const BASE = __ENV.BASE || 'http://web';
const WS_BASE = BASE.replace(/^http/, 'ws');
const ORIGIN = __ENV.ORIGIN || 'http://localhost:8088';

export const streamBytes = new Counter('stream_bytes');
export const streamFirstMessage = new Trend('stream_first_message_ms', true);
export const streamRefused = new Rate('stream_refused');
export const apiLimited = new Rate('api_rate_limited');

/** A made-up public address per virtual user and iteration: 10.x.y.z would be "private", so 100.64/10 is not used either. */
export function address() {
  const n = __VU * 1000 + (__ITER % 1000);
  return `198.${18 + (n >> 16) % 2}.${(n >> 8) & 255}.${n & 255}`;
}

function params(ip, tag) {
  return { headers: { 'X-Forwarded-For': ip, Origin: ORIGIN }, tags: { name: tag } };
}

export function get(ip, path, tag) {
  const res = http.get(`${BASE}${path}`, params(ip, tag || path.split('?')[0]));
  apiLimited.add(res.status === 429);
  check(res, { [`${tag || path.split('?')[0]} ok`]: (r) => r.status === 200 });
  return res;
}

/** The page and the scripts and styles it links, as a browser with an empty cache would. */
export function page(ip, path) {
  const res = get(ip, path, `page ${path}`);
  const assets = [...new Set((res.body || '').match(/\/assets\/[^"' )]+/g) || [])];
  if (assets.length) {
    http.batch(assets.map((a) => ['GET', `${BASE}${a}`, null, params(ip, 'asset')]));
  }
}

/** Holds the market stream open for `seconds`, counting what arrives. */
export function stream(ip, seconds) {
  const started = Date.now();
  let first = true;
  let refused = false;
  const res = ws.connect(`${WS_BASE}/ws/market`, params(ip, 'stream'), (socket) => {
    socket.on('message', (data) => {
      if (first) {
        streamFirstMessage.add(Date.now() - started);
        first = false;
      }
      streamBytes.add(data.length);
    });
    socket.on('close', (code) => {
      if (first) refused = true;
    });
    socket.setTimeout(() => socket.close(), seconds * 1000);
  });
  streamRefused.add(refused || !res || res.status !== 101);
}

export const summaryBytes = new Counter('summary_bytes');

/**
 * The landing page: setups and links, a counted visit, then the live numbers from a poll of
 * /api/summary every 5 seconds while it stays (web/src/api.ts, startSummary), not the stream.
 */
export function landing(ip, seconds) {
  page(ip, '/');
  get(ip, '/api/links');
  get(ip, '/api/setups');
  http.post(`${BASE}/api/hit`, JSON.stringify({ page: 'landing', source: 'tiktok' }),
    { headers: { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }, tags: { name: '/api/hit' } });
  const until = Date.now() + seconds * 1000;
  do {
    // as a browser asks: compressed, so the bytes counted are the ones on the wire
    const asked = params(ip, '/api/summary');
    const res = http.get(`${BASE}/api/summary`, { ...asked, headers: { ...asked.headers, 'Accept-Encoding': 'gzip' } });
    apiLimited.add(res.status === 429);
    check(res, { '/api/summary ok': (r) => r.status === 200 });
    // compressed bytes as sent; a chunked answer has no length, and the body k6 hands over is
    // already decompressed, so it is left to the built-in data_received rather than overstated
    const sent = Number(res.headers['Content-Length']);
    if (sent > 0) summaryBytes.add(sent);
    sleep(5);
  } while (Date.now() < until);
}

/** The terminal: the stream plus the dozen calls of a first load (chart, positioning, signals, ...). */
export function terminal(ip, seconds) {
  page(ip, '/app/');
  const symbol = `FAKE00${__VU % 10}USDT`;
  get(ip, `/api/candles?symbol=${symbol}&interval=15m&limit=1000`, '/api/candles');
  get(ip, `/api/positioning?symbol=${symbol}&period=15m&limit=500`, '/api/positioning');
  get(ip, '/api/compare');
  get(ip, '/api/signals?limit=100', '/api/signals');
  get(ip, '/api/signals/stats?days=7', '/api/signals/stats');
  get(ip, '/api/setups');
  get(ip, '/api/links');
  stream(ip, seconds);
}

export { sleep };
