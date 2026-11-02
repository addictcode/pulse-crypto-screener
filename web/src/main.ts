import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import './styles.css';

import { Alerts } from './alerts';
import { STANDALONE, startFeed, watchVenues } from './api';
import { INTERVALS, PriceChart } from './chart';
import { ClipFrame } from './clip';
import { Densities } from './densities';
import { LiveFeed, isPhone, nothingStored, phoneMode, type PhoneMode } from './feed';
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
import { SetupJournal, welcomeOnce } from './setups';
import { Layout } from './layout';
import { Settings } from './settings';
import { SignalRecord } from './signals';
import { save } from './storage';
import { Tape } from './tape';
import { currentView, initViews, parseHash, rememberSymbol } from './views';
import { hit } from './visit';

localize();
mountIcons();
mountLangSwitch(document.getElementById('lang')!);

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
// drawn by CSS: the shortcut is shown, but stays out of the button's spoken name
document.getElementById('cmd-kbd')!.dataset.key = isMac ? '⌘K' : 'Ctrl K';
document.getElementById('cmd-btn')!.setAttribute('aria-keyshortcuts', isMac ? 'Meta+K' : 'Control+K');

// asked before anything below saves a setting: a first visit on a phone opens the live feed
const firstVisit = nothingStored();
document.body.dataset.phone = phoneMode(isPhone(), firstVisit, location.hash);

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
const clip = new ClipFrame(market);

// the screener owns the selection; every other view selects through it so they stay in step
let densities: Densities | null = null;
let record: SignalRecord | null = null;
let setups: SetupJournal | null = null;
let heatmap: Heatmap | null = null;
const screener = new Screener(market, (symbol) => {
  instrument.show(symbol);
  chart.show(symbol);
  alerts.show(symbol);
  clip.setSymbol(symbol);
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
// a row of the journal opens that pair on the timeframe the setup was taken on
setups = new SetupJournal(market, (symbol, timeframe) => {
  chart.setTimeframe(timeframe);
  selectSymbol(symbol);
});
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
    setups?.setActive(view === 'setups');
    heatmap?.setActive(view === 'heatmap');
    clip.setActive(view === 'clip');
    // the 9:16 frame is what videos are recorded in; counted to see whether anyone else uses it
    if (view === 'clip') hit('clip');
  },
  (symbol) => {
    if (symbol !== screener.selected) selectSymbol(symbol);
  },
);

const layout = new Layout();

/** The feed or the full terminal; a choice made with the switch is remembered. */
const setPhoneMode = (mode: PhoneMode) => {
  document.body.dataset.phone = mode;
  save('phoneMode', mode);
  if (mode === 'feed') history.replaceState(null, '', location.pathname);
  window.scrollTo({ top: 0 });
};
const feed = new LiveFeed(
  market,
  // a card's chart opens in the terminal for now; the feed stays the place this phone starts in
  (symbol) => {
    document.body.dataset.phone = 'terminal';
    location.hash = `#screener:${symbol}`;
    selectSymbol(symbol);
    window.scrollTo({ top: 0 });
  },
  setPhoneMode,
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

// the vertical frame for recording a short video of one pair; Esc or V again brings the terminal back
const toggleClip = () => (location.hash = `#${currentView() === 'clip' ? 'screener' : 'clip'}:${screener.selected}`);

/** Downloads the chart as a PNG; the button shows a tick for a moment so the click is not silent. */
function saveSnapshot() {
  const shot = chart.snapshot();
  if (!shot) return;
  shot.canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = shot.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    const icon = document.querySelector<HTMLElement>('#shot-btn .i')!;
    icon.innerHTML = ICONS.check;
    setTimeout(() => (icon.innerHTML = ICONS.camera), 1_600);
  }, 'image/png');
}
document.getElementById('shot-btn')!.addEventListener('click', saveSnapshot);
chart.onPick = (symbol) => selectSymbol(symbol);

const keys = document.getElementById('keys') as HTMLDialogElement;
if (/Mac|iPhone|iPad/.test(navigator.platform)) keys.querySelectorAll('.keys-mod').forEach((key) => (key.textContent = '⌘'));
function showKeys() {
  if (!keys.open) keys.showModal();
}
// a click on the dimmed page around the sheet closes it
keys.addEventListener('click', (e) => e.target === keys && keys.close());
document.getElementById('keys-btn')!.addEventListener('click', showKeys);

const go = (view: string) => () => (location.hash = `#${view}:${screener.selected}`);
const palette = new Palette(market, selectSymbol, (): Command[] => [
  { label: t('Terminal'), icon: 'view', run: go('screener') },
  { label: t('Grid'), icon: 'view', run: go('grid') },
  { label: t('Heatmap'), icon: 'view', run: go('heatmap') },
  { label: t('Densities'), icon: 'view', run: go('densities') },
  ...(STANDALONE ? [] : [{ label: t('Signals'), icon: 'view', run: go('signals') } satisfies Command, { label: t('Setups'), icon: 'view', run: go('setups') } satisfies Command]),
  { label: t('Chart only'), icon: 'expand', hint: 'F', run: toggleFocus },
  { label: t('Vertical frame for recording a video'), icon: 'camera', hint: 'V', run: toggleClip },
  {
    label: t('In the frame: record it to a video file'),
    icon: 'camera',
    hint: 'R',
    run: () => {
      if (currentView() !== 'clip') toggleClip();
      // the permission prompt needs the frame on screen; give the view a moment to switch
      setTimeout(() => clip.toggleRecording(), 300);
    },
  },
  { label: t('Show or hide the pair list'), icon: 'sidebar', hint: 'L', run: () => layout.toggleList() },
  { label: t('Show or hide the feeds under the chart'), icon: 'dock', hint: 'B', run: () => layout.toggleDock() },
  { label: t('All columns in the list'), icon: 'columns', run: () => screener.setWide(!screener.wide) },
  ...Object.keys(INTERVALS).map((tf, i): Command => ({
    label: t('Timeframe {tf}', { tf }),
    icon: 'indicators',
    hint: String(i + 1),
    run: () => chart.setTimeframe(tf),
  })),
  { label: t('Save the chart as a picture'), icon: 'camera', hint: 'S', run: saveSnapshot },
  { label: t('Keyboard shortcuts'), icon: 'keyboard', hint: '?', run: showKeys },
  { label: t('Settings'), icon: 'gear', hint: ',', run: () => settings.open() },
  {
    label: t('Copy a link to this chart'),
    icon: 'link',
    run: () => void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#screener:${screener.selected}`),
  },
  { label: lang === 'ru' ? 'Switch to English' : 'Переключить на русский', icon: 'translate', run: () => setLang(lang === 'ru' ? 'en' : 'ru') },
]);
document.getElementById('cmd-btn')!.addEventListener('click', () => palette.toggle());
welcomeOnce();
const settings = new Settings(welcomeOnce);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.toggle();
    return;
  }
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (target?.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() === 'v' || (e.key === 'Escape' && currentView() === 'clip')) {
    toggleClip();
    return;
  }
  if (e.key.toLowerCase() === 'r' && currentView() === 'clip') {
    clip.toggleRecording();
    return;
  }
  if (e.key.toLowerCase() === 'f') {
    toggleFocus();
    return;
  }
  if (e.key.toLowerCase() === 's') {
    saveSnapshot();
    return;
  }
  if (e.key === '?') {
    showKeys();
    return;
  }
  if (e.key.toLowerCase() === 'l') {
    layout.toggleList();
    return;
  }
  if (e.key.toLowerCase() === 'b') {
    layout.toggleDock();
    return;
  }
  if (e.key === ',') {
    settings.open();
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
  // only the demo can fail here: it asks Binance from the visitor's browser, and Binance does not
  // serve every country and network (the United States gets 451)
  feed.unreachable(t('This demo reads Binance straight from your browser, and Binance cannot be reached from this network or country. The full version gets the data on its server and works from anywhere.'));
});
watchVenues(market);
hit('app');
