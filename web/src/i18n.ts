import { RU } from './locale-ru';
import { load, save } from './storage';

export type Lang = 'en' | 'ru';

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
  const saved = load<string | null>('lang', null);
  if (saved === 'en' || saved === 'ru') return saved;
  const browser = typeof navigator === 'undefined' ? '' : (navigator.language ?? '');
  return browser.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export const lang: Lang = detect();

/** `t('{n} walls', { n: 3 })`: translate, then fill the placeholders. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = lang === 'ru' ? (RU[text] ?? text) : text;
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
  el.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    button.addEventListener('click', () => {
      const next = button.dataset.lang as Lang;
      if (next === lang) return;
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
