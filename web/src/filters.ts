import { t } from './i18n';
import type { SymbolMetrics, VenueGap, Wall } from './types';

export type Metric =
  | 'ch5m' | 'ch15m' | 'ch1h' | 'ch24h' | 'vol24h' | 'surge' | 'natr' | 'funding' | 'oiCh15m' | 'liq5m' | 'wall' | 'fgap';

/** `abs` compares the size of the number whatever its sign: "moved at least 3% either way". */
export type Op = 'gte' | 'lte' | 'abs';

export interface Rule {
  metric: Metric;
  op: Op;
  value: number;
}

/** A screener preset the user built: a pair passes when every rule holds. */
export interface CustomPreset {
  id: string;
  name: string;
  rules: Rule[];
}

export const MAX_RULES = 5;
export const MAX_PRESETS = 8;

interface MetricInfo {
  id: Metric;
  label: string;
  /** What the number the user types is measured in. */
  unit: string;
  /** Typed value times this is the stored figure: volume is typed in millions. */
  scale: number;
}

export const METRICS: MetricInfo[] = [
  { id: 'ch5m', label: t('Change 5m'), unit: '%', scale: 1 },
  { id: 'ch15m', label: t('Change 15m'), unit: '%', scale: 1 },
  { id: 'ch1h', label: t('Change 1h'), unit: '%', scale: 1 },
  { id: 'ch24h', label: t('Change 24h'), unit: '%', scale: 1 },
  { id: 'vol24h', label: t('Volume 24h'), unit: '$M', scale: 1e6 },
  { id: 'surge', label: t('Volume surge'), unit: '×', scale: 1 },
  { id: 'natr', label: 'NATR', unit: '%', scale: 1 },
  { id: 'funding', label: t('Funding'), unit: '%', scale: 1 },
  { id: 'oiCh15m', label: t('OI change 15m'), unit: '%', scale: 1 },
  { id: 'liq5m', label: t('Liquidations 5m'), unit: '$K', scale: 1e3 },
  { id: 'wall', label: t('Distance to a wall'), unit: '%', scale: 1 },
  { id: 'fgap', label: t('Funding gap vs Bybit'), unit: '%', scale: 1 },
];

export const OPS: Array<[Op, string]> = [['gte', '≥'], ['lte', '≤'], ['abs', '|x| ≥']];

const scaleOf = (metric: Metric) => METRICS.find((m) => m.id === metric)?.scale ?? 1;

/** The figure a rule looks at, or null while it is not known for this pair. */
export function metricValue(metric: Metric, row: SymbolMetrics, wall: Wall | null, gap: VenueGap | undefined): number | null {
  if (metric === 'wall') return wall ? Math.abs(wall.distance) : null;
  if (metric === 'fgap') return gap?.spread8h ?? null;
  return row[metric];
}

/** Every rule holds. A pair with a figure still unknown does not pass: no data is not a match. */
export function matches(rules: Rule[], row: SymbolMetrics, wall: Wall | null, gap: VenueGap | undefined): boolean {
  return rules.every((rule) => {
    const value = metricValue(rule.metric, row, wall, gap);
    if (value === null) return false;
    const threshold = rule.value * scaleOf(rule.metric);
    return rule.op === 'gte' ? value >= threshold : rule.op === 'lte' ? value <= threshold : Math.abs(value) >= threshold;
  });
}

/** Whatever is in storage, reduced to presets this version understands. */
export function sanitize(raw: unknown): CustomPreset[] {
  if (!Array.isArray(raw)) return [];
  const metrics = new Set<string>(METRICS.map((m) => m.id));
  const ops = new Set<string>(OPS.map(([op]) => op));
  const presets: CustomPreset[] = [];
  for (const item of raw as Array<Partial<CustomPreset>>) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.rules)) continue;
    const rules = item.rules
      .filter((r) => r && metrics.has(r.metric) && ops.has(r.op) && Number.isFinite(r.value))
      .slice(0, MAX_RULES)
      .map((r) => ({ metric: r.metric, op: r.op, value: r.value }));
    if (rules.length && item.name.trim()) presets.push({ id: item.id, name: item.name.trim().slice(0, 24), rules });
  }
  return presets.slice(0, MAX_PRESETS);
}

/** "5,5" and "5.5" both mean five and a half; anything else is not a number. */
export function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(',', '.').replace(/\s/g, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
