import { continueRender, delayRender, staticFile } from 'remotion';

// Pulse's own type, the same files the site uses: Unbounded for headlines, Onest for the rest.
const FACES = [
  ['Unbounded', 'unbounded-latin-wght-normal.woff2', 'U+0000-00FF, U+2010-2027, U+2212'],
  ['Unbounded', 'unbounded-cyrillic-wght-normal.woff2', 'U+0400-04FF'],
  ['Onest', 'onest-latin-wght-normal.woff2', 'U+0000-00FF, U+2010-2027, U+2212'],
  ['Onest', 'onest-cyrillic-wght-normal.woff2', 'U+0400-04FF'],
] as const;

const style = document.createElement('style');
style.textContent = FACES.map(
  ([family, file, range]) =>
    `@font-face { font-family: ${family}; src: url(${staticFile(file)}) format('woff2'); font-weight: 100 900; unicode-range: ${range}; }`,
).join('\n');
document.head.append(style);

// no frame is taken before both faces, in both scripts, are ready
const handle = delayRender('Loading fonts');
Promise.all(['800 40px Unbounded', '400 40px Onest'].map((font) => document.fonts.load(font, 'Aa Яя 0')))
  .then(() => continueRender(handle))
  .catch(() => continueRender(handle));
