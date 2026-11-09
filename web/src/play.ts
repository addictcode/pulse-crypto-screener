import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import './theme.css';
import './landing.css';
import './play.css';

import { pct } from './format';
import { lang, localize, mountLangSwitch, t } from './i18n';
import { drawFrame } from './play-chart';
import {
  ROUNDS, answerOf, coinToss, finish, nextPack, priceRange, score, storeSeries, storedPlayed, storedSeries, storedTotals, verdict,
  type Pick, type Round, type Series,
} from './play-game';
import { mountTelegram } from './telegram';
import { hit } from './visit';

localize();
hit('play');
mountLangSwitch(document.getElementById('lang')!);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('pl-canvas');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** How long the hour after the question takes to play. */
const PLAY_MS = 2_400;

let rounds: Round[] = [];
let series: Series | null = storedSeries();
/** the frame on screen, redrawn when the window changes size */
let frame: (() => void) | null = null;

/**
 * Where the rounds are: the folder of the English page. The Russian twin (/ru/play/) is one folder
 * down and fetches them from there; relative, so it also works on GitHub Pages under a sub-path.
 */
const ROUNDS_DIR = document.documentElement.dataset.pageLang === 'ru' ? '../../play/' : '';

/** Rounds of one pack. */
async function loadPack(pack: number): Promise<Round[]> {
  const response = await fetch(`${ROUNDS_DIR}rounds-${String(pack).padStart(2, '0')}.json`);
  if (!response.ok) throw new Error(`pack ${pack}: ${response.status}`);
  return (await response.json()) as Round[];
}

async function packCount(): Promise<number> {
  const response = await fetch(`${ROUNDS_DIR}index.json`);
  return response.ok ? ((await response.json()) as { packs: number }).packs : 1;
}

function show(section: 'intro' | 'round' | 'done') {
  $('pl-intro').hidden = section !== 'intro';
  $('pl-round').hidden = section !== 'round';
  $('pl-done').hidden = section !== 'done';
}

function history() {
  const totals = storedTotals();
  const el = $('pl-history');
  if (!totals.games) return;
  el.textContent = t('Played so far: {games} games, you guessed {you} of {rounds}, the coin {coin}.', { ...totals });
  el.hidden = false;
}

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString({ ru: 'ru-RU', es: 'es-ES', tr: 'tr-TR', en: 'en-GB' }[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function scoreLine() {
  if (!series) return;
  const { you, coin } = score(rounds, series);
  $('pl-score').textContent = t('You {you} · coin {coin}', { you, coin });
}

/** The question: the chart up to the signal candle, on a scale that knows only those candles. */
function ask() {
  if (!series) return;
  const i = series.picks.length;
  const r = rounds[i];
  $('pl-step').textContent = t('Round {n} of {total}', { n: i + 1, total: ROUNDS });
  scoreLine();
  $('pl-ask').hidden = false;
  $('pl-after').hidden = true;
  const slots = r.candles.length;
  frame = () => drawFrame(canvas, { candles: r.candles, shown: r.at + 1, range: priceRange(r.candles, r.at + 1), at: r.at, slots });
  frame();
}

/** The answer: the real next hour plays, the scale opens up to it, then the coin is named. */
function answer(pick: Pick) {
  if (!series) return;
  const i = series.picks.length;
  const r = rounds[i];
  series.picks.push(pick);
  series.coins.push(coinToss(Math.random));
  storeSeries(series);
  scoreLine();

  const right = pick === answerOf(r);
  const coin = series.coins[i];
  $('pl-ask').hidden = true;
  $('pl-after').hidden = false;
  $('pl-verdict').textContent = `${right ? t('Right.') : t('Not this time.')} ${t('An hour later: {move}', { move: pct(r.hour, 2) })}`;
  $('pl-verdict').dataset.tone = right ? 'up' : 'down';
  $('pl-reveal').textContent = t('It was {coin}, {day}: a {kind} of {move} in five minutes. The coin said {side}.', {
    coin: r.coin,
    day: day(r.day),
    kind: r.type === 'PUMP' ? t('pump') : t('dump'),
    // five minutes as the signal counts them: from the open four candles back to the signal close
    move: pct(Math.abs((r.candles[r.at][3] / r.candles[r.at - 4][0] - 1) * 100), 1).replace(/^[+−-]/, ''),
    side: coin === 'up' ? t('higher') : t('lower'),
  });
  $('pl-next').textContent = i + 1 === ROUNDS ? t('See the result') : t('Next round');

  const start = performance.now();
  const from = priceRange(r.candles, r.at + 1);
  const to = priceRange(r.candles, r.candles.length);
  const slots = r.candles.length;
  const step = (now: number) => {
    const k = calm ? 1 : Math.min(1, (now - start) / PLAY_MS);
    const ease = 1 - (1 - k) ** 3;
    const shown = r.at + 1 + Math.round((r.candles.length - r.at - 1) * k);
    const range: [number, number] = [from[0] + (to[0] - from[0]) * ease, from[1] + (to[1] - from[1]) * ease];
    frame = () => drawFrame(canvas, { candles: r.candles, shown, range, at: r.at, slots });
    frame();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function start() {
  const played = storedPlayed();
  const pack = nextPack(await packCount(), played);
  series = { pack, picks: [], coins: [] };
  storeSeries(series);
  rounds = await loadPack(pack);
  show('round');
  ask();
}

function done() {
  if (!series) return;
  const { you, coin } = score(rounds, series);
  finish(series.pack, you, coin);
  series = null;
  hit('play-done');
  $('pl-total').textContent = t('You guessed {you} of {total}. The coin: {coin}.', { you, total: ROUNDS, coin });
  $('pl-word').textContent = t(verdict(you, coin));
  show('done');
  void card(you, coin);
  void mountTelegram($('pl-tg'), 'ghost tg-fit');
}

/** The address a shared result leads to, tagged so the funnel knows where its visitors came from. */
const shareUrl = () => `${location.origin}${location.pathname}?utm_source=game`;

let cardBlob: Blob | null = null;

/** The result as a picture: for a story or a chat, the same dark look as the site. */
async function card(you: number, coin: number) {
  await document.fonts.ready;
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#040405';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#e8e9ec';
  ctx.textAlign = 'center';
  ctx.font = '600 48px "Onest Variable", sans-serif';
  ctx.fillText('Pulse', 540, 150);
  ctx.font = '800 64px "Unbounded Variable", sans-serif';
  ctx.fillText(t("Guess what's next").toUpperCase(), 540, 330, 960);
  ctx.font = '800 300px "Unbounded Variable", sans-serif';
  ctx.fillText(`${you}/${ROUNDS}`, 540, 720);
  ctx.fillStyle = '#a0a3aa';
  ctx.font = '500 52px "Onest Variable", sans-serif';
  ctx.fillText(t('the coin: {coin}/{total}', { coin, total: ROUNDS }), 540, 830);
  ctx.font = '500 38px "Onest Variable", sans-serif';
  ctx.fillText(t('Real Binance charts. Can you beat a coin?'), 540, 1050, 960);
  ctx.fillStyle = '#777a82';
  ctx.font = '500 32px "Onest Variable", sans-serif';
  ctx.fillText(`${location.host}${location.pathname}`, 540, 1230, 960);
  cardBlob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
  if (cardBlob) $<HTMLImageElement>('pl-card').src = URL.createObjectURL(cardBlob);
}

async function share() {
  const text = $('pl-total').textContent ?? '';
  const file = cardBlob ? new File([cardBlob], 'pulse-guess.png', { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: `${text} ${shareUrl()}` });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text, url: shareUrl() });
      return;
    }
  } catch {
    // the share sheet was closed: nothing to do
    return;
  }
  // no share sheet (most computers): save the picture and copy the link
  if (cardBlob) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(cardBlob);
    link.download = 'pulse-guess.png';
    link.click();
  }
  void navigator.clipboard?.writeText(shareUrl()).catch(() => {});
  $('pl-share').textContent = t('Picture saved, link copied');
}

document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.pick as Pick)));
$('pl-next').addEventListener('click', () => (series && series.picks.length < ROUNDS ? ask() : done()));
$('pl-start').addEventListener('click', () => void start());
$('pl-again').addEventListener('click', () => void start());
$('pl-share').addEventListener('click', () => void share());
new ResizeObserver(() => frame?.()).observe(canvas);

// a series left halfway continues where it stopped
async function resume() {
  history();
  if (!series) return;
  try {
    rounds = await loadPack(series.pack);
  } catch {
    series = null;
    storeSeries(null);
    return;
  }
  show('round');
  if (series.picks.length >= ROUNDS) done();
  else ask();
}
void resume();
