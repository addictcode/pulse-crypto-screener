import { expect, test } from '@playwright/test';

// What Caddy adds in front of the app: the host written into the public pages, the security
// headers, what is and is not reachable from outside, compression and the live stream.
test.describe.configure({ mode: 'parallel' });
// desktop only (playwright.config.ts): none of this depends on the screen

for (const path of ['/', '/ru/', '/record/', '/play/', '/sitemap.xml', '/robots.txt']) {
  test(`Caddy filled in the host in ${path}`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body, 'no template left unfilled').not.toContain('{{');
    if (path !== '/play/') expect(body).toMatch(/https?:\/\/[a-z0-9.-]+/);
  });
}

test('the security headers are in place', async ({ request }) => {
  const headers = (await request.get('/')).headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['server'], 'Caddy does not name itself').toBeUndefined();
});

test('the actuator is not reachable from outside', async ({ request }) => {
  for (const path of ['/actuator', '/actuator/health', '/actuator/prometheus', '/api/../actuator/env']) {
    const response = await request.get(path);
    const body = await response.text();
    // Caddy answers unknown paths with the landing page; what matters is that Spring does not answer
    expect(body, `${path} is not the actuator`).not.toMatch(/"status"\s*:|"_links"|jvm_|"propertySources"/);
  }
});

test('the summary is compressed', async ({ request }) => {
  const response = await request.get('/api/summary', { headers: { 'Accept-Encoding': 'gzip, zstd' } });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-encoding']).toMatch(/gzip|zstd/);
});

test('the market stream sends a snapshot first', async ({ page }) => {
  await page.goto('/robots.txt');
  const first = await page.evaluate(
    () =>
      new Promise<{ type: string; rows: number }>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/market`);
        const timer = setTimeout(() => reject(new Error('no message in 15 s')), 15_000);
        ws.onmessage = (e) => {
          clearTimeout(timer);
          const m = JSON.parse(e.data as string) as { type: string; rows?: unknown[] };
          ws.close();
          resolve({ type: m.type, rows: m.rows?.length ?? 0 });
        };
        ws.onerror = () => reject(new Error('the socket failed'));
      }),
  );
  expect(first.type).toBe('snapshot');
  expect(first.rows).toBeGreaterThan(10);
});
