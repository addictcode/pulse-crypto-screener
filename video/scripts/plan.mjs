// The plan of videos: which template tells which events in which telling, in the order they are
// numbered. The same for every language (only the words differ), so pulse-042.mp4 in out/ and in
// out/en/ is the same video. scripts/render.mjs renders it, scripts/schedule.mjs schedules it.
import { existsSync, readFileSync } from 'node:fs';

import { splitFits } from '../src/split.ts';
import { TELLINGS, story } from '../src/story.ts';
import { TEXT } from '../src/text.ts';
import { trapSeries } from '../src/traps.ts';
import { volumeFits } from '../src/volume.ts';

const read = (name, fallback) => {
  const file = new URL(`../public/${name}`, import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file)) : fallback;
};

/** The events of a job: one, or the three of a top or a trap series. */
export const eventsOf = (job) => job.props.events ?? [job.props.event];

/**
 * Every video in number order, for one language. The data defaults to public/; a test passes its own.
 */
export function plan(lang, { events = read('events.json', []), days = read('days.json', {}), pulse = read('pulse.json', {}) } = {}) {
  const text = TEXT[lang];

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
  // one time-lapse per event that has its whole day in the archive
  const timelapses = events
    .filter((event) => days[event.id])
    .map((event, i) => ({ template: 'timelapse', id: 'Timelapse', props: { event, day: days[event.id], variant: (i + 1) % 5, lang }, caption: text.timelapse.captions[i % 5] }));
  // one before / after per event whose minutes before the move really were calm
  const splits = events
    .filter(splitFits)
    .map((event, i) => ({ template: 'split', id: 'Split', props: { event, variant: (i + 3) % 5, lang }, caption: text.split.captions[i % 5] }));
  // one volume burst per event whose volume went at least five times the average
  const volumes = events
    .filter(volumeFits)
    .map((event, i) => ({ template: 'volume', id: 'Volume', props: { event, variant: (i + 4) % 5, lang }, caption: text.volume.captions[i % 5] }));
  // threes of traps within a week each
  const trapJobs = trapSeries(events).map((three, i) => ({ template: 'traps', id: 'Traps', props: { events: three, variant: i % 5, lang }, caption: text.traps.captions[i % 5] }));
  // one pulse of the market per event with its hour of neighbours (scripts/pulse.mjs), when its
  // tile is the one that exploded: at least 4% at the event and the biggest of the thirty
  const pulseFits = (hour) => {
    if (!hour) return false;
    const at = hour.tiles.map((t) => Math.abs(t[50]));
    return at[hour.focus] >= 4 && at[hour.focus] === Math.max(...at);
  };
  const pulses = events
    .filter((event) => pulseFits(pulse[event.id]))
    .map((event, i) => ({ template: 'pulse', id: 'Pulse', props: { event, hour: pulse[event.id], variant: (i + 2) % 5, lang }, caption: text.pulse.captions[i % 5] }));
  return turns([memes, guesses, counters, tops, timelapses, splits, volumes, trapJobs, pulses]);
}
