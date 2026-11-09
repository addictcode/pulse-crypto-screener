// Errors no code caught on a visitor's page are reported to the server; the owner gets a daily
// summary of what is new (README, «Ошибки браузера с прода»). Imported first by every page, so it
// listens before the rest runs. Only the listener lives in the page: the code that builds and
// sends a report loads on the first error, so a page that works pays nothing for it. The demo
// build has no server and listens to nothing.
type Handle = (error: unknown, fallback: string) => void;

let handler: Promise<Handle> | undefined;
const handle = (error: unknown, fallback: string) => {
  handler ??= import('./client-errors-report').then((m) => m.handle);
  handler.then((h) => h(error, fallback)).catch(() => undefined);
};

if (import.meta.env.VITE_STANDALONE !== '1' && typeof window !== 'undefined' && !import.meta.env.VITEST) {
  addEventListener('error', (e) => handle(e.error, e.message));
  addEventListener('unhandledrejection', (e) => handle(e.reason, 'Unhandled rejection'));
}
