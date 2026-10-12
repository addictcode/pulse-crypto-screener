import { ICONS } from './icons';
import { lang, setLang, t, type Lang } from './i18n';
import { load, save } from './storage';

const PREFIX = 'pulse.';
/** A settings file is a few kilobytes; anything much larger is not one. */
const MAX_FILE = 2_000_000;

type Store = Pick<Storage, 'length' | 'key' | 'getItem'>;

/** Everything Pulse keeps in this browser, as one object: the content of a settings file. */
export function exportData(store: Store, now: Date): string {
  const data: Record<string, unknown> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      data[key.slice(PREFIX.length)] = JSON.parse(store.getItem(key)!);
    } catch {
      // a value that is not JSON was not written by Pulse
    }
  }
  return JSON.stringify({ app: 'pulse', version: 1, saved: now.toISOString(), data }, null, 2);
}

/**
 * The entries of a settings file, or null when the text is not one. Nothing here is trusted: the
 * values are read back through the same checks as stored ones (see sanitizeLists and friends),
 * this only makes sure the file is ours and the keys are plain names.
 */
export function importData(text: string): Record<string, unknown> | null {
  if (text.length > MAX_FILE) return null;
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  const { app, data } = (file ?? {}) as { app?: unknown; data?: unknown };
  if (app !== 'pulse' || typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const entries = Object.entries(data).filter(([key]) => /^[A-Za-z][\w.]{0,63}$/.test(key));
  return entries.length ? Object.fromEntries(entries) : null;
}

const $ = (id: string) => document.getElementById(id)!;

/**
 * One place for what used to be scattered over the screen: language, the alert sound, the risk
 * the setup plan sizes positions from, the newcomer's tips, and a file that carries watchlists,
 * filters, drawings and alerts to another browser.
 */
export class Settings {
  private readonly dialog = $('settings') as HTMLDialogElement;
  private readonly note = $('set-note');
  private armed = 0;
  private readonly showTips: () => void;

  constructor(showTips: () => void) {
    this.showTips = showTips;
    $('settings-btn').addEventListener('click', () => this.open());
    // a click on the dimmed page around the sheet closes it
    this.dialog.addEventListener('click', (e) => e.target === this.dialog && this.dialog.close());
    $('set-close').addEventListener('click', () => this.dialog.close());

    this.dialog.querySelectorAll<HTMLButtonElement>('#set-lang [data-lang]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
      button.addEventListener('click', () => setLang(button.dataset.lang as Lang));
    });

    // the tape owns the sound and the chart owns the risk; this sheet presses their own controls
    const sound = $('set-sound');
    const tapeSound = $('tape-sound');
    const paintSound = () => {
      const on = tapeSound.getAttribute('aria-pressed') === 'true';
      sound.setAttribute('aria-pressed', String(on));
      sound.textContent = on ? t('On') : t('Off');
    };
    sound.addEventListener('click', () => {
      tapeSound.click();
      paintSound();
    });
    this.dialog.addEventListener('toggle', paintSound);

    const risk = $('set-risk') as HTMLInputElement;
    const planRisk = $('plan-risk') as HTMLInputElement;
    this.dialog.addEventListener('toggle', () => (risk.value = String(load('planRisk', 50))));
    risk.addEventListener('change', () => {
      const value = Number(risk.value.replace(',', '.'));
      if (!Number.isFinite(value) || value <= 0) {
        risk.value = String(load('planRisk', 50));
        return;
      }
      planRisk.value = String(value);
      planRisk.dispatchEvent(new Event('input', { bubbles: true }));
    });

    $('set-tips').addEventListener('click', () => {
      save('welcomed', false);
      this.dialog.close();
      this.showTips();
    });

    $('set-export').addEventListener('click', () => this.exportFile());
    const file = $('set-file') as HTMLInputElement;
    $('set-import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => void this.importFile(file));
    $('set-reset').addEventListener('click', () => this.reset());
  }

  open() {
    this.note.textContent = '';
    this.disarm();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private exportFile() {
    const now = new Date();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([exportData(localStorage, now)], { type: 'application/json' }));
    link.download = `pulse-settings-${now.toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    this.note.textContent = t('Saved. Open this file in Settings on the other device.');
  }

  private async importFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const data = file.size > MAX_FILE ? null : importData(await file.text());
    if (!data) {
      this.note.textContent = t('This is not a Pulse settings file.');
      return;
    }
    for (const [key, value] of Object.entries(data)) save(key, value);
    location.reload();
  }

  /** Erasing everything takes two clicks: the first only asks. */
  private reset() {
    const button = $('set-reset');
    if (!this.armed) {
      button.textContent = t('Click again to erase everything');
      button.classList.add('danger');
      this.armed = window.setTimeout(() => this.disarm(), 5_000);
      return;
    }
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(PREFIX))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      // no storage, nothing to erase
    }
    location.reload();
  }

  private disarm() {
    clearTimeout(this.armed);
    this.armed = 0;
    const button = $('set-reset');
    button.classList.remove('danger');
    button.innerHTML = `${ICONS.trash}<span>${t('Reset everything')}</span>`;
  }
}
