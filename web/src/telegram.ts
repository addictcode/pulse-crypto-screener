import { telegramLinks } from './api';
import { t } from './i18n';
import type { TelegramLinks } from './types';
import { hit } from './visit';

export interface TelegramTarget {
  kind: 'bot' | 'channel';
  /** The username, for places that show it as text, like the recording frame. */
  name: string;
  href: string;
  label: string;
}

/**
 * Where the buttons lead. The bot link carries `start=site`, so the bot can count a start that
 * came from these buttons. A link that is not set up gives no button at all.
 */
export function telegramTargets(links: TelegramLinks): TelegramTarget[] {
  const targets: TelegramTarget[] = [];
  if (links.bot) targets.push({ kind: 'bot', name: links.bot, href: `https://t.me/${encodeURIComponent(links.bot)}?start=site`, label: t('Signals in Telegram') });
  if (links.channel) targets.push({ kind: 'channel', name: links.channel, href: `https://t.me/${encodeURIComponent(links.channel)}`, label: t('Channel') });
  return targets;
}

let loaded: Promise<TelegramTarget[]> | null = null;

/** One request per page, however many places show the buttons. Never rejects: no links, no buttons. */
export function loadTelegramTargets(): Promise<TelegramTarget[]> {
  loaded ??= telegramLinks()
    .then(telegramTargets)
    .catch(() => []);
  return loaded;
}

/** An anchor for a target, counted as a step of the funnel when clicked. */
export function telegramAnchor(target: TelegramTarget, className: string, text = target.label): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = className;
  a.href = target.href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.tg = target.kind;
  a.textContent = text;
  a.addEventListener('click', () => hit(target.kind === 'bot' ? 'bot-click' : 'channel-click'));
  return a;
}

/** Fills a hidden container with the buttons and shows it, if there is anything to show. */
export async function mountTelegram(container: HTMLElement, className: string) {
  const targets = await loadTelegramTargets();
  if (!targets.length) return;
  container.replaceChildren(...targets.map((target) => telegramAnchor(target, className)));
  container.hidden = false;
}
