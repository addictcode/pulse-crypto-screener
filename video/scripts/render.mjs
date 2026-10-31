// Renders the videos: the confirmed events in public/events.json, each told several ways, to
// out/pulse-001.mp4, pulse-002.mp4, ... with out/captions.txt holding a post description for each.
// Videos are numbered, not named after a coin: they are posted later, in any order.
//   node scripts/render.mjs                  every event in every telling, at most 100 videos
//   node scripts/render.mjs --max 20         the first 20 of that list
//   node scripts/render.mjs --tellings 2     only the first two tellings of each event
//   node scripts/render.mjs --stills         three PNG frames per video instead, to check the look
//   node scripts/render.mjs --from 41        resume numbering (and skip what is done) after a stop
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

import { TELLINGS, story } from '../src/story.ts';

const { values } = parseArgs({
  options: {
    max: { type: 'string', default: '100' },
    tellings: { type: 'string', default: String(TELLINGS) },
    from: { type: 'string', default: '1' },
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

const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));

// every event in the first telling, then every event in the second, ...: neighbouring videos
// never show the same chart
const jobs = [];
for (let round = 0; round < Number(values.tellings); round++) {
  // shifted by the event's place too, so neighbours in a round are told differently
  events.forEach((event, i) => jobs.push({ event, variant: (round + i) % TELLINGS }));
}
jobs.splice(Number(values.max));

const out = new URL('../out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const TAGS = '#крипта #трейдинг #фьючерсы #биткоин #криптовалюта #binance #альткоины';
writeFileSync(
  `${out}captions.txt`,
  jobs
    .map(({ event, variant }, i) => {
      const s = story(event, variant);
      return `pulse-${String(i + 1).padStart(3, '0')}.mp4\n${s.caption}. Реальный график, реальные цифры. Не финансовый совет.\n${TAGS}\n`;
    })
    .join('\n'),
);

const serveUrl = await bundle({ entryPoint: new URL('../src/index.ts', import.meta.url).pathname });

for (const [i, { event, variant }] of jobs.entries()) {
  const number = i + 1;
  const name = `pulse-${String(number).padStart(3, '0')}`;
  if (number < Number(values.from) || (!values.stills && existsSync(`${out}${name}.mp4`))) continue;
  const inputProps = { event, variant };
  const composition = await selectComposition({ serveUrl, id: 'Event', inputProps, ...browser });
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
  console.log(`video ${name}.mp4 (${number}/${jobs.length})`);
}
