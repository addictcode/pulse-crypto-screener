import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  BufferGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  Group,
} from 'three';

import type { SymbolMetrics } from './types';

const TILES = 1400;
const MAX_COINS = 220;
const TILE_SIZE = 0.052;
const UP = new Color('#9dff5c');
const DOWN = new Color('#ff4f7b');
const FLAT = new Color('#3ef0ff');

/** Evenly spread points on a unit sphere (Fibonacci lattice). */
function lattice(count: number): Vector3[] {
  const points: Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    points.push(new Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return points;
}

/**
 * The landing hero: a planet built from cubes. The surface is dark tiles; the most traded
 * perpetuals stand on it as glowing columns, height for volume and move, colour for direction.
 */
export class VoxelPlanet {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(34, 1, 0.1, 50);
  private readonly world = new Group();
  private readonly coins: InstancedMesh;
  private readonly points = lattice(TILES);
  private readonly dummy = new Object3D();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2(10, 10);
  private readonly target = new Vector2();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly canvas: HTMLCanvasElement;
  private readonly onHover: (coin: SymbolMetrics | null, x: number, y: number) => void;
  private symbols: SymbolMetrics[] = [];
  private visible = true;
  private frame = 0;

  constructor(canvas: HTMLCanvasElement, onHover: (coin: SymbolMetrics | null, x: number, y: number) => void) {
    this.canvas = canvas;
    this.onHover = onHover;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.camera.position.set(0, 0.35, 5.2);
    this.camera.lookAt(0, 0, 0);
    this.world.rotation.z = 0.32;
    this.scene.add(this.world);

    this.scene.add(new AmbientLight('#7fb6ff', 0.55));
    const sun = new DirectionalLight('#bff8ff', 1.4);
    sun.position.set(3, 2.5, 4);
    this.scene.add(sun);

    // faint wireframe core, so the planet reads as a body even between tiles
    const core = new LineSegments(
      new EdgesGeometry(new IcosahedronGeometry(0.965, 2)),
      new LineBasicMaterial({ color: '#3ef0ff', transparent: true, opacity: 0.12 }),
    );
    this.world.add(core);

    const tiles = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), TILES);
    const tint = new Color();
    this.points.forEach((p, i) => {
      this.place(p, 1, TILE_SIZE, 0.02);
      tiles.setMatrixAt(i, this.dummy.matrix);
      tiles.setColorAt(i, tint.setHSL(0.58 + (i % 7) * 0.006, 0.55, 0.09 + ((i * 37) % 11) / 260));
    });
    this.world.add(tiles);

    this.coins = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ transparent: true, opacity: 0.95 }), MAX_COINS);
    this.coins.count = 0;
    this.world.add(this.coins);

    // an orbit with a small companion cube, purely for the sense of motion
    const orbit = new LineLoop(
      new BufferGeometry().setFromPoints(ring(1.55, 160)),
      new LineBasicMaterial({ color: '#3ef0ff', transparent: true, opacity: 0.18 }),
    );
    orbit.rotation.x = Math.PI / 2.35;
    this.world.add(orbit);

    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([entry]) => (this.visible = entry.isIntersecting)).observe(canvas);
    canvas.addEventListener('pointermove', (e) => {
      const box = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
      this.target.set(this.pointer.y * 0.18, this.pointer.x * 0.35);
      this.hover(e.clientX - box.left, e.clientY - box.top);
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer.set(10, 10);
      this.target.set(0, 0);
      this.onHover(null, 0, 0);
    });
    this.resize();
    this.loop();
  }

  /** Coins by volume; each keeps a stable spot on the surface derived from its rank. */
  setCoins(rows: SymbolMetrics[]) {
    this.symbols = [...rows].sort((a, b) => b.vol24h - a.vol24h).slice(0, MAX_COINS);
    const step = Math.floor(TILES / Math.max(1, this.symbols.length));
    const maxVolume = Math.log10(this.symbols[0]?.vol24h ?? 1e9);
    const color = new Color();
    this.symbols.forEach((r, i) => {
      const point = this.points[(i * step + 11) % TILES];
      const volumeHeight = Math.max(0, Math.log10(Math.max(r.vol24h, 1)) - 6.5) / Math.max(0.5, maxVolume - 6.5);
      const move = Math.min(1, Math.abs(r.ch24h ?? 0) / 12);
      const height = 0.04 + volumeHeight * 0.2 + move * 0.16;
      this.place(point, 1 + height / 2, TILE_SIZE * 0.9, height);
      this.coins.setMatrixAt(i, this.dummy.matrix);
      const base = (r.ch24h ?? 0) > 0.05 ? UP : (r.ch24h ?? 0) < -0.05 ? DOWN : FLAT;
      this.coins.setColorAt(i, color.copy(base).multiplyScalar(0.55 + move * 0.45));
    });
    this.coins.count = this.symbols.length;
    this.coins.instanceMatrix.needsUpdate = true;
    if (this.coins.instanceColor) this.coins.instanceColor.needsUpdate = true;
  }

  private place(point: Vector3, radius: number, size: number, depth: number) {
    this.dummy.position.copy(point).multiplyScalar(radius);
    this.dummy.lookAt(0, 0, 0);
    this.dummy.scale.set(size, size, depth);
    this.dummy.updateMatrix();
  }

  private hover(x: number, y: number) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.coins)[0];
    this.onHover(hit?.instanceId !== undefined ? this.symbols[hit.instanceId] ?? null : null, x, y);
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) return;
    if (!this.reducedMotion) {
      this.world.rotation.y += 0.0016;
      this.world.rotation.x += (this.target.x - this.world.rotation.x) * 0.04;
      this.scene.rotation.y += (this.target.y - this.scene.rotation.y) * 0.04;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
  }
}

function ring(radius: number, segments: number): Vector3[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return new Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  });
}

/** WebGL can be missing (old devices, disabled GPU); the hero then shows a static fallback. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
