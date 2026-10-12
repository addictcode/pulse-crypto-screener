import { load, save } from './storage';

interface Saved {
  /** Width of the pair list and height of the feeds under the chart, in pixels; absent means the default. */
  list?: number;
  dock?: number;
  listOff?: boolean;
  dockOff?: boolean;
}

const MIN_LIST = 260;
const MIN_DOCK = 90;
/** Neither side panel may take more than this share of the desk: the chart is the point of the screen. */
const MAX_SHARE = 0.6;

export const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

/**
 * The terminal's panes are the user's to arrange: the borders of the chart can be dragged, and
 * the pair list and the feeds under the chart can each be put away to give the chart the room.
 * Sizes are kept in this browser. A phone has one column and none of this applies there.
 */
export class Layout {
  private readonly desk = document.querySelector<HTMLElement>('.desk')!;
  private readonly root = document.documentElement;
  private readonly state: Saved = load<Saved>('layout', {});

  constructor() {
    this.desk.insertAdjacentHTML('beforeend', '<div class="sash sash-v" data-pane="list"></div><div class="sash sash-h" data-pane="dock"></div>');
    this.desk.querySelectorAll<HTMLElement>('.sash').forEach((handle) => this.bind(handle, handle.dataset.pane as 'list' | 'dock'));
    document.getElementById('list-btn')!.addEventListener('click', () => this.toggleList());
    document.getElementById('dock-btn')!.addEventListener('click', () => this.toggleDock());
    this.apply();
  }

  toggleList() {
    this.state.listOff = !this.state.listOff;
    this.commit();
  }

  toggleDock() {
    this.state.dockOff = !this.state.dockOff;
    this.commit();
  }

  /** "All columns" needs the list on screen. */
  showList() {
    if (!this.state.listOff) return;
    this.state.listOff = false;
    this.commit();
  }

  private commit() {
    save('layout', this.state);
    this.apply();
  }

  private apply() {
    const { list, dock, listOff, dockOff } = this.state;
    const size = (name: 'list' | 'dock', value: number | undefined) => {
      if (value) {
        this.root.style.setProperty(`--${name}-custom`, `${value}px`);
        this.root.dataset[`${name}Size`] = '';
      } else {
        this.root.style.removeProperty(`--${name}-custom`);
        delete this.root.dataset[`${name}Size`];
      }
    };
    size('list', list);
    size('dock', dock);
    const flag = (name: 'nolist' | 'nodock', on: boolean | undefined, button: string) => {
      if (on) document.body.dataset[name] = '';
      else delete document.body.dataset[name];
      document.getElementById(button)!.setAttribute('aria-pressed', String(!on));
    };
    flag('nolist', listOff, 'list-btn');
    flag('nodock', dockOff, 'dock-btn');
  }

  /** Dragging a border resizes the pane behind it; a double click gives the default size back. */
  private bind(handle: HTMLElement, pane: 'list' | 'dock') {
    const measure = (e: PointerEvent) => {
      const box = this.desk.getBoundingClientRect();
      return pane === 'list'
        ? clamp(box.right - e.clientX, MIN_LIST, box.width * MAX_SHARE)
        : clamp(box.bottom - e.clientY, MIN_DOCK, box.height * MAX_SHARE);
    };
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('on');
      document.body.classList.add('resizing');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      this.state[pane] = measure(e);
      this.apply();
    });
    const release = (e: PointerEvent) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      handle.releasePointerCapture(e.pointerId);
      handle.classList.remove('on');
      document.body.classList.remove('resizing');
      save('layout', this.state);
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
    handle.addEventListener('dblclick', () => {
      delete this.state[pane];
      this.commit();
    });
  }
}
