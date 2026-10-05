import type { Liquidation, Signal, StreamMessage, SymbolMetrics, Wall } from './types';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

type Listener<T> = (payload: T) => void;

class Emitter<T> {
  private listeners: Listener<T>[] = [];
  on(listener: Listener<T>) {
    this.listeners.push(listener);
  }
  emit(payload: T) {
    this.listeners.forEach((l) => l(payload));
  }
}

const RECENT_LIQUIDATIONS = 60;
const RECENT_SIGNALS = 60;

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
  /** Every detected wall, nearest to its price first. */
  walls: Wall[] = [];
  /** Symbols with a live order book, and how far from the price that book is fully known. */
  readonly coverage = new Map<string, number>();
  private wallsBySymbol = new Map<string, Wall[]>();
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
  readonly connectionChanged = new Emitter<ConnectionState>();

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
        // on connect the server sends recent history; afterwards one signal at a time
        const known = new Set(this.signals.map((s) => s.id));
        const fresh = message.items.filter((s) => !known.has(s.id));
        this.signals = [...fresh, ...this.signals].sort((a, b) => b.time - a.time).slice(0, RECENT_SIGNALS);
        this.newSignals.emit(message.items.length === 1 ? fresh : []);
        break;
      }
      case 'sparklines':
        Object.entries(message.series).forEach(([symbol, series]) => this.sparklines.set(symbol, series));
        this.sparklinesUpdated.emit();
        break;
    }
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

/**
 * Keeps one WebSocket to the backend alive. The backend sends a fresh snapshot on every
 * connect, so a reconnect needs no catch-up logic on this side.
 */
export function connect(market: Market, url: string) {
  let attempt = 0;

  const open = () => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      market.setConnection('live');
    };
    ws.onmessage = (event) => market.apply(JSON.parse(event.data) as StreamMessage);
    ws.onclose = () => {
      market.setConnection('reconnecting');
      const delay = Math.min(15_000, 500 * 2 ** attempt++);
      setTimeout(open, delay);
    };
  };

  open();
}
