import { RU } from './locale-ru';
import { load, save } from './storage';

export type Lang = 'en' | 'ru' | 'es' | 'tr';

/** Draft translations, for the public pages only; loaded only by those who read them. */
const DRAFTS: Partial<Record<Lang, () => Promise<Record<string, string>>>> = {
  es: () => import('./locale-es').then((m) => m.ES),
  tr: () => import('./locale-tr').then((m) => m.TR),
};

/**
 * The languages this page speaks: the public pages list theirs in <html data-langs>, the terminal
 * speaks English and Russian (a full translation of it into more is a decision of its own).
 */
function pageLangs(): Lang[] {
  const listed = typeof document === 'undefined' ? '' : (document.documentElement.dataset.langs ?? '');
  return (listed ? listed.split(/\s+/) : ['en', 'ru']) as Lang[];
}

/**
 * English is the source language: the text in the code and in the HTML is the key, and the
 * Russian dictionary maps it to a translation. A missing entry falls back to English, and a test
 * checks that nothing is missing.
 */
function detect(): Lang {
  // a Russian twin (/ru/...) is Russian whatever the browser says: its text is already in the HTML
  // (and the terminal opened from it follows)
  if (typeof document !== 'undefined' && document.documentElement.dataset.pageLang === 'ru') {
    save('lang', 'ru');
    return 'ru';
  }
  const langs = pageLangs();
  const saved = load<string | null>('lang', null);
  if (saved && (langs as string[]).includes(saved)) return saved as Lang;
  const browser = (typeof navigator === 'undefined' ? '' : (navigator.language ?? '')).toLowerCase().slice(0, 2);
  return (langs as string[]).includes(browser) ? (browser as Lang) : 'en';
}

export const lang: Lang = detect();
/** Whether the words on screen are a draft translation (the footer says so). */
export const draft = lang in DRAFTS;
const dict: Record<string, string> = lang === 'ru' ? RU : draft ? await DRAFTS[lang]!() : {};

/** `t('{n} walls', { n: 3 })`: translate, then fill the placeholders. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = dict[text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (_match: string, key: string) => String(vars[key] ?? '')) : out;
}

/** Every component reads the language once, so a switch reloads instead of re-rendering each of them. */
export function setLang(next: Lang) {
  if (next === lang) return;
  save('lang', next);
  location.reload();
}

/**
 * Translates the static HTML: the text of `data-i18n` elements and the attributes listed in
 * `data-i18n-attrs="title,aria-label"`.
 */
export function localize(root: ParentNode = document) {
  document.documentElement.lang = lang;
  if (draft && root === document) {
    const note = document.createElement('span');
    note.className = 'draft-note';
    note.textContent = lang === 'es' ? 'Traducción preliminar' : 'Ön çeviri';
    document.querySelector('.foot')?.append(note);
  }
  document.title = t(document.title);
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t((el.textContent ?? '').trim());
  });
  // headings with markup inside: the key is the HTML itself
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.innerHTML.trim());
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attrs]').forEach((el) => {
    for (const name of el.dataset.i18nAttrs!.split(',')) {
      const value = el.getAttribute(name.trim());
      if (value) el.setAttribute(name.trim(), t(value));
    }
  });
}

/**
 * The EN / RU switch. A page with a twin in the other language (data-twin, set by seo.ts) goes to
 * it: two addresses a search engine can see. The terminal has no twin and reloads in place.
 */
export function mountLangSwitch(el: HTMLElement) {
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('[data-lang]')];
  // on a phone the four languages do not fit next to the terminal button: the switch shows only the
  // current one (landing.css), and tapping it unfolds the others below it
  const folded = () => buttons.some((b) => getComputedStyle(b).display === 'none');
  const fold = (open: boolean) => {
    el.classList.toggle('open', open);
    buttons.find((b) => b.dataset.lang === lang)?.setAttribute('aria-expanded', String(open));
  };
  let row = 0;
  for (const button of buttons) if (button.dataset.lang !== lang) button.style.setProperty('--row', String(row++));
  document.addEventListener('click', (e) => {
    if (el.classList.contains('open') && !el.contains(e.target as Node)) fold(false);
  });
  buttons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    button.addEventListener('click', () => {
      const next = button.dataset.lang as Lang;
      if (next === lang) {
        if (el.classList.contains('open') || folded()) fold(!el.classList.contains('open'));
        return;
      }
      fold(false);
      const twin = el.dataset.twin;
      // the English page of a visitor who reads Russian is translated in place, not a twin
      const onTwin = document.documentElement.dataset.pageLang === 'ru';
      if (twin && (next === 'ru' || onTwin)) {
        save('lang', next);
        location.href = new URL(twin, location.href).href + location.hash;
      } else {
        setLang(next);
      }
    });
  });
}
