// Renders the videos to out/pulse-001.mp4, pulse-002.mp4, ... with out/captions.txt holding a post
// description for each. Videos are numbered, not named after a coin: they are posted later, in
// any order. The templates take turns from number 1 on, so a feed never shows the same format
// twice in a row and any first N videos show every format. Finished files are skipped, so a
// stopped render picks up where it left off; out/manifest.json remembers which video each file
// holds, and a file whose number now means another video (new events shift the plan) is
// rendered again instead of skipped.
//   node scripts/render.mjs                       everything not rendered yet
//   node scripts/render.mjs --template guess,top3 only these templates (event, guess, top3, counter)
//   node scripts/render.mjs --max 120             only numbers up to 120
//   node scripts/render.mjs --stills              three PNG frames per video instead, to check the look
//   node scripts/render.mjs --per-template 1      only the first video of each template (CI)
//   node scripts/render.mjs --lang en             the English set, to out/en/ (the same numbers and events)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

import { TELLINGS, story } from '../src/story.ts';
import { LANGS, TEXT } from '../src/text.ts';

const { values } = parseArgs({
  options: {
    template: { type: 'string', default: 'event,guess,top3,counter' },
    max: { type: 'string', default: '1000' },
    only: { type: 'string' },
    out: { type: 'string' },
    force: { type: 'boolean', default: false },
    stills: { type: 'boolean', default: false },
    lang: { type: 'string', default: 'ru' },
    'per-template': { type: 'string' },
  },
});
const lang = values.lang;
if (!LANGS.includes(lang)) throw new Error(`--lang is one of ${LANGS.join(', ')}`);
const text = TEXT[lang];

// Remotion's own browser download is blocked on this network; Chrome is on the Mac anyway.
// Current Chrome has no old headless mode, hence the chrome-for-testing mode.
const browser = {
  browserExecutable: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromeMode: 'chrome-for-testing',
  logLevel: process.env.LOG ?? 'info',
};

const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));

/** A fixed shuffle, so the groups of three are the same on every run. */
function shuffled(list, seed) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// the meme template: every event in the first telling, then the second, ... shifted by the event's
// place, so neighbours are told differently
const memes = [];
for (let round = 0; round < TELLINGS; round++) {
  events.forEach((event, i) => {
    const variant = (round + i) % TELLINGS;
    memes.push({ template: 'event', id: 'Event', props: { event, variant, lang }, caption: story(event, variant, lang).caption });
  });
}
memes.splice(100);

// one "guess" per event with a clear answer, one "counter" per event, and groups of three
const guesses = events
  .filter((event) => Math.abs(story(event, 0).hour) >= 1)
  .map((event, i) => ({ template: 'guess', id: 'Guess', props: { event, variant: i % 5, lang }, caption: text.guess.captions[i % 5] }));
const counters = events.map((event, i) => ({ template: 'counter', id: 'Counter', props: { event, variant: (i + 2) % 5, lang }, caption: text.counter.captions[i % 5] }));
const tops = [];
for (const seed of [7, 11]) {
  const order = shuffled(events, seed);
  for (let i = 0; i + 3 <= order.length; i += 3) {
    const n = tops.length;
    tops.push({ template: 'top3', id: 'Top3', props: { events: order.slice(i, i + 3), variant: n % 5, lang }, caption: text.top3.captions[n % 5] });
  }
}
/** The lists in turns, one of each per round, until all are used up. */
function turns(lists) {
  const out = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}
const jobs = turns([memes, guesses, counters, tops]);
/** What a file holds: the template, its events, the telling and the language. */
const key = (job) => [job.template, ...(job.props.events ?? [job.props.event]).map((e) => e.id), job.props.variant, lang].join(':');

// Russian in out/ as before, other languages each in their own folder
const out = values.out ? `${values.out.replace(/\/$/, '')}/` : new URL(lang === 'ru' ? '../out/' : `../out/${lang}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const name = (i) => `pulse-${String(i + 1).padStart(3, '0')}`;
const manifestFile = `${out}manifest.json`;
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile)) : {};
writeFileSync(`${out}captions.txt`, jobs.map((job, i) => `${name(i)}.mp4\n${job.caption}. ${text.note}\n${text.tags}\n`).join('\n'));

const wanted = new Set(values.template.split(','));
const todo = jobs
  .map((job, i) => ({ ...job, file: name(i), number: i + 1 }))
  .filter((job) => wanted.has(job.template) && job.number <= Number(values.max))
  .filter((job) => !values.only || values.only.split(',').map(Number).includes(job.number))
  .filter((job, _, all) => !values['per-template'] || all.filter((j) => j.template === job.template).indexOf(job) < Number(values['per-template']))
  .filter((job) => values.stills || values.force || !existsSync(`${out}${job.file}.mp4`) || manifest[job.file] !== key(job));
console.log(`${jobs.length} videos in the plan, ${todo.length} to render now`);

const serveUrl = await bundle({ entryPoint: new URL('../src/index.ts', import.meta.url).pathname });

for (const [k, job] of todo.entries()) {
  const composition = await selectComposition({ serveUrl, id: job.id, inputProps: job.props, ...browser });
  if (values.stills) {
    for (const frame of [20, Math.round(composition.durationInFrames * 0.45), Math.round(composition.durationInFrames * 0.7)]) {
      await renderStill({ serveUrl, composition, inputProps: job.props, frame, output: `${out}${job.file}-f${frame}.png`, ...browser });
    }
    console.log(`stills ${job.file} (${job.template})`);
    continue;
  }
  // Chrome now and then hands over a frame of the wrong size, which shows as the screen tiled for
  // one frame. One tab at a time stopped it in every test; each video is still checked, and
  // rendered again if a broken frame got through.
  for (let attempt = 1; ; attempt++) {
    await renderMedia({
      serveUrl,
      composition,
      inputProps: job.props,
      codec: 'h264',
      crf: 18,
      outputLocation: `${out}${job.file}.mp4`,
      concurrency: Number(process.env.CONCURRENCY ?? 1),
      ...browser,
    });
    const check = spawnSync('python3', [new URL('./check.py', import.meta.url).pathname, `${out}${job.file}.mp4`], { encoding: 'utf8' });
    if (check.status === 0) break;
    if (attempt === 3) {
      console.error(`${job.file}.mp4 still has broken frames after ${attempt} tries: ${check.stdout.trim()}`);
      process.exitCode = 1;
      break;
    }
    console.warn(`${job.file}.mp4 had broken frames, rendering it again`);
  }
  manifest[job.file] = key(job);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  console.log(`video ${job.file}.mp4, ${job.template} (${k + 1}/${todo.length})`);
}
