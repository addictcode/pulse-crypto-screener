import { RU } from './locale-ru';
import { load, save } from './storage';

export type Lang = 'en' | 'ru';

/**
 * English is the source language: the text in the code and in the HTML is the key, and the
 * Russian dictionary maps it to a translation. A missing entry falls back to English, and a test
 * checks that nothing is missing.
 */
function detect(): Lang {
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

/** The EN / RU switch. */
export function mountLangSwitch(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    button.addEventListener('click', () => setLang(button.dataset.lang as Lang));
  });
}
