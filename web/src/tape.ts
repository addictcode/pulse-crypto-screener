import { base, hms, pct, usd } from './format';
import { t } from './i18n';
import { signalDetail, signalTitle } from './signal-text';
import type { Market } from './market';
import { load, save } from './storage';
import type { Signal, TapeItem, TapeKind } from './types';

const KINDS: Record<TapeKind, [string, 'up' | 'down' | 'hot']> = {
  PUMP_1M: [t('Pump 1m'), 'up'],
  PUMP_5M: [t('Pump 5m'), 'up'],
  DUMP_1M: [t('Dump 1m'), 'down'],
  DUMP_5M: [t('Dump 5m'), 'down'],
  VOLUME: [t('Volume'), 'hot'],
  OI_UP: [t('OI up'), 'up'],
  OI_DOWN: [t('OI down'), 'down'],
  LIQ_LONGS: [t('Longs rekt'), 'down'],
  LIQ_SHORTS: [t('Shorts rekt'), 'up'],
};

const ALERT_TONE: Record<Signal['type'], 'up' | 'down' | 'hot'> = {
  PUMP: 'up', DUMP: 'down', VOLUME: 'hot', OPEN_INTEREST: 'hot', FUNDING: 'hot', LIQUIDATIONS: 'down', WALL: 'hot',
};

const VISIBLE = 80;
const BEEP_GAP_MS = 1_200;

type Row = { time: number; html: string; key: string };

const $ = (id: string) => document.getElementById(id)!;

/**
 * The live feed in the spirit of v1: everything that moves, one line each, newest on top.
 * Curated alerts (the stored, Telegram-grade signals) run in the same stream with an accent edge.
 */
export class Tape {
  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;
  private sound = load('sound', false);
  private audio: AudioContext | null = null;
  private lastBeep = 0;

  constructor(market: Market, onSelect: (symbol: string) => void) {
    this.market = market;
    this.onSelect = onSelect;
    market.newTape.on((fresh) => this.render(fresh.map(itemKey), fresh));
    market.newSignals.on((fresh) => this.render(fresh.map((s) => `s${s.id}`), [], fresh));
    $('tape').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-sym]');
      if (row) this.onSelect(row.dataset.sym!);
    });
    const toggle = $('tape-sound');
    const paint = () => {
      toggle.textContent = this.sound ? t('Sound on') : t('Sound off');
      toggle.setAttribute('aria-pressed', String(this.sound));
    };
    toggle.addEventListener('click', () => {
      this.sound = !this.sound;
      save('sound', this.sound);
      paint();
      if (this.sound) this.beep(880); // also unlocks audio, which browsers allow only after a click
    });
    paint();
    this.render([], []);
  }

  private render(freshKeys: string[], freshTape: TapeItem[], freshSignals: Signal[] = []) {
    const rows: Row[] = [
      ...this.market.tape.map((t) => ({ time: t.time, key: itemKey(t), html: tapeRow(t) })),
      ...this.market.signals.map((s) => ({ time: s.time, key: `s${s.id}`, html: alertRow(s) })),
    ]
      .sort((a, b) => b.time - a.time)
      .slice(0, VISIBLE);
    const fresh = new Set(freshKeys);
    $('tape').innerHTML = rows.length
      ? rows.map((r) => (fresh.has(r.key) ? r.html.replace('class="tape-row', 'class="tape-row enter') : r.html)).join('')
      : `<li class="empty-note">${t('Waiting for the market to move.')}</li>`;
    const minute = this.market.tape.filter((t) => t.time > Date.now() - 60_000).length;
    $('tape-meta').textContent = t('{n} / min', { n: minute });

    if (this.sound && (freshSignals.length || freshTape.some((t) => t.kind.startsWith('PUMP') || t.kind.startsWith('DUMP')))) {
      const up = freshSignals.length ? ALERT_TONE[freshSignals[0].type] !== 'down' : freshTape.some((t) => t.kind.startsWith('PUMP'));
      this.beep(up ? 1046 : 523);
    }
  }

  /** A short blip; pitch says up or down. Throttled so a burst is not a siren. */
  private beep(frequency: number) {
    const now = performance.now();
    if (now - this.lastBeep < BEEP_GAP_MS) return;
    this.lastBeep = now;
    try {
      this.audio ??= new AudioContext();
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.type = 'square';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.04, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audio.currentTime + 0.12);
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      osc.stop(this.audio.currentTime + 0.13);
    } catch {
      // no audio available; the tape still works silently
    }
  }
}

const itemKey = (t: TapeItem) => `${t.time}:${t.symbol}:${t.kind}`;

export function tapeRow(t: TapeItem) {
  const [label, tone] = KINDS[t.kind];
  const value =
    t.kind === 'VOLUME' ? `×${t.value.toFixed(1)}` : t.kind.startsWith('LIQ') ? usd(t.value) : pct(t.value, 2);
  return `<li class="tape-row" data-sym="${t.symbol}"><time>${hms(t.time)}</time><span class="s">${base(t.symbol)}</span><span class="badge ${tone}">${label}</span><span class="v ${tone}">${value}</span></li>`;
}

export function alertRow(s: Signal) {
  return `<li class="tape-row alert" data-sym="${s.symbol}" title="${escape(signalDetail(s))}"><time>${hms(s.time)}</time><span class="s">${base(s.symbol)}</span><span class="badge ${ALERT_TONE[s.type]}">${t('Alert')}</span><span class="v">${escape(signalTitle(s))}</span></li>`;
}

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
