import { px } from './format';
import type { SetupResult } from './indicators';
import type { BacktestLine, StudyId } from './studies';
import { STUDIES } from './studies';
import { t } from './i18n';
import { load, save } from './storage';

/**
 * The Indicators dropdown in the chart bar. It only keeps the chosen set (and remembers it in
 * this browser); the chart decides what that means.
 */
export class IndicatorMenu {
  private readonly button = document.getElementById('ind-btn') as HTMLButtonElement;
  private readonly menu = document.getElementById('ind-menu')!;
  private readonly chosen = new Set<StudyId>(
    load<StudyId[]>('studies', ['ema']).filter((id) => STUDIES.some((s) => s.id === id)),
  );
  private readonly onChange: (ids: Set<StudyId>) => void;

  constructor(onChange: (ids: Set<StudyId>) => void) {
    this.onChange = onChange;
    this.render();
    this.button.addEventListener('click', () => this.toggle(this.menu.hidden !== false));
    this.menu.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      const id = box.value as StudyId;
      if (box.checked) this.chosen.add(id);
      else this.chosen.delete(id);
      save('studies', [...this.chosen]);
      this.renderCount();
      this.onChange(this.enabled);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !(e.target as HTMLElement).closest('.ind')) this.toggle(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.menu.hidden) {
        this.toggle(false);
        this.button.focus();
      }
    });
  }

  get enabled(): Set<StudyId> {
    return new Set(this.chosen);
  }

  private toggle(open: boolean) {
    this.menu.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.menu.querySelector<HTMLInputElement>('input')?.focus();
  }

  private renderCount() {
    const n = this.chosen.size;
    this.button.querySelector('.count')!.textContent = n ? String(n) : '';
  }

  private render() {
    const groups = [...new Set(STUDIES.map((s) => s.group))];
    this.menu.innerHTML =
      groups
        .map(
          (g) => `<fieldset><legend>${t(g)}</legend>${STUDIES.filter((s) => s.group === g)
            .map(
              (s) => `<label class="ind-item"><input type="checkbox" value="${s.id}"${this.chosen.has(s.id) ? ' checked' : ''}><span>${t(s.name)}</span><span class="hint">${t(s.hint)}</span></label>`,
            )
            .join('')}</fieldset>`,
        )
        .join('') +
      `<p class="ind-legend"><span class="dim"><i class="dash"></i>${t('walls')}</span><span class="dim"><i class="dot"></i>${t('liquidations')}</span><span class="hot"><i class="dot"></i>${t('signals')}</span><span class="amber"><i class="line"></i>${t('alerts')}</span></p>`;
    this.renderCount();
  }
}

/**
 * Pulse Setups in full: the trade it holds or what it is waiting for, and its record on the
 * candles loaded, after fees. The verdict is spelled out, because a 31% win rate reads as a
 * failure until one remembers the target is three times the stop.
 */
function renderPlan(r: SetupResult): string {
  const pct = (from: number, to: number) => `${to >= from ? '+' : '−'}${Math.abs(((to - from) / from) * 100).toFixed(2)}%`;
  let head: string;
  if (r.open) {
    const o = r.open;
    head = `<span class="plan-side ${o.dir === 1 ? 'up' : 'down'}">${o.dir === 1 ? t('Long') : t('Short')}</span>
      <span>${t('Entry')} <b>${px(o.entry)}</b></span>
      <span>${t('Stop')} <b>${px(o.stop)}</b> <i class="down">${pct(o.entry, o.stop)}</i></span>
      <span>${t('Target')} <b>${px(o.target)}</b> <i class="up">${pct(o.entry, o.target)}</i></span>
      <span class="mute">${t('{n} to 1', { n: 3 })}</span>
      <span class="${o.r >= 0 ? 'up' : 'down'} open">${t('now')} ${o.r >= 0 ? '+' : ''}${o.r.toFixed(2)}R</span>`;
  } else if (r.state) {
    const s = r.state;
    const checks: Array<[string, boolean]> = [
      [s.trend === 1 ? t('trend up') : s.trend === -1 ? t('trend down') : t('no trend'), s.trend !== 0],
      [t('coil'), s.coil],
      [t('breakout'), s.breakout],
      [t('volume'), s.volume],
      [t('room for fees'), s.room],
    ];
    head = `<span class="mute">${t('No trade. Waiting for')}</span>${checks
      .map(([label, met]) => `<span class="plan-check${met ? ' met' : ''}">${label}</span>`)
      .join('')}`;
  } else {
    head = `<span class="mute">${t('No trade right now')}</span>`;
  }
  const s = r.stats;
  const record = !s
    ? `<span class="mute">${t('no closed trades on these candles yet')}</span>`
    : `<span>${t('{n} trades', { n: s.trades })}</span>
      <span class="${s.winRate >= s.breakEven ? 'up' : 'down'}">${t('{n}% win', { n: s.winRate.toFixed(0) })}</span>
      <span class="mute">${t('break-even {n}%', { n: s.breakEven.toFixed(0) })}</span>
      <span class="${s.netR >= 0 ? 'up' : 'down'}">${s.netR >= 0 ? '+' : ''}${s.netR.toFixed(1)}R ${t('after fees')}</span>
      <span class="mute">${t('worst run −{n}R', { n: s.drawdown.toFixed(1) })}</span>
      <span class="plan-verdict">${s.trades < 8 ? t('too few trades to judge') : s.netR > 0 ? t('has paid on this chart') : t('has not paid on this chart')}</span>`;
  return `<div class="plan"><p><b>Pulse Setups</b>${head}</p><p class="plan-record" title="${t('Every past setup on these candles, one position at a time, stop checked before target')}">${record}</p></div>`;
}

/** One line per enabled strategy: how it would have done on the candles on screen. */
export function renderBacktest(el: HTMLElement, lines: BacktestLine[]) {
  el.hidden = !lines.length;
  const html = lines
    .map(({ id, name, result: r }) => {
      if (id === 'setups' && !r.tooFew) return renderPlan(r as SetupResult);
      if (r.tooFew) return `<p><b>${name}</b><span class="mute">${t('needs more history, pick a longer timeframe')}</span></p>`;
      if (!r.stats && !r.open) return `<p><b>${name}</b><span class="mute">${t('no setups on these candles')}</span></p>`;
      const s = r.stats;
      const open = r.open
        ? `<span class="${r.open.dir === 1 ? 'up' : 'down'} open">${r.open.dir === 1 ? t('Long open') : t('Short open')} ${r.open.r >= 0 ? '+' : ''}${r.open.r.toFixed(2)}R</span>`
        : '';
      if (!s) return `<p><b>${name}</b><span class="mute">${t('first setup is still open')}</span>${open}</p>`;
      const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞';
      return `<p title="${t('Every past setup on these candles, one position at a time, stop checked before target')}">
        <b>${name}</b>
        <span>${t('{n} trades', { n: s.trades })}</span>
        <span class="${s.winRate >= s.breakEven ? 'up' : 'down'}">${t('{n}% win', { n: s.winRate.toFixed(0) })}</span>
        <span class="mute">${t('break-even {n}%', { n: s.breakEven.toFixed(0) })}</span>
        <span>PF ${pf}</span>
        <span class="${s.netR >= 0 ? 'up' : 'down'}">${s.netR >= 0 ? '+' : ''}${s.netR.toFixed(1)}R</span>
        ${open}
      </p>`;
    })
    .join('');
  // rewritten only when something changed, so a hovered tooltip does not flicker on every tick
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
}
