// Search engines see what the HTML says before any script runs. This plugin gives the public pages
// (the landing, the record, the game) a Russian twin at /ru/... with the Russian text already in
// the HTML, and links the two with canonical and hreflang. Addresses must be absolute, but the
// domain is known only where the site runs (a tunnel today, a server tomorrow, images built in CI),
// so they are written as https://{{.Host}}/... and Caddy fills the host in as it serves the page
// (the templates directive in Caddyfile). The demo on GitHub Pages is a copy of the real site: it
// is marked noindex instead.
import type { Plugin, ViteDevServer } from 'vite';

/** Pages with a Russian twin, by their path in the build. */
export const LOCALIZED = ['index.html', 'record/index.html', 'play/index.html'];

const HOST = 'https://{{.Host}}';

const unescapeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

/** The page's public path: index.html → "", record/index.html → "record/". */
export const pathOf = (file: string) => file.replace(/index\.html$/, '');

/**
 * The HTML with Russian text in place of the English: the same keys the page translates at run
 * time (data-i18n text, data-i18n-html markup, data-i18n-attrs attributes and the title).
 */
export function translateHtml(html: string, dict: Record<string, string>): string {
  const tr = (key: string) => dict[key.trim()];
  let out = html.replace(/<title>([^<]*)<\/title>/, (m, text: string) => (tr(unescapeHtml(text)) ? `<title>${escapeText(tr(unescapeHtml(text))!)}</title>` : m));
  out = out.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n(?=[\s>])[^>]*>)([^<]*)(<\/\2>)/g, (m, open: string, _tag: string, text: string, close: string) => {
    const ru = tr(unescapeHtml(text));
    return ru ? `${open}${escapeText(ru)}${close}` : m;
  });
  out = out.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n-html[^>]*>)(.*?)(<\/\2>)/g, (m, open: string, _tag: string, inner: string, close: string) => {
    const ru = tr(inner);
    return ru ? `${open}${ru}${close}` : m;
  });
  out = out.replace(/<[a-z0-9]+\b[^>]*\sdata-i18n-attrs="([^"]*)"[^>]*>/g, (tag: string, names: string) => {
    let t = tag;
    for (const name of names.split(',').map((n) => n.trim())) {
      t = t.replace(new RegExp(`(\\s${name}=")([^"]*)(")`), (m, a: string, value: string, b: string) => {
        const ru = tr(unescapeHtml(value));
        return ru ? `${a}${escapeAttr(ru)}${b}` : m;
      });
    }
    return t;
  });
  return out.replace(/<html lang="en"/, '<html lang="ru" data-page-lang="ru"');
}

/**
 * A page moved one folder down (ru/...): links to the pages without a twin (the terminal) and to
 * the build's files go one level up; links between localized pages stay inside /ru/.
 */
export function deeper(html: string): string {
  return html.replace(/(\s(?:href|src)=")(?!\/|#|[a-z]+:)((?:\.\.\/|\.\/)*)(app\/|assets\/)/g, (_m, attr: string, ups: string, target: string) => `${attr}../${ups.replace(/(?<!\.)\.\//g, '')}${target}`);
}

/** canonical, hreflang and, on the landing, what the site is in schema.org terms. */
export function headTags(file: string, ru: boolean, standalone: boolean): string {
  if (standalone) return '<meta name="robots" content="noindex">';
  const path = pathOf(file);
  const en = `${HOST}/${path}`;
  const rus = `${HOST}/ru/${path}`;
  const tags = [
    `<link rel="canonical" href="${ru ? rus : en}">`,
    `<link rel="alternate" hreflang="en" href="${en}">`,
    `<link rel="alternate" hreflang="ru" href="${rus}">`,
    `<link rel="alternate" hreflang="x-default" href="${en}">`,
    `<meta property="og:url" content="${ru ? rus : en}">`,
    `<meta property="og:locale" content="${ru ? 'ru_RU' : 'en_US'}">`,
  ];
  if (file === 'index.html') {
    const app = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Pulse',
      url: ru ? rus : en,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      inLanguage: ru ? 'ru' : 'en',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      description: ru
        ? 'Скринер фьючерсов Binance: пампы, всплески объёма, ликвидации и стены в стакане в момент события. Не прогноз и не финансовый совет.'
        : 'A screener for Binance futures: pumps, volume bursts, liquidations and order book walls as they happen. Not a forecast, not financial advice.',
    };
    tags.push(`<script type="application/ld+json">${JSON.stringify(app)}</script>`);
  }
  return tags.join('\n');
}

/** Where the language switch of a page leads: its twin, relative to the page itself. */
export function twinOf(file: string, ru: boolean): string {
  const depth = file.split('/').length - 1;
  return ru ? `${'../'.repeat(depth + 1)}${pathOf(file)}` : `${'../'.repeat(depth)}ru/${pathOf(file)}`;
}

function decorate(html: string, file: string, ru: boolean, standalone: boolean): string {
  return html
    .replace('</head>', `${headTags(file, ru, standalone)}\n</head>`)
    .replace(/(<[^>]*\sid="lang")/, `$1 data-twin="${twinOf(file, ru)}"`);
}

/** The Russian page from the finished English one. */
export function russianTwin(english: string, file: string, dict: Record<string, string>, standalone: boolean): string {
  return deeper(translateHtml(english, dict))
    .replace(headTags(file, false, standalone), headTags(file, true, standalone))
    .replace(`data-twin="${twinOf(file, false)}"`, `data-twin="${twinOf(file, true)}"`);
}

/**
 * The Russian dictionary is loaded on demand (i18n.ts), so an English visitor never downloads it;
 * a Russian twin asks for it at once, alongside its own script, instead of one round trip later.
 */
function preloadRussian(html: string, bundle: Record<string, { type: string; facadeModuleId?: string | null; fileName: string }>): string {
  const chunk = Object.values(bundle).find((c) => c.type === 'chunk' && c.facadeModuleId?.endsWith('/locale-ru.ts'));
  const script = html.match(/<script type="module" crossorigin src="([^"]*?)assets\//);
  if (!chunk || !script) return html;
  return html.replace(script[0], `<link rel="modulepreload" crossorigin href="${script[1]}${chunk.fileName}">\n    ${script[0]}`);
}

export function seoPages(dict: Record<string, string>, standalone: boolean): Plugin {
  const fileOf = (path: string) => (path.replace(/^\//, '') || 'index.html').replace(/\/$/, '/index.html');
  return {
    name: 'pulse-seo',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const file = fileOf(ctx.path);
        return LOCALIZED.includes(file) ? decorate(html, file, false, standalone) : html;
      },
    },
    // the build: a Russian twin of each localized page next to the English one, written after
    // Vite has written the English pages (they are not in the bundle any earlier)
    async writeBundle(options, bundle) {
      const { mkdir, readFile, writeFile } = await import('node:fs/promises');
      const { dirname, join } = await import('node:path');
      const dir = options.dir!;
      // the demo is not the site: nothing to list for search engines there
      if (standalone) await import('node:fs/promises').then((fs) => fs.rm(join(dir, 'sitemap.xml'), { force: true }));
      for (const file of LOCALIZED) {
        let english: string;
        try {
          english = await readFile(join(dir, file), 'utf8');
        } catch {
          continue;
        }
        await mkdir(dirname(join(dir, 'ru', file)), { recursive: true });
        await writeFile(join(dir, 'ru', file), preloadRussian(russianTwin(english, file, dict, standalone), bundle));
      }
    },
    // the dev server: /ru/... is the English page translated on the fly
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith('/ru/')) return next();
        const file = fileOf(url.slice(3));
        if (!LOCALIZED.includes(file)) return next();
        const { readFile } = await import('node:fs/promises');
        try {
          const source = await readFile(new URL(file, `file://${server.config.root}/`), 'utf8');
          const html = await server.transformIndexHtml(`/${pathOf(file)}`, source);
          const russian = russianTwin(html, file, dict, standalone);
          res.setHeader('Content-Type', 'text/html');
          res.end(russian);
        } catch {
          next();
        }
      });
    },
  };
}
