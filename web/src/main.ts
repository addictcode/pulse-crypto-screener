import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/600.css';
import '@fontsource/azeret-mono/400.css';
import '@fontsource/azeret-mono/500.css';
import '@fontsource/azeret-mono/600.css';
import '@phosphor-icons/web/regular/style.css';
import '@phosphor-icons/web/fill/style.css';
import './styles.css';

import { PriceChart } from './chart';
import { InstrumentPanel } from './instrument';
import { LiquidationsPanel } from './liquidations';
import { connect, Market } from './market';
import { Masthead } from './masthead';
import { Screener } from './screener';

const market = new Market();
const instrument = new InstrumentPanel(market);
const chart = new PriceChart(market);
new Masthead(market);
new LiquidationsPanel(market);
new Screener(market, (symbol) => {
  instrument.show(symbol);
  chart.show(symbol);
});

const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
connect(market, `${scheme}://${location.host}/ws/market`);
