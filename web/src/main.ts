import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/azeret-mono/400.css';
import '@fontsource/azeret-mono/500.css';
import '@fontsource/azeret-mono/600.css';
import './theme.css';
import './styles.css';

import { Alerts } from './alerts';
import { PriceChart } from './chart';
import { Densities } from './densities';
import { ChartGrid } from './grid';
import { ICONS } from './icons';
import { InstrumentPanel } from './instrument';
import { LiquidationsPanel } from './liquidations';
import { connect, Market, watchVenues } from './market';
import { Masthead } from './masthead';
import { Screener } from './screener';
import { SignalRecord } from './signals';
import { Tape } from './tape';
import { initViews } from './views';

document.getElementById('search-icon')!.innerHTML = ICONS.search;

const market = new Market();
const instrument = new InstrumentPanel(market);
// set later: the screener (which owns the selection) is built after the panels it drives
let selectSymbol: (symbol: string) => void = () => {};
const alerts = new Alerts(market, (symbol) => selectSymbol(symbol));
const chart = new PriceChart(market, alerts);
new Masthead(market);
new LiquidationsPanel(market);

// the screener owns the selection; the density view selects through it so both stay in step
let densities: Densities | null = null;
let record: SignalRecord | null = null;
const screener = new Screener(market, (symbol) => {
  instrument.show(symbol);
  chart.show(symbol);
  alerts.show(symbol);
  densities?.setSelected(symbol);
  record?.setSelected(symbol);
});
selectSymbol = (symbol) => screener.select(symbol);
densities = new Densities(market, (symbol) => screener.select(symbol));
new Tape(market, (symbol) => screener.select(symbol));
densities.setSelected(screener.selected);
record = new SignalRecord(market, (symbol) => screener.select(symbol));
record.setSelected(screener.selected);
const grid = new ChartGrid(
  market,
  () => ({ rows: screener.list(), label: screener.presetLabel }),
  (symbol) => {
    screener.select(symbol);
    location.hash = '#screener';
  },
);
initViews((view) => {
  densities?.setActive(view === 'densities');
  grid.setActive(view === 'grid');
  record?.setActive(view === 'signals');
});

const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
connect(market, `${scheme}://${location.host}/ws/market`);
watchVenues(market);
