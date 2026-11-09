import { STANDALONE } from './api';
import { lang, t } from './i18n';
import { load, save } from './storage';
import type { Watchlist } from './watchlists';

/** What this browser asked for: nothing, the pairs on its watchlists, or strong signals anywhere. */
export type PushMode = 'off' | 'watchlist' | 'strong';

/** An iPhone or iPad only gets web push from a site added to the Home Screen and opened from there. */
export function needsHomeScreen(ua: string, standalone: boolean): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
  return ios && !standalone;
}

/** The pairs of every watchlist, once each. */
export function watchedSymbols(lists: Watchlist[] | null): string[] {
  return [...new Set((lists ?? []).flatMap((l) => l.symbols))].slice(0, 50);
}

/** VAPID keys come base64url; PushManager wants the bytes. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function serverKey(): Promise<string | null> {
  try {
    const response = await fetch('/api/push/key');
    return response.ok ? ((await response.json()) as { key: string }).key : null;
  } catch {
    return null;
  }
}

/**
 * The "Notifications" row of the settings. Shown only where it can work: a server with VAPID keys,
 * a browser with the Push API. Nothing is asked of the browser until the visitor picks a mode.
 */
export async function mountPush() {
  const row = document.getElementById('set-push-row');
  const select = document.getElementById('set-push') as HTMLSelectElement | null;
  const note = document.getElementById('set-push-note');
  if (!row || !select || !note || STANDALONE) return;
  const key = await serverKey();
  if (!key) return;
  row.hidden = false;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (needsHomeScreen(navigator.userAgent, standalone)) {
    select.disabled = true;
    note.textContent = t('On an iPhone, notifications work once Pulse is on the Home Screen: Share, then Add to Home Screen, then open it from there.');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    select.disabled = true;
    note.textContent = t('This browser cannot show notifications from a site.');
    return;
  }
  select.value = load<PushMode>('pushMode', 'off');

  select.addEventListener('change', async () => {
    const mode = select.value as PushMode;
    note.textContent = '';
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      if (mode === 'off') {
        if (existing) {
          await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) });
          await existing.unsubscribe();
        }
        save('pushMode', 'off');
        return;
      }
      if ((await Notification.requestPermission()) !== 'granted') {
        select.value = 'off';
        note.textContent = t('Notifications are blocked for this site in the browser settings.');
        return;
      }
      const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const symbols = mode === 'watchlist' ? watchedSymbols(load<Watchlist[] | null>('watchlists', null)) : [];
      if (mode === 'watchlist' && !symbols.length) note.textContent = t('Your watchlists are empty: add pairs with the star first.');
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...subscription.toJSON(), symbols, strongOnly: mode === 'strong', lang }),
      });
      if (!response.ok) throw new Error(String(response.status));
      save('pushMode', mode);
      if (!note.textContent) note.textContent = t('Done. At most a few notifications an hour.');
    } catch {
      select.value = load<PushMode>('pushMode', 'off');
      note.textContent = t('Notifications could not be turned on. Try again later.');
    }
  });
}
