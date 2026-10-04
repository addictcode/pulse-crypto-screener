/** Tiny inline SVG of recent closes; the end dot is colored by direction over the window. */
export function sparkline(points: number[], width = 60, height = 18): string {
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const x = (i: number) => ((i * (width - 3)) / (points.length - 1)).toFixed(1);
  const y = (v: number) => (height - 2 - ((v - min) / (max - min || 1)) * (height - 4)).toFixed(1);
  const last = points[points.length - 1];
  const path = points.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
    `<polyline points="${path}" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>` +
    `<circle cx="${x(points.length - 1)}" cy="${y(last)}" r="1.8" fill="var(--${last >= points[0] ? 'up' : 'down'})"/></svg>`
  );
}
