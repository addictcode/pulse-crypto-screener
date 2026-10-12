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
  Quaternion,
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
const UP = new Color('#58e08a');
const DOWN = new Color('#ff4a5c');
const FLAT = new Color('#c9ced4');
/** The planet is lit from the side by day and from behind at dawn, when only its edge burns. */
const SUN_DAY = new Vector3(-3.2, 2.3, 3.4).normalize();
const SUN_DAWN = new Vector3(-0.22, 0.6, -0.77).normalize();
const GLOW = '#dfe6f2';
/** The unrolled planet: a square field, this many tiles a side, this far apart. */
const FIELD_SIDE = 40;
const FIELD_PITCH = 0.085;
/** How far apart in time the first and the last tile leave the sphere, as a share of the move. */
const SPREAD = 0.7;
const DOWNWARD = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, -1, 0));

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

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * A place on the flat field for every tile of the sphere. Tiles are dealt out by latitude, a row
 * at a time, and ordered by longitude inside the row, so the planet unrolls like a map instead of
 * shuffling.
 */
function fieldOf(points: Vector3[]): Vector3[] {
  const field: Vector3[] = new Array(points.length);
  const half = (FIELD_SIDE - 1) / 2;
  for (let row = 0; row * FIELD_SIDE < points.length; row++) {
    const band = points
      .slice(row * FIELD_SIDE, (row + 1) * FIELD_SIDE)
      .map((p, k) => ({ index: row * FIELD_SIDE + k, angle: Math.atan2(p.z, p.x) }))
      .sort((a, b) => a.angle - b.angle);
    band.forEach((tile, column) => {
      field[tile.index] = new Vector3((column - half) * FIELD_PITCH, 0, (row - half) * FIELD_PITCH);
    });
  }
  return field;
}

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
  uniform float uPower;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorldNormal;
  void main() {
    float edge = pow(1.0 - clamp(dot(vNormal, vView), 0.0, 1.0), uPower);
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
  /** Small lights scattered over the dark surface, so it reads as terrain and not as a grey ball. */
  private lights!: Points;
  private lightTiles: number[] = [];
  private halo!: ShaderMaterial;
  private rim!: ShaderMaterial;
  private readonly satellite = new Group();
  private readonly pulses: { mesh: Mesh; material: MeshBasicMaterial; born: number; tile: number }[] = [];
  private readonly points = lattice(TILES);
  private readonly field = fieldOf(this.points);
  /** How each tile is turned while it lies on the sphere. */
  private readonly facing: Quaternion[] = [];
  private readonly depth = new Float32Array(TILES);
  /** When a tile leaves the sphere, 0 first and 1 last: the field opens from its middle outward. */
  private readonly delay = new Float32Array(TILES);
  private readonly sun = SUN_DAY.clone();
  private readonly sunLight = new DirectionalLight('#f4f6fa', 3.1);
  /** A weak light from the viewer's side: without it the night side is a flat black and its relief is lost. */
  private readonly fillLight = new DirectionalLight('#aab4c8', 0.3);
  private tiles!: InstancedMesh;
  private core!: Mesh;
  private readonly orbitLines: { material: LineBasicMaterial; opacity: number }[] = [];
  /** 0 is the planet, 1 the same tiles unrolled into a field; `dawn` is 1 when lit from behind. */
  private readonly mood = { flat: 0, dawn: 0 };
  private readonly moodGoal = { flat: 0, dawn: 0 };
  private drawnFlat = -1;
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
  private last0 = performance.now();
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
  /** Frames timed since the last change of resolution, and how long they took together. */
  private timed = { frames: 0, seconds: 0 };

  constructor(canvas: HTMLCanvasElement, options: Options) {
    this.canvas = canvas;
    this.options = options;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.tilt.rotation.z = 0.36;
    this.tilt.add(this.world);
    this.scene.add(this.tilt);

    this.scene.add(new AmbientLight('#9aa0aa', 0.22));
    this.sunLight.position.copy(this.sun).multiplyScalar(6);
    this.scene.add(this.sunLight);
    this.fillLight.position.set(0.9, 2.2, 6);
    this.scene.add(this.fillLight);

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
      color.set([bright * 0.92, bright * 0.95, bright], i * 3);
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
    this.core = new Mesh(new SphereGeometry(0.988, 48, 32), new MeshLambertMaterial({ color: '#060607' }));
    this.world.add(this.core);

    const tiles = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), TILES);
    tiles.frustumCulled = false;
    const tint = new Color();
    const reach = Math.hypot(this.field[0].x, this.field[0].z) || 1;
    this.points.forEach((p, i) => {
      // slow noise for continents, fast noise for single blocks
      const land = 0.5 + 0.5 * Math.sin(p.x * 3.1 + 1.7) * Math.cos(p.y * 2.7 - 0.4) * Math.sin(p.z * 3.6 + 0.9);
      // most of the ground is low; one tile in eight stands up from it as a ridge
      const ridge = hash(i + 0.77) > 0.875 ? 0.018 + hash(i + 0.21) * 0.04 : 0;
      this.depth[i] = 0.014 + land * 0.034 + hash(i) * 0.02 + ridge;
      this.dummy.position.copy(p);
      this.dummy.lookAt(0, 0, 0);
      this.facing.push(this.dummy.quaternion.clone());
      const fromMiddle = Math.hypot(this.field[i].x, this.field[i].z) / reach;
      this.delay[i] = Math.min(1, fromMiddle * 0.86 + hash(i + 0.6) * 0.14);
      // nearly black, with the odd pale tile: a uniform grey would read as a smooth ball
      const pale = hash(i + 0.43) > 0.94 ? 0.07 : 0;
      tiles.setColorAt(i, tint.setHSL(0.62, 0.04, 0.03 + land * 0.06 + hash(i + 0.3) * 0.04 + pale));
      if (hash(i + 0.91) > 0.72) this.lightTiles.push(i);
    });
    this.tiles = tiles;
    this.world.add(tiles);

    const count = this.lightTiles.length;
    const color = new Float32Array(count * 3);
    const size = new Float32Array(count);
    this.lightTiles.forEach((tile, k) => {
      const bright = 0.35 + hash(tile + 0.12) * 0.65;
      color.set([bright * 0.8, bright * 0.88, bright], k * 3);
      size[k] = 0.035 + Math.pow(hash(tile + 0.57), 4) * 0.09;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aColor', new BufferAttribute(color, 3));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    this.lights = new Points(geometry, this.spriteMaterial(this.reducedMotion ? 0 : 0.5));
    this.lights.frustumCulled = false;
    this.world.add(this.lights);

    // one vector for the light and both shells, so turning the sun moves all three
    const uniforms = () => ({ uColor: { value: new Color(GLOW) }, uSun: { value: this.sun }, uLimb: { value: 1 }, uGain: { value: 1 }, uPower: { value: 3.2 } });
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
    columns.boundingSphere = new Sphere(new Vector3(), 3);
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
    const line = (radius: number, opacity: number) => {
      const material = new LineBasicMaterial({ color: GLOW, transparent: true, opacity });
      this.orbitLines.push({ material, opacity });
      return new LineLoop(new BufferGeometry().setFromPoints(ring(radius, 220)), material);
    };
    const inner = new Group();
    inner.rotation.set(Math.PI / 2.25, 0.18, 0);
    inner.add(line(1.72, 0.2));
    const body = new Mesh(new BoxGeometry(0.034, 0.034, 0.034), new MeshBasicMaterial({ color: '#ffffff' }));
    body.position.x = 1.72;
    this.satellite.add(body);
    inner.add(this.satellite);
    const outer = line(2.08, 0.09);
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
      this.pulses.push({ mesh, material, born: 0, tile: 0 });
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
      const near = Math.hypot(p.x - this.disc.x, p.y - this.disc.y) < this.disc.r * this.grip();
      this.lean.set(near ? -this.pointer.y * 0.16 : 0, 0);
      this.hover(p.x, p.y);
      canvas.style.cursor = this.hovered ? 'pointer' : near ? 'grab' : '';
    });
    canvas.addEventListener('pointerdown', (e) => {
      const p = local(e);
      if (Math.hypot(p.x - this.disc.x, p.y - this.disc.y) > this.disc.r * this.grip()) return;
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
    slot.tile = coin.tile;
    slot.mesh.visible = true;

    const el = document.createElement('div');
    el.className = `planet-label ${tone}`;
    el.innerHTML = `<i class="pin"></i><span class="card">${html}</span>`;
    this.options.layer.append(el);
    this.labels.push({ el, symbol, born: performance.now() });
    while (this.labels.length > MAX_LABELS) this.labels.shift()!.el.remove();
  }

  /** How far tile `i` has come from the sphere to the field, 0 to 1. The middle of the field goes first. */
  private unrolled(i: number): number {
    const { flat } = this.mood;
    if (flat <= 0) return 0;
    if (flat >= 1) return 1;
    return smooth(Math.min(1, Math.max(0, flat * (1 + SPREAD) - this.delay[i] * SPREAD)));
  }

  /** Where tile `i` is right now, `lift` above the ground. On the way to the field tiles fly out in an arc. */
  private spot(i: number, lift: number, out: Vector3): Vector3 {
    const t = this.unrolled(i);
    const p = this.points[i];
    const f = this.field[i];
    const r = 1 + lift;
    const arc = t > 0 && t < 1 ? Math.sin(Math.PI * t) * (0.16 + this.delay[i] * 0.3) : 0;
    return out.set(
      p.x * r + (f.x - p.x * r) * t + p.x * arc,
      p.y * r + (lift - p.y * r) * t + p.y * arc,
      p.z * r + (f.z - p.z * r) * t + p.z * arc,
    );
  }

  /** The matrix of a box standing on tile `i`: its middle `lift` above the ground, `depth` tall. */
  private place(i: number, lift: number, size: number, depth: number) {
    this.spot(i, lift, this.dummy.position);
    this.dummy.quaternion.slerpQuaternions(this.facing[i], DOWNWARD, this.unrolled(i));
    this.dummy.scale.set(size, size, depth);
    this.dummy.updateMatrix();
  }

  /** The terrain is rebuilt only while the planet is changing shape. */
  private layTiles() {
    if (Math.abs(this.mood.flat - this.drawnFlat) < 1e-4) return;
    this.drawnFlat = this.mood.flat;
    for (let i = 0; i < TILES; i++) {
      this.place(i, this.depth[i] / 2 - 0.012, TILE_SIZE, this.depth[i]);
      this.tiles.setMatrixAt(i, this.dummy.matrix);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    const lit = this.lights.geometry.getAttribute('position') as BufferAttribute;
    this.lightTiles.forEach((tile, k) => {
      const at = this.spot(tile, this.ground(tile) + 0.004, this.scratch);
      lit.setXYZ(k, at.x, at.y, at.z);
    });
    lit.needsUpdate = true;
  }

  /** How high the top of tile `i` is: what stands on the tile starts from here. */
  private ground(i: number): number {
    return this.depth[i] - 0.012;
  }

  /** How far from the middle the pointer still takes hold: the field is wider than the planet. */
  private grip(): number {
    return 1.5 + this.mood.flat * 1.4;
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

  /**
   * `flat` unrolls the planet into a field of the same tiles, every coin still standing on its
   * own; `dawn` moves the sun behind the planet, so that only the edge is lit.
   */
  setMood(flat: number, dawn: number) {
    const first = this.drawnFlat < 0;
    this.moodGoal.flat = Math.min(1, Math.max(0, flat));
    this.moodGoal.dawn = Math.min(1, Math.max(0, dawn));
    if (first || this.reducedMotion) Object.assign(this.mood, this.moodGoal);
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const scale = (this.renderer.getPixelRatio() * h) / (2 * Math.tan((FOV * Math.PI) / 360));
    // stars keep their pixel size whatever the distance, column lights shrink with the planet
    (this.stars.material as ShaderMaterial).uniforms.uScale.value = this.renderer.getPixelRatio() * 52;
    (this.tips.material as ShaderMaterial).uniforms.uScale.value = scale * 0.1;
    (this.lights.material as ShaderMaterial).uniforms.uScale.value = scale * 0.1;
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
    this.mood.flat += (this.moodGoal.flat - this.mood.flat) * ease;
    this.mood.dawn += (this.moodGoal.dawn - this.mood.dawn) * ease;
    const { flat, dawn } = this.mood;
    this.sun.lerpVectors(SUN_DAY, SUN_DAWN, dawn).normalize();
    this.sunLight.position.copy(this.sun).multiplyScalar(6);
    // up close the atmosphere would fill the screen with light, so it thins as the planet grows;
    // a field has no atmosphere at all
    const gain = Math.min(1, 200 / this.disc.r);
    const round = (1 - flat) * (1 - flat);
    // lit from behind, the planet is a black disc with a burning edge: less haze, less light on the ground
    this.halo.uniforms.uGain.value = gain * (1 - dawn * 0.5) * round;
    // seen from close by, the edge light would lie over the whole visible cap as a grey veil and
    // hide the ground; it narrows to a line along the horizon as the planet grows
    this.rim.uniforms.uPower.value = 3.2 + (1 - gain) * 9;
    this.sunLight.intensity = 3.1 + dawn * 1.4;
    this.fillLight.intensity = 0.3 + dawn * 1.5;
    this.rim.uniforms.uGain.value = Math.max(0.35, gain) * (1 + dawn * 2.2) * round;
    this.core.scale.setScalar(Math.max(0.001, 1 - smooth(Math.min(1, flat * 1.6))));
    for (const line of this.orbitLines) line.material.opacity = line.opacity * round;
    this.satellite.visible = flat < 0.5;
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
    // the field is looked at from above, and lies level
    const { flat } = this.mood;
    this.tilt.rotation.x += (this.lean.x + flat * 0.6 - this.tilt.rotation.x) * Math.min(1, dt * 3);
    this.tilt.rotation.z = 0.36 * (1 - flat);
    this.layTiles();
    if (!this.reducedMotion) {
      this.satellite.rotation.z += dt * 0.35;
      this.stars.rotation.y += dt * 0.004;
    }
    (this.stars.material as ShaderMaterial).uniforms.uTime.value = this.clock;
    (this.lights.material as ShaderMaterial).uniforms.uTime.value = this.clock * 2.4;

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
      const ground = this.ground(coin.tile);
      this.place(coin.tile, ground + height / 2, TILE_SIZE * 0.6, height);
      this.columns.setMatrixAt(i, this.dummy.matrix);
      this.columnFlash.setX(i, punch + (coin === this.hovered ? 0.5 : 0));
      const tip = this.spot(coin.tile, ground + height, this.scratch);
      tipPosition.setXYZ(i, tip.x, tip.y, tip.z);
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
      this.spot(pulse.tile, this.ground(pulse.tile) + 0.03, pulse.mesh.position);
      pulse.mesh.quaternion.slerpQuaternions(this.facing[pulse.tile], DOWNWARD, this.unrolled(pulse.tile));
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
      const tip = this.spot(coin.tile, this.ground(coin.tile) + 0.02 + coin.height, this.scratch).applyMatrix4(this.world.matrixWorld);
      // on the field nothing is ever behind the horizon
      const facing = Math.max(this.mood.flat, tip.clone().normalize().dot(this.camera.position.clone().sub(tip).normalize()));
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
    this.last0 = this.last;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible || document.hidden) return;
    this.pace(now - this.last0);
    this.clock += dt;
    this.frameCamera(dt);
    this.animate(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.labels.length) this.placeLabels();
  };

  /**
   * The scene fills the screen, which a weak or software GPU cannot keep up with at full
   * resolution. When frames take too long the canvas is drawn with fewer pixels: a softer
   * planet that moves is better than a sharp one that stutters.
   */
  private pace(frameMs: number) {
    this.timed.frames++;
    this.timed.seconds += Math.min(frameMs, 500) / 1000;
    if (this.timed.frames < 40) return;
    const average = this.timed.seconds / this.timed.frames;
    this.timed = { frames: 0, seconds: 0 };
    const ratio = this.renderer.getPixelRatio();
    if (average > 0.034 && ratio > 0.6) {
      this.renderer.setPixelRatio(Math.max(0.6, ratio * 0.72));
      this.resize();
    }
  }

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
