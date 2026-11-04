import type { Liquidation, Signal, StreamMessage, SymbolMetrics, TapeItem, VenueGap, Wall } from './types';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

type Listener<T> = (payload: T) => void;

export class Emitter<T> {
  private listeners: Listener<T>[] = [];
  on(listener: Listener<T>) {
    this.listeners.push(listener);
  }
  emit(payload: T) {
    this.listeners.forEach((l) => l(payload));
  }
}

const RECENT_LIQUIDATIONS = 60;
export const RECENT_SIGNALS = 100;
const RECENT_TAPE = 120;

/**
 * Client-side copy of the market, fed by the backend stream. Panels subscribe to the
 * events they care about instead of polling.
 */
export class Market {
  readonly rows = new Map<string, SymbolMetrics>();
  readonly sparklines = new Map<string, number[]>();
  liquidations: Liquidation[] = [];
  /** Newest first. */
  signals: Signal[] = [];
  /** Live tape, newest first. */
  tape: TapeItem[] = [];
  /** Every detected wall, nearest to its price first. */
  walls: Wall[] = [];
  /** Symbols with a live order book, and how far from the price that book is fully known. */
  readonly coverage = new Map<string, number>();
  private wallsBySymbol = new Map<string, Wall[]>();
  /** Binance against Bybit by symbol; empty while Bybit is off or unreachable. */
  gaps = new Map<string, VenueGap>();
  connection: ConnectionState = 'connecting';
  /** Server timestamp of the newest tick, used to show how fresh the data is. */
  lastTick = 0;

  readonly snapshot = new Emitter<void>();
  /** Previous and current row for every symbol that changed in a tick. */
  readonly delta = new Emitter<Array<[SymbolMetrics | undefined, SymbolMetrics]>>();
  readonly newLiquidations = new Emitter<Liquidation[]>();
  readonly sparklinesUpdated = new Emitter<void>();
  readonly wallsUpdated = new Emitter<void>();
  /** Signals that just arrived (empty array after a reconnect replaced the list). */
  readonly newSignals = new Emitter<Signal[]>();
  /** Tape items that just arrived; empty after a reconnect replaced the list. */
  readonly newTape = new Emitter<TapeItem[]>();
  readonly connectionChanged = new Emitter<ConnectionState>();
  readonly gapsUpdated = new Emitter<void>();

  // the first signals and tape a page receives are history, not news (see apply)
  private signalsLoaded = false;
  private tapeLoaded = false;

  apply(message: StreamMessage) {
    switch (message.type) {
      case 'snapshot':
        this.rows.clear();
        message.rows.forEach((r) => this.rows.set(r.symbol, r));
        this.liquidations = message.liquidations.slice(0, RECENT_LIQUIDATIONS);
        this.lastTick = message.ts;
        this.snapshot.emit();
        break;
      case 'delta': {
        const changes: Array<[SymbolMetrics | undefined, SymbolMetrics]> = [];
        for (const partial of message.rows) {
          const prev = this.rows.get(partial.symbol);
          // a symbol we have never seen needs a whole row; it arrives with the next keyframe
          if (!prev && partial.price === undefined) continue;
          const next = { ...prev, ...partial } as SymbolMetrics;
          changes.push([prev, next]);
          this.rows.set(next.symbol, next);
        }
        this.lastTick = message.ts;
        this.delta.emit(changes);
        break;
      }
      case 'liquidations':
        this.liquidations = [...message.items.slice().reverse(), ...this.liquidations].slice(0, RECENT_LIQUIDATIONS);
        this.newLiquidations.emit(message.items);
        break;
      case 'walls':
        this.walls = message.walls;
        this.wallsBySymbol = new Map();
        for (const wall of message.walls) {
          const list = this.wallsBySymbol.get(wall.symbol);
          if (list) list.push(wall);
          else this.wallsBySymbol.set(wall.symbol, [wall]);
        }
        this.coverage.clear();
        Object.entries(message.coverage).forEach(([symbol, pct]) => this.coverage.set(symbol, pct));
        this.wallsUpdated.emit();
        break;
      case 'signals': {
        // the first list is history (on connect, or the landing's first poll); after that, what
        // was not known yet is news, whether it came alone or with the next poll
        const first = !this.signalsLoaded;
        this.signalsLoaded = true;
        const known = new Set(this.signals.map((s) => s.id));
        const fresh = message.items.filter((s) => !known.has(s.id));
        this.signals = [...fresh, ...this.signals].sort((a, b) => b.time - a.time).slice(0, RECENT_SIGNALS);
        this.newSignals.emit(first ? [] : fresh);
        break;
      }
      case 'outcomes': {
        const updated = new Map(message.items.map((s) => [s.id, s]));
        this.signals = this.signals.map((s) => updated.get(s.id) ?? s);
        this.newSignals.emit([]);
        break;
      }
      case 'tape': {
        // the first list is history; afterwards each scan's (or each poll's) new items
        const first = !this.tapeLoaded;
        this.tapeLoaded = true;
        const key = (t: TapeItem) => `${t.time}:${t.symbol}:${t.kind}`;
        const known = new Set(this.tape.map(key));
        const fresh = message.items.filter((t) => !known.has(key(t)));
        this.tape = [...fresh, ...this.tape].sort((a, b) => b.time - a.time).slice(0, RECENT_TAPE);
        this.newTape.emit(first ? [] : fresh);
        break;
      }
      case 'sparklines':
        Object.entries(message.series).forEach(([symbol, series]) => this.sparklines.set(symbol, series));
        this.sparklinesUpdated.emit();
        break;
    }
  }

  setGaps(gaps: VenueGap[]) {
    this.gaps = new Map(gaps.map((g) => [g.symbol, g]));
    this.gapsUpdated.emit();
  }

  wallsFor(symbol: string): Wall[] {
    return this.wallsBySymbol.get(symbol) ?? [];
  }

  /** The wall closest to the price, which is the one a trader reacts to. */
  nearestWall(symbol: string): Wall | null {
    return this.wallsBySymbol.get(symbol)?.[0] ?? null;
  }

  setConnection(state: ConnectionState) {
    if (state !== this.connection) {
      this.connection = state;
      this.connectionChanged.emit(state);
    }
  }
}

/** A tab in the background lets its stream go after this long (see connect). */
export const RELEASE_HIDDEN_MS = 60_000;

/**
 * Keeps one WebSocket to the backend alive. The backend sends a fresh snapshot on every
 * connect, so a reconnect needs no catch-up logic on this side.
 *
 * A tab left in the background (a video watched, the terminal forgotten) closes its stream after
 * a minute and opens it again when looked at: the server has a client limit, and a forgotten tab
 * should not take the place of someone watching. `keepInBackground` says when the stream is needed
 * unseen: price alerts fire exactly in a hidden tab, and a recording must not lose its feed.
 */
export function connect(market: Market, url: string, keepInBackground: () => boolean = () => false) {
  let attempt = 0;
  let socket: WebSocket | null = null;
  let released = false;
  let releaseTimer: number | undefined;

  const open = () => {
    const ws = new WebSocket(url);
    socket = ws;
    let served = false;
    ws.onopen = () => market.setConnection('live');
    ws.onmessage = (event) => {
      // a full server accepts the socket and closes it before the snapshot: only data counts as a
      // working connection, or every refused visitor would knock again twice a second
      if (!served) {
        served = true;
        attempt = 0;
      }
      market.apply(JSON.parse(event.data) as StreamMessage);
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      market.setConnection('reconnecting');
      if (released) return;
      // 1013, try again later: the server is at its client limit; spread the retries out
      const floor = event.code === 1013 ? 5_000 + Math.random() * 5_000 : 0;
      const delay = Math.max(floor, Math.min(15_000, 500 * 2 ** attempt++));
      setTimeout(() => {
        if (!released && !socket) open();
      }, delay);
    };
  };

  document.addEventListener('visibilitychange', () => {
    clearTimeout(releaseTimer);
    if (document.hidden) {
      releaseTimer = window.setTimeout(() => {
        if (!document.hidden || keepInBackground()) return;
        released = true;
        // let go of it at once: if the tab comes back before the close completes, a new one opens
        const ws = socket;
        socket = null;
        ws?.close(1000, 'tab in the background');
        market.setConnection('reconnecting');
      }, RELEASE_HIDDEN_MS);
    } else if (released) {
      released = false;
      attempt = 0;
      if (!socket) open();
    }
  });

  open();
}
