// first: listens for errors before the rest of the page runs
import './client-errors';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import './theme.css';
import './landing.css';
import './record.css';

import { duration } from './ago';
import { STANDALONE, downtime, signalAudit, signalStats } from './api';
import { pct } from './format';
import { localize, mountLangSwitch, t } from './i18n';
import { followed, overall, type Followed } from './record-math';
import { load, save } from './storage';
import type { OutcomeStats } from './types';
import { mountTelegram } from './telegram';
import { hit } from './visit';

localize();
hit('record');
mountLangSwitch(document.getElementById('lang')!);

const $ = (id: string) => document.getElementById(id)!;
const PERIODS: Array<[number, string]> = [[7, t('7d')], [30, t('30d')], [90, t('90d')]];
/** The last horizon, an hour: long enough to be more than noise. */
const HOUR = 2;
/** Below this many measured signals an average is an anecdote. */
const THIN_SAMPLE = 10;

let days = load('recordDays', 30);

$('rec-period').innerHTML = PERIODS.map(([d, label]) => `<button type="button" data-days="${d}">${label}</button>`).join('');
$('rec-period').addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-days]');
  if (!button) return;
  days = Number(button.dataset.days);
  save('recordDays', days);
  void show();
});

function cell(f: Followed | null) {
  if (!f) return '<td class="mute">–</td>';
  const tone = f.move > 0 ? 'up' : f.move < 0 ? 'down' : '';
  return `<td><span class="${tone}">${pct(f.move, 2)}</span><span class="rec-share">${t('{share} their way', { share: `${Math.round(f.share * 100)}%` })}</span></td>`;
}

function row(s: OutcomeStats) {
  const count = Math.max(...s.horizons.map((h) => h.n));
  const thin = count < THIN_SAMPLE;
  const cells = s.direction === 0
    ? `<td class="mute" colspan="3">${t('no direction to check')}</td>`
    : s.horizons.map((_, i) => cell(followed(s, i))).join('');
  return `<tr class="${thin ? 'thin' : ''}"><td>${t(s.label)}</td><td>${count}</td>${cells}</tr>`;
}

async function show() {
  [...$('rec-period').children].forEach((b) =>
    b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.days) === days)),
  );
  if (STANDALONE) {
    $('rec-meta').textContent = t('The record is kept by the Pulse server; this demo runs without one.');
    return;
  }
  $('rec-meta').textContent = t('loading');
  let stats: OutcomeStats[];
  // the nightly check against the exchange's candles: a line of its own, never in the way of the record
  const audit = signalAudit(days).catch(() => null);
  const gaps = downtime(days).catch(() => null);
  try {
    stats = (await signalStats(days)).filter((s) => s.horizons.some((h) => h.n > 0));
  } catch {
    $('rec-meta').textContent = t('The record is not available right now.');
    return;
  }
  const total = stats.reduce((sum, s) => sum + Math.max(...s.horizons.map((h) => h.n)), 0);
  const hour = overall(stats, HOUR);
  const checked = await audit;
  showDowntime(await gaps);
  $('rec-meta').textContent = [
    t('last {days} days', { days }),
    checked?.checked ? t('checked against exchange candles: {ok} of {n}', { ok: checked.confirmed, n: checked.checked }) : '',
  ].filter(Boolean).join(' · ');
  $('rec-kpi').hidden = !hour;
  if (hour) {
    $('rec-n').textContent = String(total);
    $('rec-share').textContent = `${Math.round(hour.share * 100)}%`;
    $('rec-move').textContent = pct(hour.move, 2);
    $('rec-move').className = hour.move > 0 ? 'up' : hour.move < 0 ? 'down' : '';
  }
  $('rec-rows').innerHTML = stats.length
    ? stats.map(row).join('')
    : `<tr><td colspan="5" class="mute">${t('No measured signals in this period yet.')}</td></tr>`;
}

/** UTC, without the year: "11-02 13:45". */
const when = (t: string | number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ');

/** A week with three dead days must not read as a quiet week: the gaps are named before the numbers. */
function showDowntime(d: Awaited<ReturnType<typeof downtime>>) {
  const el = $('rec-down');
  const gone = d?.down.reduce((sum, i) => sum + (new Date(i.to).getTime() - new Date(i.from).getTime()), 0) ?? 0;
  el.hidden = !d || !d.down.length;
  if (el.hidden) return;
  const listed = d!.down.slice(-3).map((i) => `${when(i.from)} – ${when(i.to)}`).join(', ');
  el.textContent = t('Pulse was not running for {time} of these {days} days ({when}, UTC): there are no signals from then, and nothing is counted for it.', {
    time: duration(gone),
    days,
    when: d!.down.length > 3 ? `${listed}…` : listed,
  });
}

void show();
// at the end of the page, so arriving after a request moves nothing on screen
void mountTelegram($('rec-tg-links'), 'ghost').then(() => ($('rec-tg').hidden = $('rec-tg-links').hidden));
