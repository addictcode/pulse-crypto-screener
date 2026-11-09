// A posting plan: two videos a day, templates taking turns, one event at most once in five days,
// the Russian and the English account side by side (the same video number in both languages).
//   node scripts/schedule.mjs [--days 60] [--per-day 2] [--start 2026-11-02]   writes out/schedule.csv
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { post } from '../src/text.ts';
import { eventsOf, plan } from './plan.mjs';

const DAY = 86_400_000;
/** an event shows again no sooner than this many days later */
export const GAP = 5;

/**
 * Picks videos for each slot in number order: the first not yet posted whose template differs
 * from the post before it and whose events were not posted in the last GAP days. Returns rows of
 * { day, slot, number, job }; throws when the plan runs out of videos that fit.
 */
export function schedule(jobs, { days, perDay = 2, gap = GAP }) {
  const used = new Set();
  const lastDay = new Map(); // event id → day it was last posted
  const posted = new Map(); // template → videos of it posted so far
  const rows = [];
  let previous = null;
  for (let day = 0; day < days; day++) {
    const today = new Set();
    for (let slot = 0; slot < perDay; slot++) {
      // of the videos that fit, the one whose template has been posted least so far (the plan's
      // order breaks ties): the first fit alone let the event gap starve whole templates when
      // several templates tell the same events in the same order
      let k = -1;
      jobs.forEach((job, i) => {
        if (used.has(i) || job.template === previous || today.has(job.template)) return;
        if (!eventsOf(job).every((e) => !lastDay.has(e.id) || day - lastDay.get(e.id) >= gap)) return;
        if (k < 0 || (posted.get(job.template) ?? 0) < (posted.get(jobs[k].template) ?? 0)) k = i;
      });
      if (k < 0) throw new Error(`no video fits day ${day + 1}, slot ${slot + 1}: render more or schedule fewer days`);
      used.add(k);
      today.add(jobs[k].template);
      posted.set(jobs[k].template, (posted.get(jobs[k].template) ?? 0) + 1);
      for (const e of eventsOf(jobs[k])) lastDay.set(e.id, day);
      previous = jobs[k].template;
      rows.push({ day, slot, number: k + 1, job: jobs[k] });
    }
  }
  return rows;
}

/** What breaks the rules in a schedule, as messages; empty when it is fine. */
export function violations(rows, { perDay = 2, gap = GAP } = {}) {
  const out = [];
  const seen = new Set();
  const lastDay = new Map();
  rows.forEach((row, i) => {
    if (seen.has(row.number)) out.push(`video ${row.number} posted twice`);
    seen.add(row.number);
    if (i > 0 && rows[i - 1].job.template === row.job.template) out.push(`day ${row.day + 1}: ${row.job.template} twice in a row`);
    for (const e of eventsOf(row.job)) {
      if (lastDay.has(e.id) && row.day - lastDay.get(e.id) < gap) out.push(`day ${row.day + 1}: ${e.id} again after ${row.day - lastDay.get(e.id)} days`);
      lastDay.set(e.id, row.day);
    }
  });
  const perDayCount = new Map();
  for (const row of rows) perDayCount.set(row.day, (perDayCount.get(row.day) ?? 0) + 1);
  for (const [day, n] of perDayCount) if (n !== perDay) out.push(`day ${day + 1}: ${n} posts`);
  return out;
}

const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      days: { type: 'string', default: '60' },
      'per-day': { type: 'string', default: '2' },
      start: { type: 'string', default: new Date(Math.floor(Date.now() / DAY) * DAY + DAY).toISOString().slice(0, 10) },
    },
  });
  const perDay = Number(values['per-day']);
  const ru = plan('ru');
  const en = plan('en');
  const rows = schedule(ru, { days: Number(values.days), perDay });
  const problems = violations(rows, { perDay });
  if (problems.length) throw new Error(problems.join('\n'));
  const start = Date.parse(`${values.start}T00:00:00Z`);
  const file = (n) => `pulse-${String(n).padStart(3, '0')}.mp4`;
  const lines = [['date', 'slot', 'number', 'template', 'ru_file', 'ru_caption', 'en_file', 'en_caption'].join(',')];
  for (const row of rows) {
    const date = new Date(start + row.day * DAY).toISOString().slice(0, 10);
    lines.push([date, row.slot + 1, row.number, row.job.template, file(row.number), post('ru', row.job.caption).replace('\n', ' '), `en/${file(row.number)}`, post('en', en[row.number - 1].caption).replace('\n', ' ')].map(csv).join(','));
  }
  const out = new URL('../out/', import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}schedule.csv`, `${lines.join('\n')}\n`);
  const last = Math.max(...rows.map((r) => r.number));
  console.log(`out/schedule.csv: ${rows.length} posts over ${values.days} days, videos up to ${last} needed`);
}
