// Per-browser preferences. Storage can be missing or throw (private mode, blocked site data),
// so every access is guarded and the app works without it. Once accounts exist, the watchlist
// moves to the backend and this stays for purely local things like the last timeframe.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pulse.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`pulse.${key}`, JSON.stringify(value));
  } catch {
    // preferences are a convenience, losing them is fine
  }
}
