// Renders the series "I tested 60,329 crypto signals" (src/series.ts) in both languages to
// out/series/<lang>/signals-N.mp4, with the narration to read over each part in
// out/series/<lang>/voiceover.md and the post descriptions in captions.txt.
//   node scripts/series.mjs              everything
//   node scripts/series.mjs --stills     three frames per part, to check the look
//   node scripts/series.mjs --lang ru --part 2
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

import { SERIES, script } from '../src/series.ts';
import { TEXT } from '../src/text.ts';

const { values } = parseArgs({
  options: { lang: { type: 'string' }, part: { type: 'string' }, stills: { type: 'boolean', default: false } },
});

const browser = {
  browserExecutable: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromeMode: 'chrome-for-testing',
  logLevel: process.env.LOG ?? 'info',
};
const serveUrl = await bundle({ entryPoint: new URL('../src/index.ts', import.meta.url).pathname });

for (const lang of values.lang ? [values.lang] : Object.keys(SERIES)) {
  const out = new URL(`../out/series/${lang}/`, import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  const episodes = SERIES[lang];
  writeFileSync(`${out}voiceover.md`, episodes.map((e) => script(e, lang)).join('\n'));
  writeFileSync(`${out}captions.txt`, episodes.map((e) => `${e.slug}.mp4\n${e.caption}. ${TEXT[lang].note}\n${TEXT[lang].tags}\n`).join('\n'));
  for (const [i, episode] of episodes.entries()) {
    const part = i + 1;
    if (values.part && Number(values.part) !== part) continue;
    const inputProps = { episode, part, lang };
    const composition = await selectComposition({ serveUrl, id: 'Series', inputProps, ...browser });
    if (values.stills) {
      for (const f of [0.08, 0.4, 0.7]) {
        const frame = Math.round(composition.durationInFrames * f);
        await renderStill({ serveUrl, composition, inputProps, frame, output: `${out}${episode.slug}-f${frame}.png`, ...browser });
      }
      console.log(`stills ${lang}/${episode.slug}`);
      continue;
    }
    const file = `${out}${episode.slug}.mp4`;
    // one tab, then the broken-frame check, as for every other video (see README)
    for (let attempt = 1; attempt <= 3; attempt++) {
      await renderMedia({ serveUrl, composition, inputProps, codec: 'h264', crf: 18, outputLocation: file, concurrency: 1, ...browser });
      if (spawnSync('python3', [new URL('./check.py', import.meta.url).pathname, file]).status === 0) break;
      console.warn(`${lang}/${episode.slug} had broken frames, rendering it again`);
    }
    console.log(`video ${lang}/${episode.slug}.mp4 (${Math.round(composition.durationInFrames / 30)} s)`);
  }
}
