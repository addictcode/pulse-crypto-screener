// What client-errors.ts loads on a page's first uncaught error: the report goes to the server
// (POST /api/client-errors), which counts it by fingerprint and tells the owner once a day what is
// new. Nothing that identifies the visitor: the message, the top of the stack, the page path
// without query or fragment, the build and the language. At most five a tab, each error once.

export const MAX_PER_TAB = 5;
const KEY = 'pulse.errorsSent';

export interface ClientErrorReport {
  message: string;
  stack: string;
  page: string;
  build: string;
  lang: string;
}

/** Noise that is not ours: extensions, cross-origin scripts without details, a browser quirk. */
export function ignorable(message: string, stack: string): boolean {
  return (
    /^(Script error\.?|ResizeObserver loop)/.test(message) ||
    /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack) ||
    /(chrome|moz|safari(-web)?)-extension:\/\//.test(message)
  );
}

/** What is sent: cut to size, the page reduced to its path. */
export function report(error: unknown, fallback: string, where: Location, lang: string, build: string): ClientErrorReport {
  const e = error instanceof Error ? error : null;
  const message = (e ? `${e.name}: ${e.message}` : typeof error === 'string' ? error : fallback || String(error)).slice(0, 500);
  const stack = (e?.stack ?? '').split('\n').slice(0, 12).join('\n').slice(0, 2_000);
  return { message, stack, page: where.pathname.slice(0, 100), build, lang: lang.slice(0, 5) };
}

function sentSoFar(): number {
  try {
    return Number(sessionStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function countSent(n: number) {
  try {
    sessionStorage.setItem(KEY, String(n));
  } catch {
    // private mode: the in-memory set still keeps a page from repeating itself
  }
}

/** Takes an uncaught error or rejection; the first call sets up the tab's limits. */
export function makeHandler(send: (r: ClientErrorReport) => void = post) {
  const seen = new Set<string>();
  let sent = sentSoFar();
  return (error: unknown, fallback: string) => {
    if (sent >= MAX_PER_TAB) return;
    const r = report(error, fallback, location, document.documentElement.lang || 'en', import.meta.env.VITE_BUILD ?? 'dev');
    if (ignorable(r.message, r.stack)) return;
    const key = `${r.message}\n${r.stack.split('\n')[1] ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    countSent(++sent);
    send(r);
  };
}

export const handle = makeHandler();

function post(r: ClientErrorReport) {
  // keepalive: an error on the way out of the page is still delivered; failures are not reported again
  fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r), keepalive: true }).catch(
    () => undefined,
  );
}
