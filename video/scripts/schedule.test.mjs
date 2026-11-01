// node --test: the posting plan keeps its rules for 60 days on the real plan of videos.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from './plan.mjs';
import { GAP, schedule, violations } from './schedule.mjs';

test('60 days, two a day: every video once, templates take turns, an event at most once in five days', () => {
  const rows = schedule(plan('ru'), { days: 60, perDay: 2 });
  assert.equal(rows.length, 120);
  assert.deepEqual(violations(rows, { perDay: 2, gap: GAP }), []);
  // the two posts of a day are different templates, and over a week there is variety
  const week = new Set(rows.slice(0, 14).map((r) => r.job.template));
  assert.ok(week.size >= 6, `only ${week.size} templates in the first week`);
});

test('the English column is the same video as the Russian one', () => {
  const ru = plan('ru');
  const en = plan('en');
  assert.equal(en.length, ru.length);
  ru.forEach((job, i) => {
    assert.equal(en[i].template, job.template);
    assert.equal(en[i].props.variant, job.props.variant);
  });
});

test('the checker catches a broken schedule', () => {
  const jobs = plan('ru');
  const e = { template: 'event', props: { event: jobs[0].props.event } };
  const bad = [
    { day: 0, slot: 0, number: 1, job: e },
    { day: 0, slot: 1, number: 2, job: e },
    { day: 1, slot: 0, number: 2, job: e },
  ];
  const problems = violations(bad, { perDay: 2 });
  assert.ok(problems.some((p) => p.includes('twice in a row')));
  assert.ok(problems.some((p) => p.includes('again after')));
  assert.ok(problems.some((p) => p.includes('posted twice')));
  assert.ok(problems.some((p) => p.includes('1 posts')));
});
