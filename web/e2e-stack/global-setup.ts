import { STACK } from './playwright.config';

/**
 * Waits for the stack to serve a market and picks a pair from it: the made-up market calls its
 * pairs FAKE000USDT…, the real one BTCUSDT…, and the walk must not assume either.
 */
export default async function globalSetup() {
  const deadline = Date.now() + 180_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${STACK}/api/summary`);
      if (response.ok) {
        const summary = (await response.json()) as { rows: Array<{ symbol: string }> };
        if (summary.rows.length) {
          process.env.STACK_PAIR = summary.rows[0].symbol;
          return;
        }
        last = 'the summary has no rows yet';
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`the stack at ${STACK} serves no market (${last}); start it with loadtest/run.sh --local-build up`);
}
