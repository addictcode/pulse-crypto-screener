import '@fontsource-variable/inter';
import '@fontsource/chakra-petch/700.css';
import './styles.css';

import { Alerts } from './alerts';
import { INTERVALS, PriceChart } from './chart';
import { Densities } from './densities';
import { ChartGrid } from './grid';
import { localize, mountLangSwitch } from './i18n';
import { ICONS, mountIcons } from './icons';
import { InstrumentPanel } from './instrument';
import { LiquidationsPanel } from './liquidations';
import { connect, Market, watchVenues } from './market';
import { Masthead } from './masthead';
import { Screener } from './screener';
import { SignalRecord } from './signals';
import { save } from './storage';
import { Tape } from './tape';
import { currentView, initViews, parseHash, rememberSymbol } from './views';

localize();
mountIcons();
mountLangSwitch(document.getElementById('lang')!);

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
const screener = new Screener(market, (symbol) => {
  instrument.show(symbol);
  chart.show(symbol);
  alerts.show(symbol);
  densities?.setSelected(symbol);
  record?.setSelected(symbol);
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

document.addEventListener('keydown', (e) => {
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (target?.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() === 'f') {
    toggleFocus();
    return;
  }
  const timeframe = Object.keys(INTERVALS)[Number(e.key) - 1];
  if (timeframe && e.key.length === 1) chart.setTimeframe(timeframe);
});

const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
connect(market, `${scheme}://${location.host}/ws/market`);
watchVenues(market);
