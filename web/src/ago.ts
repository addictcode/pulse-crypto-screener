import { t } from './i18n';

/** A span of time in the largest unit that keeps it readable: 45 s, 12 min, 5 h, 3 d. */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 120) return t('{n} s', { n: s });
  const m = Math.round(s / 60);
  if (m < 120) return t('{n} min', { n: m });
  const h = Math.round(m / 60);
  return h < 48 ? t('{n} h', { n: h }) : t('{n} d', { n: Math.round(h / 24) });
}
