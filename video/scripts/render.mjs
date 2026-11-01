// Renders the videos to out/pulse-001.mp4, pulse-002.mp4, ... with out/captions.txt holding a post
// description for each. Videos are numbered, not named after a coin: they are posted later, in
// any order. The templates take turns from number 1 on, so a feed never shows the same format
// twice in a row and any first N videos show every format. Finished files are skipped, so a
// stopped render picks up where it left off; out/manifest.json remembers which video each file
// holds, and a file whose number now means another video (new events shift the plan) is
// rendered again instead of skipped.
//   node scripts/render.mjs                       everything not rendered yet
//   node scripts/render.mjs --template guess,top3 only these templates (event, guess, top3, counter, timelapse, split, volume, traps, pulse)
//   node scripts/render.mjs --max 120             only numbers up to 120
//   node scripts/render.mjs --stills              three PNG frames per video instead, to check the look
//   node scripts/render.mjs --per-template 1      only the first video of each template (CI)
//   node scripts/render.mjs --shard 2/8          every 8th video from the third on (parallel jobs in CI)
//   node scripts/render.mjs --sfx                with Pulse's own sound effects, to pulse-NNN-sfx.mp4
//   node scripts/render.mjs --lang en             the English set, to out/en/ (the same numbers and events)
//   node scripts/render.mjs --no-covers           without the cover pulse-NNN.jpg next to each video
// Next to captions.txt (TikTok) go captions-reels.txt (Instagram Reels) and captions-shorts.txt
// (YouTube Shorts: a title of at most 100 characters and a description).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

import { LANGS, post, postReels, shorts } from '../src/text.ts';
import { plan } from './plan.mjs';

const { values } = parseArgs({
  options: {
    template: { type: 'string', default: 'event,guess,top3,counter,timelapse,split,volume,traps,pulse' },
    max: { type: 'string', default: '1000' },
    only: { type: 'string' },
    out: { type: 'string' },
    force: { type: 'boolean', default: false },
    stills: { type: 'boolean', default: false },
    lang: { type: 'string', default: 'ru' },
    'per-template': { type: 'string' },
    sfx: { type: 'boolean', default: false },
    shard: { type: 'string' },
    'no-covers': { type: 'boolean', default: false },
  },
});
const lang = values.lang;
if (!LANGS.includes(lang)) throw new Error(`--lang is one of ${LANGS.join(', ')}`);

// Remotion's own browser download is blocked on this network; Chrome is on the Mac anyway.
// Current Chrome has no old headless mode, hence the chrome-for-testing mode.
const browser = {
  browserExecutable: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromeMode: 'chrome-for-testing',
  logLevel: process.env.LOG ?? 'info',
};

const jobs = plan(lang);
/** What a file holds: the template, its events, the telling and the language. */
const key = (job) => [job.template, ...(job.props.events ?? [job.props.event]).map((e) => e.id), job.props.variant, lang, values.sfx ? 'sfx' : ''].join(':');

// Russian in out/ as before, other languages each in their own folder
const out = values.out ? `${values.out.replace(/\/$/, '')}/` : new URL(lang === 'ru' ? '../out/' : `../out/${lang}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });
// with sound effects the files get their own names, next to the silent ones
const suffix = values.sfx ? '-sfx' : '';
const name = (i) => `pulse-${String(i + 1).padStart(3, '0')}${suffix}`;
const manifestFile = `${out}manifest.json`;
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile)) : {};
writeFileSync(`${out}captions${suffix}.txt`, jobs.map((job, i) => `${name(i)}.mp4\n${post(lang, job.caption)}\n`).join('\n'));
writeFileSync(`${out}captions-reels${suffix}.txt`, jobs.map((job, i) => `${name(i)}.mp4\n${postReels(lang, job.caption)}\n`).join('\n'));
writeFileSync(`${out}captions-shorts${suffix}.txt`, jobs.map((job, i) => {
  const { title, description } = shorts(lang, job.caption);
  return `${name(i)}.mp4\nTitle: ${title}\nDescription: ${description}\n`;
}).join('\n'));

// The cover is a frame where the hook is on screen: every template opens with it, and by frame 20
// it has faded in and nothing else has started (checked on stills of all templates).
const COVER_FRAME = 20;
const covers = !values['no-covers'] && !values.stills;
// a cover belongs to the video, sound or not: pulse-NNN.jpg serves pulse-NNN-sfx.mp4 too
const coverFile = (job) => `${out}${job.file.replace(/-sfx$/, '')}.jpg`;
const videoDone = (job) => !values.force && existsSync(`${out}${job.file}.mp4`) && manifest[job.file] === key(job);

const wanted = new Set(values.template.split(','));
const todo = jobs
  .map((job, i) => ({ ...job, props: { ...job.props, sfx: values.sfx }, file: name(i), number: i + 1 }))
  .filter((job) => wanted.has(job.template) && job.number <= Number(values.max))
  .filter((job) => !values.only || values.only.split(',').map(Number).includes(job.number))
  .filter((job) => !values.shard || (job.number - 1) % Number(values.shard.split('/')[1]) === Number(values.shard.split('/')[0]))
  .filter((job, _, all) => !values['per-template'] || all.filter((j) => j.template === job.template).indexOf(job) < Number(values['per-template']))
  .filter((job) => values.stills || !videoDone(job) || (covers && !existsSync(coverFile(job))));
console.log(`${jobs.length} videos in the plan, ${todo.length} to render now`);
if (!todo.length) process.exit(0);

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
  const fresh = !videoDone(job);
  if (fresh) {
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
  if (covers && (!existsSync(coverFile(job)) || (fresh && !values.sfx))) {
    await renderStill({ serveUrl, composition, inputProps: job.props, frame: COVER_FRAME, imageFormat: 'jpeg', jpegQuality: 90, output: coverFile(job), ...browser });
    console.log(`cover ${coverFile(job).split('/').pop()}`);
  }
}
