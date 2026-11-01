// Pulse's own sound effects, synthesised with ffmpeg, so no one else's rights are involved: a low
// hit for impacts, a whoosh for cuts and a click for countdowns, in public/sfx/*.wav.
//   node scripts/sfx.mjs
// They are quiet on purpose: a trending sound is added in TikTok and goes on top.
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('../public/sfx/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });

const SOUNDS = {
  // a pitch-dropping sine thump with a burst of noise on top, decaying in half a second
  hit: { source: "aevalsrc='0.9*sin(2*PI*(50+90*exp(-t*16))*t)*exp(-t*6)+0.3*(random(0)*2-1)*exp(-t*45)':s=48000:d=0.6", filter: 'lowpass=f=4000' },
  // pink noise swelling and fading, the band moving up: air rushing past
  whoosh: { source: 'anoisesrc=d=0.4:c=pink:a=0.7:r=48000', filter: "volume='pow(sin(PI*t/0.4),2)':eval=frame,highpass=f=500,lowpass=f=7000" },
  // a short high blip
  click: { source: "aevalsrc='0.8*sin(2*PI*2400*t)*exp(-t*80)':s=48000:d=0.08", filter: 'anull' },
};

for (const [name, { source, filter }] of Object.entries(SOUNDS)) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-af', filter, '-ac', '1', '-c:a', 'pcm_s16le', `${dir}${name}.wav`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr}`);
  console.log(`public/sfx/${name}.wav`);
}
