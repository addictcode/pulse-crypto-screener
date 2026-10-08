import '@fontsource-variable/inter';
import '@fontsource/chakra-petch/700.css';
import './styles.css';

import { Alerts } from './alerts';
import { STANDALONE, startFeed, watchVenues } from './api';
import { INTERVALS, PriceChart } from './chart';
import { Densities } from './densities';
import { ChartGrid } from './grid';
import { Heatmap } from './heatmap';
import { lang, localize, mountLangSwitch, setLang, t } from './i18n';
import { ICONS, mountIcons } from './icons';
import { InstrumentPanel } from './instrument';
import { LiquidationsPanel } from './liquidations';
import { Market } from './market';
import { Masthead } from './masthead';
import { Palette, type Command } from './palette';
import { Screener } from './screener';
import { SignalRecord } from './signals';
import { save } from './storage';
import { Tape } from './tape';
import { currentView, initViews, parseHash, rememberSymbol } from './views';

localize();
mountIcons();
mountLangSwitch(document.getElementById('lang')!);

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
document.getElementById('cmd-kbd')!.textContent = isMac ? '⌘K' : 'Ctrl K';

// a shared link names its pair; it wins over the one remembered in this browser
const linked = parseHash(location.hash).symbol;
if (linked) save('selected', linked);

const market = new Market();
const instrument = new InstrumentPanel(market);
// set later: the screener (which owns the selection) is built after the panels it drives
let selectSymbol: (symbol: string) => void = () => {};
const alerts = new Alerts(market, (symbol) => selectSymbol(symbol));
const chart = new PriceChart(market, alerts);
new Masthead(market);
new LiquidationsPanel(market);

// the screener owns the selection; every other view selects through it so they stay in step
let densities: Densities | null = null;
let record: SignalRecord | null = null;
let heatmap: Heatmap | null = null;
const screener = new Screener(market, (symbol) => {
  instrument.show(symbol);
  chart.show(symbol);
  alerts.show(symbol);
  densities?.setSelected(symbol);
  record?.setSelected(symbol);
  heatmap?.setSelected(symbol);
  rememberSymbol(symbol);
});
selectSymbol = (symbol) => {
  if (market.rows.has(symbol)) screener.select(symbol);
};
densities = new Densities(market, selectSymbol);
new Tape(market, selectSymbol);
densities.setSelected(screener.selected);
record = new SignalRecord(market, selectSymbol);
record.setSelected(screener.selected);
heatmap = new Heatmap(market, selectSymbol);
heatmap.setSelected(screener.selected);
const grid = new ChartGrid(
  market,
  () => ({ rows: screener.list(), label: screener.presetLabel }),
  (symbol) => {
    selectSymbol(symbol);
    location.hash = `#screener:${symbol}`;
  },
);
initViews(
  (view) => {
    densities?.setActive(view === 'densities');
    grid.setActive(view === 'grid');
    record?.setActive(view === 'signals');
    heatmap?.setActive(view === 'heatmap');
  },
  (symbol) => {
    if (symbol !== screener.selected) selectSymbol(symbol);
  },
);

// chart only: the list and the dock step aside
const focusButton = document.getElementById('focus-btn')!;
function setFocus(on: boolean) {
  if (on) document.body.dataset.focus = '';
  else delete document.body.dataset.focus;
  focusButton.setAttribute('aria-pressed', String(on));
  focusButton.querySelector('.i')!.innerHTML = on ? ICONS.collapse : ICONS.expand;
}
const toggleFocus = () => {
  if (currentView() !== 'screener') location.hash = `#screener:${screener.selected}`;
  setFocus(!('focus' in document.body.dataset));
};
focusButton.addEventListener('click', toggleFocus);

const go = (view: string) => () => (location.hash = `#${view}:${screener.selected}`);
const palette = new Palette(market, selectSymbol, (): Command[] => [
  { label: t('Terminal'), icon: 'view', run: go('screener') },
  { label: t('Grid'), icon: 'view', run: go('grid') },
  { label: t('Heatmap'), icon: 'view', run: go('heatmap') },
  { label: t('Densities'), icon: 'view', run: go('densities') },
  ...(STANDALONE ? [] : [{ label: t('Signals'), icon: 'view', run: go('signals') } satisfies Command]),
  { label: t('Chart only'), icon: 'expand', hint: 'F', run: toggleFocus },
  { label: t('All columns in the list'), icon: 'columns', run: () => screener.setWide(!screener.wide) },
  ...Object.keys(INTERVALS).map((tf, i): Command => ({
    label: t('Timeframe {tf}', { tf }),
    icon: 'indicators',
    hint: String(i + 1),
    run: () => chart.setTimeframe(tf),
  })),
  {
    label: t('Copy a link to this chart'),
    icon: 'link',
    run: () => void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#screener:${screener.selected}`),
  },
  { label: lang === 'ru' ? 'Switch to English' : 'Переключить на русский', icon: 'translate', run: () => setLang(lang === 'ru' ? 'en' : 'ru') },
]);
document.getElementById('cmd-btn')!.addEventListener('click', () => palette.toggle());

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.toggle();
    return;
  }
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (target?.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() === 'f') {
    toggleFocus();
    return;
  }
  const timeframe = Object.keys(INTERVALS)[Number(e.key) - 1];
  if (timeframe && e.key.length === 1) chart.setTimeframe(timeframe);
});

if (STANDALONE) {
  // no server behind this page: no stored signals, so nothing to show in that section
  document.body.dataset.mode = 'lite';
  document.getElementById('st-source')!.textContent = t('Binance USDT-M, demo running in your browser');
}
startFeed(market).catch(() => {
  const status = document.getElementById('st-conn')!;
  status.dataset.state = 'reconnecting';
  status.textContent = t('Binance cannot be reached from this network');
});
watchVenues(market);
