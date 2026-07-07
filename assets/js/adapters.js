// Адаптеры бирж: единый интерфейс поверх Binance USDT-M Futures и Bybit v5 (linear).
// Формат тикера: {symbol, price, pct24, high24, low24, volq24, trades24?, fundingRate?, nextFunding?, oi?, oiValue?}
// Формат свечи: {t, o, h, l, c, v, qv}
// Формат ликвидации: {symbol, side: 'long'|'short' (кого ликвидировали), usd, price, ts}

export async function jfetch(url, timeout = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return await r.json();
  } finally { clearTimeout(t); }
}

// WebSocket с автопереподключением и опциональным пингом
export class RWS {
  constructor(url, { onMessage, onOpen, onStatus, pingMsg, pingEvery } = {}) {
    Object.assign(this, { url, onMessage, onOpen, onStatus, pingMsg, pingEvery });
    this.delay = 1000;
    this.dead = false;
    this.open();
  }
  open() {
    if (this.dead) return;
    try { this.ws = new WebSocket(this.url); } catch { return this.retry(); }
    this.ws.onopen = () => {
      this.delay = 1000;
      this.onStatus?.(true);
      this.onOpen?.(this.ws);
      if (this.pingMsg) this.pinger = setInterval(() => { try { this.ws.send(this.pingMsg); } catch {} }, this.pingEvery || 20000);
    };
    this.ws.onmessage = ev => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      this.onMessage?.(d);
    };
    this.ws.onclose = () => { clearInterval(this.pinger); this.onStatus?.(false); this.retry(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }
  retry() {
    if (this.dead) return;
    clearTimeout(this.t);
    this.t = setTimeout(() => this.open(), this.delay);
    this.delay = Math.min(this.delay * 1.7, 15000);
  }
  send(o) {
    try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); } catch {}
  }
  close() {
    this.dead = true;
    clearTimeout(this.t);
    clearInterval(this.pinger);
    try { this.ws?.close(); } catch {}
  }
}

export function binanceAdapter() {
  const REST = 'https://fapi.binance.com';
  const WS = 'wss://fstream.binance.com';
  let main = null, guard = null, pollT = null, fundT = null;

  return {
    id: 'binance',
    name: 'Binance Futures',

    async fetchSymbols() {
      const info = await jfetch(REST + '/fapi/v1/exchangeInfo');
      return info.symbols
        .filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
        .map(s => ({ symbol: s.symbol, base: s.baseAsset }));
    },

    async fetchTickers() {
      const arr = await jfetch(REST + '/fapi/v1/ticker/24hr');
      return arr.map(t => ({
        symbol: t.symbol, price: +t.lastPrice, pct24: +t.priceChangePercent,
        high24: +t.highPrice, low24: +t.lowPrice, volq24: +t.quoteVolume, trades24: +t.count,
      }));
    },

    async fetchKlines(symbol, tf, limit = 400) {
      const a = await jfetch(`${REST}/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`);
      return a.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7] }));
    },

    async fetchOI(symbol) {
      const d = await jfetch(`${REST}/fapi/v1/openInterest?symbol=${symbol}`);
      return +d.openInterest;
    },

    async fetchOIHist(symbol) {
      const a = await jfetch(`${REST}/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=6`);
      return a.map(x => ({ t: x.timestamp, v: +x.sumOpenInterestValue }));
    },

    async fetchFunding() {
      const a = await jfetch(REST + '/fapi/v1/premiumIndex');
      return a.map(d => ({ symbol: d.symbol, fundingRate: +d.lastFundingRate, nextFunding: d.nextFundingTime }));
    },

    async fetchDepth(symbol) {
      const d = await jfetch(`${REST}/fapi/v1/depth?symbol=${symbol}&limit=100`);
      const num = a => a.map(([p, q]) => [+p, +q]);
      return { bids: num(d.bids), asks: num(d.asks) };
    },

    start(cb) {
      let lastWs = 0;
      const stopPolling = () => {
        if (!pollT) return;
        clearInterval(pollT); clearInterval(fundT);
        pollT = fundT = null;
        cb.onMode?.('ws');
      };
      const startPolling = () => {
        if (pollT) return;
        cb.onMode?.('rest');
        const tick = async () => {
          try { cb.onTicker(await this.fetchTickers()); cb.onStatus(true); }
          catch { cb.onStatus(false); }
        };
        const fund = async () => { try { cb.onFunding(await this.fetchFunding()); } catch {} };
        tick(); fund();
        pollT = setInterval(tick, 3000);
        fundT = setInterval(fund, 30000);
      };
      // если WS молчит (гео-блок стрима при рабочем REST) — переходим на опрос
      guard = setInterval(() => {
        if (Date.now() - lastWs > 12000) startPolling(); else stopPolling();
      }, 6000);
      // фандинг сразу при старте, не дожидаясь стрима
      this.fetchFunding().then(cb.onFunding).catch(() => {});

      main = new RWS(`${WS}/stream?streams=!ticker@arr/!markPrice@arr/!forceOrder@arr`, {
        onStatus: cb.onStatus,
        onMessage: m => {
          const { stream, data } = m;
          if (!stream) return;
          if (stream === '!ticker@arr') {
            lastWs = Date.now();
            cb.onTicker(data.map(d => ({
              symbol: d.s, price: +d.c, pct24: +d.P, high24: +d.h, low24: +d.l, volq24: +d.q, trades24: d.n,
            })));
          } else if (stream === '!markPrice@arr') {
            cb.onFunding(data.map(d => ({ symbol: d.s, fundingRate: +d.r, nextFunding: d.T })));
          } else if (stream === '!forceOrder@arr') {
            const o = data.o;
            const px = +o.ap || +o.p;
            // SELL = принудительно продали позицию => ликвидирован лонг
            cb.onLiq({ symbol: o.s, side: o.S === 'SELL' ? 'long' : 'short', usd: (+o.q) * px, price: px, ts: o.T });
          }
        },
      });
    },

    subscribeKline(symbol, tf, onBar) {
      let lastWs = 0, closed = false;
      const ws = new RWS(`${WS}/ws/${symbol.toLowerCase()}@kline_${tf}`, {
        onMessage: m => {
          const k = m.k;
          if (k) { lastWs = Date.now(); onBar({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, qv: +k.q }); }
        },
      });
      // фолбэк: если WS молчит, тянем последнюю свечу REST'ом
      const poll = setInterval(async () => {
        if (closed || Date.now() - lastWs < 6000) return;
        try {
          const ks = await this.fetchKlines(symbol, tf, 2);
          if (!closed && ks.length) onBar(ks[ks.length - 1]);
        } catch {}
      }, 3500);
      return () => { closed = true; clearInterval(poll); ws.close(); };
    },

    stop() {
      main?.close(); main = null;
      clearInterval(guard); clearInterval(pollT); clearInterval(fundT);
      guard = pollT = fundT = null;
    },
  };
}

const BYBIT_IV = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };

export function bybitAdapter() {
  const REST = 'https://api.bybit.com';
  const WSPUB = 'wss://stream.bybit.com/v5/public/linear';
  let poll = null, liqWs = null;

  return {
    id: 'bybit',
    name: 'Bybit Perp',

    async fetchSymbols() {
      let out = [], cursor = '';
      for (let i = 0; i < 4; i++) {
        const d = await jfetch(`${REST}/v5/market/instruments-info?category=linear&limit=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
        const l = d.result?.list || [];
        out = out.concat(
          l.filter(s => s.quoteCoin === 'USDT' && s.status === 'Trading' && s.contractType === 'LinearPerpetual')
            .map(s => ({ symbol: s.symbol, base: s.baseCoin }))
        );
        cursor = d.result?.nextPageCursor || '';
        if (!cursor) break;
      }
      return out;
    },

    async fetchTickers() {
      const d = await jfetch(`${REST}/v5/market/tickers?category=linear`);
      return (d.result?.list || []).map(t => ({
        symbol: t.symbol, price: +t.lastPrice, pct24: +t.price24hPcnt * 100,
        high24: +t.highPrice24h, low24: +t.lowPrice24h, volq24: +t.turnover24h,
        fundingRate: +t.fundingRate, nextFunding: +t.nextFundingTime,
        oi: +t.openInterest, oiValue: +t.openInterestValue,
      }));
    },

    async fetchKlines(symbol, tf, limit = 400) {
      const d = await jfetch(`${REST}/v5/market/kline?category=linear&symbol=${symbol}&interval=${BYBIT_IV[tf]}&limit=${Math.min(limit, 1000)}`);
      return (d.result?.list || []).reverse().map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[6] }));
    },

    async fetchDepth(symbol) {
      const d = await jfetch(`${REST}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=200`);
      const num = a => (a || []).map(([p, q]) => [+p, +q]);
      return { bids: num(d.result?.b), asks: num(d.result?.a) };
    },

    start(cb) {
      this._cb = cb;
      const tick = async () => {
        try {
          cb.onTicker(await this.fetchTickers());
          cb.onStatus(true);
        } catch { cb.onStatus(false); }
      };
      tick();
      poll = setInterval(tick, 3000);
    },

    // ликвидации на Bybit — только по подписке на конкретные пары, берём топовые
    watchLiqs(symbols, onLiq) {
      const emit = onLiq || this._cb?.onLiq;
      if (!emit || liqWs) return;
      liqWs = new RWS(WSPUB, {
        pingMsg: '{"op":"ping"}', pingEvery: 20000,
        onOpen: () => {
          const args = symbols.map(s => 'allLiquidation.' + s);
          for (let i = 0; i < args.length; i += 10) liqWs.send({ op: 'subscribe', args: args.slice(i, i + 10) });
        },
        onMessage: m => {
          if (m.topic && m.topic.startsWith('allLiquidation') && Array.isArray(m.data)) {
            // Buy-ордер закрывает шорт => ликвидирован шорт
            for (const d of m.data) emit({ symbol: d.s, side: d.S === 'Buy' ? 'short' : 'long', usd: (+d.v) * (+d.p), price: +d.p, ts: d.T });
          }
        },
      });
    },

    subscribeKline(symbol, tf, onBar) {
      const ws = new RWS(WSPUB, {
        pingMsg: '{"op":"ping"}', pingEvery: 20000,
        onOpen: () => ws.send({ op: 'subscribe', args: [`kline.${BYBIT_IV[tf]}.${symbol}`] }),
        onMessage: m => {
          if (m.topic && m.topic.startsWith('kline.') && Array.isArray(m.data)) {
            for (const k of m.data) onBar({ t: +k.start, o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume, qv: +k.turnover });
          }
        },
      });
      return () => ws.close();
    },

    stop() { clearInterval(poll); poll = null; liqWs?.close(); liqWs = null; },
  };
}
