// Inline SVG from Phosphor instead of the icon font: a couple of dozen icons do not justify
// ~150 KB of font, and inline SVG takes its colour from the text around it.
import arrowUpRight from '@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw';
import bell from '@phosphor-icons/core/assets/regular/bell.svg?raw';
import caretDownFill from '@phosphor-icons/core/assets/fill/caret-down-fill.svg?raw';
import caretLeft from '@phosphor-icons/core/assets/regular/caret-left.svg?raw';
import caretRight from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import caretUpFill from '@phosphor-icons/core/assets/fill/caret-up-fill.svg?raw';
import chartLineUp from '@phosphor-icons/core/assets/regular/chart-line-up.svg?raw';
import columns from '@phosphor-icons/core/assets/regular/columns.svg?raw';
import command from '@phosphor-icons/core/assets/regular/command.svg?raw';
import cornersIn from '@phosphor-icons/core/assets/regular/corners-in.svg?raw';
import cornersOut from '@phosphor-icons/core/assets/regular/corners-out.svg?raw';
import cursor from '@phosphor-icons/core/assets/regular/cursor.svg?raw';
import lineSegment from '@phosphor-icons/core/assets/regular/line-segment.svg?raw';
import link from '@phosphor-icons/core/assets/regular/link.svg?raw';
import list from '@phosphor-icons/core/assets/regular/list.svg?raw';
import magnifyingGlass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import minus from '@phosphor-icons/core/assets/regular/minus.svg?raw';
import rectangle from '@phosphor-icons/core/assets/regular/rectangle.svg?raw';
import ruler from '@phosphor-icons/core/assets/regular/ruler.svg?raw';
import squaresFour from '@phosphor-icons/core/assets/regular/squares-four.svg?raw';
import starFill from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import star from '@phosphor-icons/core/assets/regular/star.svg?raw';
import translate from '@phosphor-icons/core/assets/regular/translate.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import x from '@phosphor-icons/core/assets/regular/x.svg?raw';

const icon = (svg: string) => svg.replace('<svg ', '<svg class="icon" aria-hidden="true" focusable="false" ');

export const ICONS = {
  star: icon(star),
  starFill: icon(starFill),
  search: icon(magnifyingGlass),
  bell: icon(bell),
  indicators: icon(chartLineUp),
  expand: icon(cornersOut),
  collapse: icon(cornersIn),
  columns: icon(columns),
  prev: icon(caretLeft),
  next: icon(caretRight),
  up: icon(caretUpFill),
  down: icon(caretDownFill),
  close: icon(x),
  trash: icon(trash),
  cursor: icon(cursor),
  trend: icon(lineSegment),
  ray: icon(arrowUpRight),
  hline: icon(minus),
  rect: icon(rectangle),
  fib: icon(list),
  measure: icon(ruler),
  link: icon(link),
  command: icon(command),
  view: icon(squaresFour),
  translate: icon(translate),
};

export type IconName = keyof typeof ICONS;

/** Fills every `<span data-icon="name">` in the static HTML. */
export function mountIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon as IconName;
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}
