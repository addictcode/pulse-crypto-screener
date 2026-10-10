import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

import type { SymbolMetrics } from './types';

const TILES = 1600;
const MAX_COINS = 180;
const TILE_SIZE = 0.066;
const FOV = 34;
const AUTO_SPIN = 0.09; // radians a second
const MAX_LABELS = 4;
const LABEL_LIFE = 5200;
const PULSES = 10;
const UP = new Color('#9dff5c');
const DOWN = new Color('#ff4f7b');
const FLAT = new Color('#3ef0ff');
const SUN = new Vector3(-3.2, 2.3, 3.4).normalize();

export type Tone = 'up' | 'down' | 'hot';

interface Options {
  /** Laid exactly over the canvas; event labels are positioned inside it. */
  layer: HTMLElement;
  /** x and y are canvas pixels, the same space the layer uses. */
  onHover: (coin: SymbolMetrics | null, x: number, y: number) => void;
  onPick: (coin: SymbolMetrics) => void;
}

interface Coin {
  row: SymbolMetrics;
  tile: number;
  height: number;
  target: number;
  /** A burst of extra height and light when the coin makes the tape; decays to zero. */
  kick: number;
  order: number;
}

interface Label {
  el: HTMLElement;
  symbol: string;
  born: number;
}

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

/** Cheap repeatable noise in 0..1, so the terrain and the stars are the same on every visit. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function symbolHash(symbol: string): number {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i++) h = Math.imul(h ^ symbol.charCodeAt(i), 16777619);
  return h >>> 0;
}

const HALO_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorldNormal;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/** The glow outside the limb: brightest where it touches the planet, gone at its own edge. */
const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uLimb;
  uniform float uGain;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorldNormal;
  void main() {
    float depth = clamp(-dot(vNormal, vView) / uLimb, 0.0, 1.0);
    // the shell is seen from inside; mirror the normal to light it like the face in front
    float lit = 0.3 + 0.7 * smoothstep(-0.55, 0.75, dot(vec3(vWorldNormal.xy, -vWorldNormal.z), uSun));
    gl_FragColor = vec4(uColor * pow(depth, 4.2) * lit * 0.62 * uGain, 0.0);
    #include <colorspace_fragment>
  }
`;

/** A thin bright edge on the planet itself, the atmosphere seen edge-on. */
const RIM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uGain;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorldNormal;
  void main() {
    float edge = pow(1.0 - clamp(dot(vNormal, vView), 0.0, 1.0), 3.2);
    float lit = 0.25 + 0.75 * smoothstep(-0.35, 0.8, dot(vWorldNormal, uSun));
    gl_FragColor = vec4(uColor * edge * lit * 0.6 * uGain, 0.0);
    #include <colorspace_fragment>
  }
`;

/** Columns are dark at the foot and burn at the tip, so the tall ones read from across the page. */
const COLUMN_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aFlash;
  varying vec3 vColor;
  varying float vHeight;
  varying float vFlash;
  varying float vShade;
  void main() {
    vHeight = 0.5 - position.z;
    vColor = aColor;
    vFlash = aFlash;
    vShade = 0.66 + 0.34 * abs(normal.x) + 0.2 * abs(normal.z);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const COLUMN_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vHeight;
  varying float vFlash;
  varying float vShade;
  void main() {
    float glow = 0.22 + 0.95 * pow(vHeight, 1.5);
    vec3 color = vColor * glow * vShade;
    color += (vColor * 0.7 + vec3(0.45)) * vFlash * (0.25 + vHeight);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const SPRITE_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  uniform float uTime;
  uniform float uTwinkle;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float flicker = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (0.6 + aSize * 0.9) + position.x * 40.0));
    vColor = aColor * flicker;
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
// The canvas is transparent and the page shows through it. Everything that glows is drawn with
// premultiplied additive blending and zero alpha: the light adds to whatever is behind the
// canvas instead of covering it with an opaque patch.
const SPRITE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
    gl_FragColor = vec4(vColor * a, 0.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The landing hero: a planet built from cubes, alive with the market. The surface is dark
 * terrain; the most traded perpetuals stand on it as glowing columns, height for volume and
 * move, colour for direction. When a coin makes the signal tape its column jumps, a ring spreads
 * across the surface and a label names what happened. Drag spins it, a click opens the pair.
 */
export class VoxelPlanet {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  /** Axis tilt and the lean toward the pointer. */
  private readonly tilt = new Group();
  /** Everything that turns with the planet. */
  private readonly world = new Group();
  private readonly stars: Points;
  private readonly columns: InstancedMesh;
  private readonly columnColor = new InstancedBufferAttribute(new Float32Array(MAX_COINS * 3), 3);
  private readonly columnFlash = new InstancedBufferAttribute(new Float32Array(MAX_COINS), 1);
  private readonly tips: Points;
  private halo!: ShaderMaterial;
  private rim!: ShaderMaterial;
  private readonly satellite = new Group();
  private readonly pulses: { mesh: Mesh; material: MeshBasicMaterial; born: number }[] = [];
  private readonly points = lattice(TILES);
  private readonly taken = new Set<number>();
  private readonly coins = new Map<string, Coin>();
  private readonly labels: Label[] = [];
  private readonly dummy = new Object3D();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2(10, 10);
  private readonly lean = new Vector2();
  private readonly scratch = new Vector3();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: Options;
  private shown: Coin[] = [];
  private hovered: Coin | null = null;
  private visible = true;
  private frame = 0;
  private last = performance.now();
  private clock = 0;
  private spin = this.reducedMotion ? 0 : 1.4;
  private intro = this.reducedMotion ? 1 : 0;
  private started = false;
  private drag: { x: number; y: number; moved: number } | null = null;
  /** Where the planet is right now: centre and body radius in canvas pixels. */
  private readonly disc = { x: 0, y: 0, r: 1 };
  /** Where the page wants it; the planet glides there instead of jumping with every scroll event. */
  private readonly goal = { x: 0, y: 0, r: 1 };
  private placed = false;

  constructor(canvas: HTMLCanvasElement, options: Options) {
    this.canvas = canvas;
    this.options = options;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.tilt.rotation.z = 0.36;
    this.tilt.add(this.world);
    this.scene.add(this.tilt);

    this.scene.add(new AmbientLight('#5f86ff', 0.22));
    const sun = new DirectionalLight('#d6fbff', 3.1);
    sun.position.copy(SUN).multiplyScalar(6);
    this.scene.add(sun);

    this.stars = this.buildStars();
    this.scene.add(this.stars);
    this.buildBody();
    this.columns = this.buildColumns();
    this.tips = this.buildTips();
    this.buildOrbits();
    this.buildPulses();

    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([entry]) => (this.visible = entry.isIntersecting)).observe(canvas);
    this.bindPointer();
    this.resize();
    this.loop();
  }

  private buildStars(): Points {
    const count = 520;
    const position = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const y = hash(i) * 2 - 1;
      const a = hash(i + 0.5) * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      const far = 38 + hash(i + 0.25) * 30;
      position.set([Math.cos(a) * r * far, y * far, Math.sin(a) * r * far], i * 3);
      const bright = 0.35 + Math.pow(hash(i + 0.75), 2) * 0.65;
      const warm = hash(i + 0.1);
      color.set([bright * (warm > 0.8 ? 1 : 0.72), bright * 0.95, bright * (warm < 0.25 ? 0.8 : 1)], i * 3);
      size[i] = 1 + Math.pow(hash(i + 0.9), 4) * 2.4;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aColor', new BufferAttribute(color, 3));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    return new Points(geometry, this.spriteMaterial(this.reducedMotion ? 0 : 0.55));
  }

  private spriteMaterial(twinkle: number): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: { uScale: { value: 1 }, uTime: { value: 0 }, uTwinkle: { value: twinkle } },
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthWrite: false,
    });
  }

  /** Solid core, voxel terrain of uneven height, and the two atmosphere shells. */
  private buildBody() {
    this.world.add(new Mesh(new SphereGeometry(0.988, 48, 32), new MeshLambertMaterial({ color: '#050b17' })));

    const tiles = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), TILES);
    const tint = new Color();
    this.points.forEach((p, i) => {
      // slow noise for continents, fast noise for single blocks
      const land = 0.5 + 0.5 * Math.sin(p.x * 3.1 + 1.7) * Math.cos(p.y * 2.7 - 0.4) * Math.sin(p.z * 3.6 + 0.9);
      const depth = 0.016 + land * 0.034 + hash(i) * 0.02;
      this.place(p, 1 + depth / 2 - 0.012, TILE_SIZE, depth);
      tiles.setMatrixAt(i, this.dummy.matrix);
      tiles.setColorAt(i, tint.setHSL(0.61 - land * 0.05, 0.55 + land * 0.15, 0.05 + land * 0.055 + hash(i + 0.3) * 0.03));
    });
    this.world.add(tiles);

    const uniforms = () => ({ uColor: { value: new Color('#3ef0ff') }, uSun: { value: SUN }, uLimb: { value: 1 }, uGain: { value: 1 } });
    const halo = new Mesh(
      new SphereGeometry(1.3, 64, 48),
      new ShaderMaterial({
        uniforms: { ...uniforms(), uLimb: { value: Math.sqrt(1 - (1 / 1.3) ** 2) } },
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        side: BackSide,
        blending: AdditiveBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    const rim = new Mesh(
      new SphereGeometry(1.045, 64, 48),
      new ShaderMaterial({
        uniforms: uniforms(),
        vertexShader: HALO_VERTEX,
        fragmentShader: RIM_FRAGMENT,
        blending: AdditiveBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    // the shells do not turn with the surface: the lit side stays where the sun is
    this.scene.add(halo, rim);
    this.halo = halo.material;
    this.rim = rim.material;
  }

  private buildColumns(): InstancedMesh {
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.setAttribute('aColor', this.columnColor);
    geometry.setAttribute('aFlash', this.columnFlash);
    const columns = new InstancedMesh(geometry, new ShaderMaterial({ vertexShader: COLUMN_VERTEX, fragmentShader: COLUMN_FRAGMENT }), MAX_COINS);
    columns.count = 0;
    columns.frustumCulled = false;
    // three measures an instanced mesh once, on the first hit test, and the columns grow after
    // that; a fixed sphere around the whole planet keeps hovering and clicking working
    columns.boundingSphere = new Sphere(new Vector3(), 2);
    this.world.add(columns);
    return columns;
  }

  /** A soft light on top of every column: the cheap stand-in for bloom. */
  private buildTips(): Points {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_COINS * 3), 3));
    geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(MAX_COINS * 3), 3));
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(MAX_COINS), 1));
    geometry.setDrawRange(0, 0);
    const tips = new Points(geometry, this.spriteMaterial(0));
    tips.frustumCulled = false;
    this.world.add(tips);
    return tips;
  }

  private buildOrbits() {
    const line = (radius: number, opacity: number) =>
      new LineLoop(
        new BufferGeometry().setFromPoints(ring(radius, 220)),
        new LineBasicMaterial({ color: '#3ef0ff', transparent: true, opacity }),
      );
    const inner = new Group();
    inner.rotation.set(Math.PI / 2.25, 0.18, 0);
    inner.add(line(1.72, 0.26));
    const body = new Mesh(new BoxGeometry(0.034, 0.034, 0.034), new MeshBasicMaterial({ color: '#dffcff' }));
    body.position.x = 1.72;
    this.satellite.add(body);
    inner.add(this.satellite);
    const outer = line(2.08, 0.11);
    outer.rotation.set(Math.PI / 2.6, -0.5, 0);
    this.tilt.add(inner, outer);
  }

  private buildPulses() {
    const geometry = new RingGeometry(0.84, 1, 48);
    for (let i = 0; i < PULSES; i++) {
      const material = new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, premultipliedAlpha: true, side: DoubleSide, depthWrite: false });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      this.world.add(mesh);
      this.pulses.push({ mesh, material, born: 0 });
    }
  }

  private bindPointer() {
    const { canvas } = this;
    const local = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top, w: box.width, h: box.height };
    };
    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      this.pointer.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.world.rotation.y += dx * 0.006;
        this.spin = Math.max(-6, Math.min(6, dx * 0.36));
        this.lean.x = Math.max(-0.5, Math.min(0.5, this.lean.x + dy * 0.004));
        return;
      }
      const near = Math.hypot(p.x - this.disc.x, p.y - this.disc.y) < this.disc.r * 1.5;
      this.lean.set(near ? -this.pointer.y * 0.16 : 0, 0);
      this.hover(p.x, p.y);
      canvas.style.cursor = this.hovered ? 'pointer' : near ? 'grab' : '';
    });
    canvas.addEventListener('pointerdown', (e) => {
      const p = local(e);
      if (Math.hypot(p.x - this.disc.x, p.y - this.disc.y) > this.disc.r * 1.5) return;
      this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    const release = (e: PointerEvent) => {
      if (!this.drag) return;
      const wasClick = this.drag.moved < 6;
      this.drag = null;
      canvas.style.cursor = '';
      if (!wasClick) return;
      const p = local(e);
      this.pointer.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
      this.hover(p.x, p.y);
      if (this.hovered) this.options.onPick(this.hovered.row);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    canvas.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.pointer.set(10, 10);
      this.lean.set(0, 0);
      this.hovered = null;
      this.options.onHover(null, 0, 0);
    });
  }

  /** Coins by volume. A coin keeps its place on the surface for as long as the page is open. */
  setCoins(rows: SymbolMetrics[]) {
    const top = [...rows].sort((a, b) => b.vol24h - a.vol24h).slice(0, MAX_COINS);
    if (!top.length) return;
    const ceiling = Math.log10(Math.max(top[0].vol24h, 1e7));
    const keep = new Set(top.map((r) => r.symbol));
    for (const [symbol, coin] of this.coins) {
      if (keep.has(symbol)) continue;
      this.taken.delete(coin.tile);
      this.coins.delete(symbol);
    }
    this.shown = top.map((row, order) => {
      const volume = Math.max(0, Math.log10(Math.max(row.vol24h, 1)) - 6.5) / Math.max(0.5, ceiling - 6.5);
      const move = Math.min(1, Math.abs(row.ch24h ?? 0) / 14);
      const target = 0.03 + volume * volume * 0.27 + move * 0.13;
      let coin = this.coins.get(row.symbol);
      if (!coin) {
        coin = { row, tile: this.freeTile(row.symbol), height: 0, target, kick: 0, order };
        this.coins.set(row.symbol, coin);
      }
      coin.row = row;
      coin.target = target;
      coin.order = order;
      return coin;
    });
    this.columns.count = this.shown.length;
    this.tips.geometry.setDrawRange(0, this.shown.length);
    this.started = true;
    this.paint();
  }

  private freeTile(symbol: string): number {
    let tile = symbolHash(symbol) % TILES;
    while (this.taken.has(tile)) tile = (tile + 37) % TILES;
    this.taken.add(tile);
    return tile;
  }

  private paint() {
    const color = new Color();
    const tipColor = this.tips.geometry.getAttribute('aColor') as BufferAttribute;
    this.shown.forEach((coin, i) => {
      const change = coin.row.ch24h ?? 0;
      const move = Math.min(1, Math.abs(change) / 14);
      color.copy(change > 0.05 ? UP : change < -0.05 ? DOWN : FLAT).multiplyScalar(0.5 + move * 0.5);
      this.columnColor.setXYZ(i, color.r, color.g, color.b);
      tipColor.setXYZ(i, color.r, color.g, color.b);
    });
    this.columnColor.needsUpdate = true;
    tipColor.needsUpdate = true;
  }

  /**
   * A coin has just made the tape: its column jumps, a ring spreads from it and, when it faces
   * the viewer, a label says what happened.
   */
  pulse(symbol: string, html: string, tone: Tone) {
    const coin = this.coins.get(symbol);
    if (!coin || this.reducedMotion || !this.visible || document.hidden) return;
    coin.kick = 1;
    const slot = this.pulses.reduce((oldest, p) => (p.born < oldest.born ? p : oldest));
    slot.born = this.clock;
    slot.material.color.copy(tone === 'up' ? UP : tone === 'down' ? DOWN : FLAT);
    slot.mesh.position.copy(this.points[coin.tile]).multiplyScalar(1.07);
    slot.mesh.lookAt(0, 0, 0);
    slot.mesh.visible = true;

    const el = document.createElement('div');
    el.className = `planet-label ${tone}`;
    el.innerHTML = `<i class="pin"></i><span class="card">${html}</span>`;
    this.options.layer.append(el);
    this.labels.push({ el, symbol, born: performance.now() });
    while (this.labels.length > MAX_LABELS) this.labels.shift()!.el.remove();
  }

  private place(point: Vector3, radius: number, size: number, depth: number) {
    this.dummy.position.copy(point).multiplyScalar(radius);
    this.dummy.lookAt(0, 0, 0);
    this.dummy.scale.set(size, size, depth);
    this.dummy.updateMatrix();
  }

  private hover(x: number, y: number) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.columns)[0];
    this.hovered = hit?.instanceId !== undefined ? this.shown[hit.instanceId] ?? null : null;
    this.options.onHover(this.hovered?.row ?? null, x, y);
  }

  /**
   * Puts the planet somewhere on the canvas: centre and body radius in pixels. The centre may be
   * far outside the canvas, which is how the hero shows only the top of it as a horizon.
   */
  setView(x: number, y: number, r: number) {
    Object.assign(this.goal, { x, y, r: Math.max(40, r) });
    if (!this.placed || this.reducedMotion) Object.assign(this.disc, this.goal);
    this.placed = true;
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const scale = (this.renderer.getPixelRatio() * h) / (2 * Math.tan((FOV * Math.PI) / 360));
    // stars keep their pixel size whatever the distance, column lights shrink with the planet
    (this.stars.material as ShaderMaterial).uniforms.uScale.value = this.renderer.getPixelRatio() * 52;
    (this.tips.material as ShaderMaterial).uniforms.uScale.value = scale * 0.1;
  }

  /** The camera backs away until the planet is the asked size, then the view is shifted to its centre. */
  private frameCamera(dt: number) {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    const ease = 1 - Math.exp(-dt * 7);
    this.disc.x += (this.goal.x - this.disc.x) * ease;
    this.disc.y += (this.goal.y - this.disc.y) * ease;
    this.disc.r += (this.goal.r - this.disc.r) * ease;
    // Seen from close by, a sphere's outline is wider than its radius drawn at that distance;
    // this is the distance at which the outline itself is disc.r pixels.
    const focal = h / (2 * Math.tan((FOV * Math.PI) / 360));
    this.camera.position.set(0, 0, Math.sqrt(1 + (focal / this.disc.r) ** 2));
    // up close the atmosphere would fill the screen with light, so it thins as the planet grows
    const gain = Math.min(1, 200 / this.disc.r);
    this.halo.uniforms.uGain.value = gain;
    this.rim.uniforms.uGain.value = Math.max(0.35, gain);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w / 2 - this.disc.x, h / 2 - this.disc.y, w, h);
    this.camera.updateProjectionMatrix();
  }

  private animate(dt: number) {
    if (this.started && this.intro < 1) this.intro = Math.min(1, this.intro + dt / 1.8);
    if (!this.drag && !this.reducedMotion) {
      this.spin += (AUTO_SPIN - this.spin) * Math.min(1, dt * 1.6);
      this.world.rotation.y += this.spin * dt;
    }
    this.tilt.rotation.x += (this.lean.x - this.tilt.rotation.x) * Math.min(1, dt * 3);
    if (!this.reducedMotion) {
      this.satellite.rotation.z += dt * 0.35;
      this.stars.rotation.y += dt * 0.004;
    }
    (this.stars.material as ShaderMaterial).uniforms.uTime.value = this.clock;

    const tipPosition = this.tips.geometry.getAttribute('position') as BufferAttribute;
    const tipSize = this.tips.geometry.getAttribute('aSize') as BufferAttribute;
    const total = Math.max(1, this.shown.length);
    this.shown.forEach((coin, i) => {
      // the biggest coins rise first, the rest follow in a wave
      const rise = Math.min(1, Math.max(0, this.intro * 1.7 - (coin.order / total) * 0.7));
      const eased = 1 - Math.pow(1 - rise, 4);
      coin.height += (coin.target - coin.height) * Math.min(1, dt * 5);
      coin.kick = Math.max(0, coin.kick - dt * 0.75);
      const punch = coin.kick * coin.kick;
      const height = Math.max(0.0001, coin.height * eased * (1 + punch * 0.55) + punch * 0.05);
      const point = this.points[coin.tile];
      this.place(point, 1.02 + height / 2, TILE_SIZE * 0.6, height);
      this.columns.setMatrixAt(i, this.dummy.matrix);
      this.columnFlash.setX(i, punch + (coin === this.hovered ? 0.5 : 0));
      tipPosition.setXYZ(i, point.x * (1.02 + height), point.y * (1.02 + height), point.z * (1.02 + height));
      tipSize.setX(i, eased * (0.2 + Math.min(1, coin.height / 0.3) * 0.75 + punch * 2));
    });
    this.columns.instanceMatrix.needsUpdate = true;
    this.columnFlash.needsUpdate = true;
    tipPosition.needsUpdate = true;
    tipSize.needsUpdate = true;

    for (const pulse of this.pulses) {
      if (!pulse.mesh.visible) continue;
      const age = (this.clock - pulse.born) / 1.5;
      if (age >= 1) {
        pulse.mesh.visible = false;
        continue;
      }
      const spread = 1 - Math.pow(1 - age, 3);
      pulse.mesh.scale.setScalar(0.03 + spread * 0.36);
      pulse.material.opacity = (1 - age) * (1 - age) * 0.9;
    }
  }

  /** Labels ride on the tips of their columns and hide while those are behind the planet. */
  private placeLabels() {
    const now = performance.now();
    const { clientWidth: w, clientHeight: h } = this.canvas;
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i];
      const coin = this.coins.get(label.symbol);
      const age = now - label.born;
      if (!coin || age > LABEL_LIFE) {
        label.el.remove();
        this.labels.splice(i, 1);
        continue;
      }
      const tip = this.scratch.copy(this.points[coin.tile]).multiplyScalar(1.04 + coin.height).applyMatrix4(this.world.matrixWorld);
      const facing = tip.clone().normalize().dot(this.camera.position.clone().sub(tip).normalize());
      tip.project(this.camera);
      const x = (tip.x * 0.5 + 0.5) * w;
      const y = (-tip.y * 0.5 + 0.5) * h;
      label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      label.el.classList.toggle('on', facing > 0.12 && age > 30 && age < LABEL_LIFE - 500);
      // the note opens away from the planet, unless that would push it off a narrow screen
      label.el.classList.toggle('flip', x < 190 ? true : x > w - 190 ? false : x > this.disc.x);
    }
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible || document.hidden) return;
    this.clock += dt;
    this.frameCamera(dt);
    this.animate(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.labels.length) this.placeLabels();
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
