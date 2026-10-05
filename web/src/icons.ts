// Inline SVG from Phosphor instead of the icon font: three icons do not justify ~150 KB of font.
import magnifyingGlass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import starFill from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import star from '@phosphor-icons/core/assets/regular/star.svg?raw';

const icon = (svg: string) => svg.replace('<svg ', '<svg class="icon" aria-hidden="true" focusable="false" ');

export const ICONS = {
  star: icon(star),
  starFill: icon(starFill),
  search: icon(magnifyingGlass),
};
