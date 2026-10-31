// Renders the videos: every confirmed event in public/events.json, each in the caption variants
// asked for, to out/<event>-v<variant>.mp4.
//   node scripts/render.mjs                 every event, variant 0
//   node scripts/render.mjs --variants 3    every event in three tellings
//   node scripts/render.mjs --only zil,t    just these events
//   node scripts/render.mjs --stills        a few frames per video as PNG, to check the look fast
import { mkdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const { values } = parseArgs({
  options: {
    variants: { type: 'string', default: '1' },
    only: { type: 'string' },
    limit: { type: 'string' },
    stills: { type: 'boolean', default: false },
  },
});

// Remotion's own browser download is blocked on this network; Chrome is on the Mac anyway.
// Current Chrome has no old headless mode, hence the chrome-for-testing mode.
const browser = {
  browserExecutable: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromeMode: 'chrome-for-testing',
  logLevel: process.env.LOG ?? 'info',
};

let events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));
if (values.only) {
  const wanted = values.only.split(',');
  events = events.filter((e) => wanted.some((w) => e.id.startsWith(w)));
}
if (values.limit) events = events.slice(0, Number(values.limit));

const out = new URL('../out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: new URL('../src/index.ts', import.meta.url).pathname });

for (const [index, event] of events.entries()) {
  for (let v = 0; v < Number(values.variants); v++) {
    // neighbouring videos start from different captions, so a batch does not repeat itself
    const variant = (index + v) % 3;
    const inputProps = { event, variant };
    const composition = await selectComposition({ serveUrl, id: 'Event', inputProps, ...browser });
    const name = `${event.id}-v${variant}`;
    if (values.stills) {
      // the hook, the hit on the signal candle, the punchline
      for (const frame of [20, 130, 190]) {
        await renderStill({ serveUrl, composition, inputProps, frame, output: `${out}${name}-f${frame}.png`, ...browser });
      }
      console.log(`stills ${name}`);
      continue;
    }
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: 'h264',
      crf: 18,
      outputLocation: `${out}${name}.mp4`,
      // more tabs at once ran the Mac out of memory and Chrome returned a broken frame now and then
      concurrency: Number(process.env.CONCURRENCY ?? 2),
      ...browser,
    });
    console.log(`video ${name}.mp4`);
  }
}
