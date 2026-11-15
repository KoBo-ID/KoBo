/**
 * The ONLY module that imports three. Loaded via dynamic import() from
 * HeroScene so it lands in its own lazy chunk.
 *
 * A SECTION through a kos. Each floor is a pinwheel of four 5:4 rooms around a
 * corridor core: thick partitions, a hinged door in every corridor wall, outer
 * faces cut away. Three floors x four rooms = twelve rooms, each with its own
 * furniture layout and its own resident (see layouts.ts).
 *
 * Life comes from twelve independent residents. Each has its own walking
 * speed, its own random pauses, its own number of stops and its own time away,
 * and starts at a random point in its cycle, so no two rooms ever move in step.
 * Residents path-find around their room's furniture; doors open for whoever is
 * passing and the resident waits for it. Floors occasionally do a 90deg
 * "Rubik's layer" turn on independent timers.
 *
 * Look: a cool teal shell around warm cream rooms, lit by a warm key and a cool
 * fill. Each room's lamp follows who is home, so the building glows where
 * people are. Over ~100 s the light drifts from midday to golden hour and back.
 * The camera rests exactly where it always did (the page CSS is measured
 * against that framing) and only sways a few degrees with the pointer. Hover a
 * room to warm it, click to say hi. Everything is decorative.
 *
 * Units are metres.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  AdditiveBlending,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Timer,
  Vector2,
  WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BACK_FACE,
  CLEAR,
  CORE,
  CORRIDOR,
  DOOR_H,
  DOOR_X0,
  DOOR_X1,
  ENTRY,
  FLOOR_H,
  HALF,
  HERO_ROOM,
  LAYOUTS,
  PART_FACE,
  SLAB_T,
  WALL_T,
  buildNav,
  type Item,
  type Layout,
  type NavMesh,
} from './layouts';

const FLOORS = 3;
const FOCUS = 1; // the floors above AND below this one run off the frame
const DOOR_W = DOOR_X1 - DOOR_X0;
const DOOR_OPEN = 1.6; // rad - opens flat against the partition
const TURN_S = 1.0;

const DEG = Math.PI / 180;
const hsl = (h: number, s: number, l: number) => new Color().setHSL(h / 360, s / 100, l / 100);

/** Anticipation then overshoot: the "clack" of a cube layer. */
function easeInOutBack(x: number) {
  const c1 = 1.1;
  const c2 = c1 * 1.525;
  return x < 0.5
    ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2
    : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;
}
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cool teal shell around warm cream rooms, with ONE warm accent (coral) and
 *  amber for light. Shell sits at mid lightness, interiors high, so planes and
 *  people separate; the shell stays duller than the page's "Cari Kos" teal. */
const PALETTE = {
  floor: hsl(36, 48, 90),
  slabEdge: hsl(178, 30, 60),
  ceiling: hsl(36, 40, 95),
  wallTints: [hsl(38, 60, 93), hsl(22, 62, 91), hsl(46, 55, 91), hsl(176, 30, 92)],
  partition: hsl(178, 28, 60),
  door: hsl(16, 72, 66),
  handle: hsl(40, 80, 70),
  wood: hsl(30, 48, 70),
  woodDark: hsl(28, 40, 52),
  mattress: hsl(40, 40, 97),
  pillow: hsl(0, 0, 100),
  blankets: [hsl(14, 76, 68), hsl(178, 38, 58), hsl(40, 85, 70), hsl(8, 60, 74)],
  sofas: [hsl(180, 35, 56), hsl(14, 60, 68), hsl(40, 50, 70)],
  rugs: [hsl(176, 32, 78), hsl(32, 50, 80), hsl(14, 50, 82), hsl(150, 28, 78)],
  wardrobe: hsl(30, 42, 84),
  seam: hsl(30, 20, 70),
  chair: hsl(178, 32, 56),
  pot: hsl(14, 55, 68),
  leaf: hsl(150, 42, 56),
  leafTones: [hsl(150, 42, 56), hsl(133, 36, 48), hsl(163, 34, 62), hsl(108, 32, 52)],
  potTones: [hsl(14, 55, 68), hsl(32, 50, 76), hsl(178, 25, 70), hsl(8, 40, 78)],
  art: hsl(36, 30, 97),
  artInner: [hsl(178, 40, 62), hsl(14, 70, 70), hsl(40, 80, 70), hsl(190, 40, 70)],
  books: [hsl(14, 62, 66), hsl(178, 38, 56), hsl(40, 75, 68), hsl(28, 30, 45)],
  lamp: hsl(40, 100, 78),
  screen: hsl(190, 70, 84),
  tv: hsl(200, 25, 45),
  coreLight: hsl(45, 90, 86),
  // people: coral / amber / deep teal bodies, peach heads, dark teal packs
  bodies: [hsl(14, 82, 62), hsl(38, 90, 60), hsl(188, 52, 38)],
  head: hsl(28, 62, 80),
  pack: hsl(190, 40, 30),
};

// Light states. Day is cool and high; dusk is a warm golden hour, still high-key
// (never dark: the stage sits beside the search box).
const DAY = { sun: hsl(38, 100, 95), sky: hsl(190, 50, 93), gnd: hsl(178, 42, 52), sunI: 2.5, hemiI: 1.05, sunY: 9.5 };
const DUSK = { sun: hsl(30, 100, 76), sky: hsl(24, 85, 88), gnd: hsl(190, 44, 48), sunI: 2.3, hemiI: 0.9, sunY: 5.5 };
const CYCLE_S = 100; // one siang -> senja -> siang loop
const MOOD0 = 0.3; // where the cycle starts (matches the poster)
const BASE_WARM = 0.4; // every room's resting glow (what the poster shows)

/* ── Resident behaviour ──────────────────────────────────────────────────── */

type Phase = 'away' | 'callDoor' | 'walk' | 'pause' | 'waitDoorOut';
type After = 'inside' | 'arrived' | 'toDoor' | 'out';

interface DoorState {
  pivot: Group;
  value: number;
  target: number;
}

interface Resident {
  g: Group;
  room: number; // 0..3 within its floor
  nav: NavMesh;
  door: DoorState;
  phase: Phase;
  after: After;
  t: number;
  speed: number;
  path: [number, number][];
  pos: [number, number];
  node: number;
  stops: number;
  heading: number;
  stride: number;
  hop: number; // 0..1 through a "hi" hop after a click, or -1
  ri: number; // room index across the building (floor * 4 + quarter)
}

/** Per-room light state: the lamp follows who is home, hover and clicks add to it. */
interface RoomLight {
  lamp: MeshLambertMaterial;
  screen: MeshLambertMaterial;
  wash: MeshBasicMaterial;
  warm: number;
  hover: number; // 0..1, eased
  pulse: number; // decays after a click
  resident: Resident | null;
}

interface FloorState {
  group: Group;
  residents: Resident[];
  doors: DoorState[];
  turnIn: number;
  turning: number; // seconds into a turn, or -1
  fromY: number;
}

/** Soft round falloff for the warm wash: fully transparent at its rim. */
function washTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

export function start(host: HTMLElement, onFirstFrame?: () => void): () => void {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'low-power',
      alpha: true,
      failIfMajorPerformanceCaveat: true,
    });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  // Narrow FOV from further away flattens perspective toward an isometric read.
  const camera = new PerspectiveCamera(22, 1, 0.1, 200);
  const rng = mulberry32(Math.floor(Math.random() * 1e9));

  // ── Shared geometry + materials ─────────────────────────────────────────
  const unitBox = new BoxGeometry(1, 1, 1);
  const unitSphere = new SphereGeometry(1, 20, 14);
  const bodyGeo = new CapsuleGeometry(0.17, 0.75, 4, 14);
  const headGeo = new SphereGeometry(0.19, 18, 14);

  // Rounded boxes are cached by size: scaling a rounded box non-uniformly
  // would stretch its bevels into ovals.
  const roundCache = new Map<string, BufferGeometry>();
  const rbox = (w: number, h: number, d: number, r = 0.04) => {
    const key = `${w}|${h}|${d}|${r}`;
    let g = roundCache.get(key);
    if (!g) {
      g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.45));
      roundCache.set(key, g);
    }
    return g;
  };

  const lam = (c: Color) => new MeshLambertMaterial({ color: c });
  const glow = (c: Color, k: number) => {
    const m = lam(c);
    m.emissive = c.clone();
    m.emissiveIntensity = k;
    return m;
  };
  const M = {
    wallTints: PALETTE.wallTints.map(lam),
    partition: lam(PALETTE.partition),
    door: lam(PALETTE.door),
    handle: lam(PALETTE.handle),
    wood: lam(PALETTE.wood),
    woodDark: lam(PALETTE.woodDark),
    mattress: lam(PALETTE.mattress),
    pillow: lam(PALETTE.pillow),
    blankets: PALETTE.blankets.map(lam),
    sofas: PALETTE.sofas.map(lam),
    rugs: PALETTE.rugs.map(lam),
    wardrobe: lam(PALETTE.wardrobe),
    seam: lam(PALETTE.seam),
    chair: lam(PALETTE.chair),
    pot: lam(PALETTE.pot),
    leaf: lam(PALETTE.leaf),
    leafTones: PALETTE.leafTones.map(lam),
    potTones: PALETTE.potTones.map(lam),
    art: lam(PALETTE.art),
    artInner: PALETTE.artInner.map(lam),
    books: PALETTE.books.map(lam),
    // people carry a little self-light so they stay the focal points in shade
    bodies: PALETTE.bodies.map((c) => glow(c, 0.16)),
    head: glow(PALETTE.head, 0.22),
    pack: lam(PALETTE.pack),
    tv: glow(PALETTE.tv, 0.2),
    coreLight: glow(PALETTE.coreLight, 0.8),
  };
  // Lamps and screens are per room (not shared) so each can glow on its own.
  const lights: RoomLight[] = Array.from({ length: FLOORS * 4 }, () => ({
    lamp: glow(PALETTE.lamp, 1),
    screen: glow(PALETTE.screen, 0.4),
    wash: new MeshBasicMaterial({ map: washTex(), color: hsl(34, 100, 64), transparent: true, depthWrite: false, opacity: 0 }),
    warm: BASE_WARM,
    hover: 0,
    pulse: 0,
    resident: null,
  }));
  // Box face order: +x, -x, +y (floor), -y (ceiling), +z, -z.
  const slabEdge = lam(PALETTE.slabEdge);
  const slabMats = [slabEdge, slabEdge, lam(PALETTE.floor), lam(PALETTE.ceiling), slabEdge, slabEdge];

  const put = (
    parent: Object3D,
    geo: BufferGeometry,
    mat: Material | Material[],
    x: number,
    y: number,
    z: number,
    cast = false
  ) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** Plain (unbevelled) wall or slab from the shared unit box. */
  const block = (
    parent: Object3D,
    mat: Material | Material[],
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number
  ) => {
    const m = put(parent, unitBox, mat, x, y, z, true);
    m.scale.set(sx, sy, sz);
    return m;
  };
  const spoke = (parent: Object3D, ry: number) => {
    const g = new Group();
    g.rotation.y = ry;
    parent.add(g);
    return g;
  };
  const ball = (parent: Object3D, mat: Material, rx: number, ry: number, rz: number, x: number, y: number, z: number) => {
    const m = put(parent, unitSphere, mat, x, y, z, true);
    m.scale.set(rx, ry, rz);
    return m;
  };

  // ── Furniture kit. Each builder works in the item's own frame: back at -z,
  // floor at y = 0. Sizes match FOOTPRINT in layouts.ts.
  type Builder = (g: Group, v: number) => void;
  const KIT: Record<Item['k'], Builder> = {
    bed: (g, v) => {
      put(g, rbox(1.0, 0.3, 2.0, 0.07), M.wood, 0, 0.15, 0, true);
      put(g, rbox(0.94, 0.2, 1.9, 0.07), M.mattress, 0, 0.4, 0.03);
      put(g, rbox(0.98, 0.08, 1.2, 0.04), M.blankets[v % 4], 0, 0.53, 0.38);
      put(g, rbox(0.6, 0.12, 0.32, 0.06), M.pillow, 0, 0.56, -0.7);
      put(g, rbox(1.0, 0.95, 0.08, 0.03), M.woodDark, 0, 0.475, -0.96, true);
    },
    nightstand: (g, v) => {
      put(g, rbox(0.45, 0.5, 0.45, 0.05), M.wood, 0, 0.25, 0, true);
      put(g, rbox(0.08, 0.22, 0.08, 0.02), M.woodDark, 0, 0.61, 0);
      put(g, rbox(0.26, 0.18, 0.26, 0.06), lights[v].lamp, 0, 0.81, 0);
    },
    wardrobe: (g) => {
      put(g, rbox(1.0, 1.9, 0.6, 0.04), M.wardrobe, 0, 0.95, 0, true);
      put(g, rbox(0.015, 1.75, 0.015, 0.005), M.seam, 0, 0.95, 0.3);
      put(g, rbox(0.03, 0.16, 0.03, 0.01), M.handle, -0.07, 1.0, 0.31);
      put(g, rbox(0.03, 0.16, 0.03, 0.01), M.handle, 0.07, 1.0, 0.31);
    },
    desk: (g, v) => {
      put(g, rbox(1.1, 0.06, 0.55, 0.02), M.wood, 0, 0.75, -0.275, true);
      put(g, rbox(0.05, 0.72, 0.5, 0.02), M.woodDark, -0.5, 0.36, -0.275);
      put(g, rbox(0.05, 0.72, 0.5, 0.02), M.woodDark, 0.5, 0.36, -0.275);
      put(g, rbox(0.34, 0.02, 0.24, 0.008), M.seam, -0.1, 0.79, -0.28);
      put(g, rbox(0.34, 0.22, 0.015, 0.006), lights[v].screen, -0.1, 0.91, -0.4);
      put(g, rbox(0.13, 0.12, 0.13, 0.025), M.potTones[v % 4], 0.4, 0.84, -0.4);
      if (v % 2) {
        // Succulent rosette
        ball(g, M.leafTones[v % 4], 0.1, 0.07, 0.1, 0.4, 0.95, -0.4);
        ball(g, M.leafTones[(v + 2) % 4], 0.06, 0.05, 0.06, 0.43, 1.0, -0.37);
      } else {
        // Upright sprig
        for (let i = 0; i < 3; i++) {
          const b = put(spoke(g, 0.4 + i * 2.1), rbox(0.045, 0.17, 0.025, 0.01), M.leafTones[(v + i) % 4], 0.4, 0.98, -0.4, true);
          b.position.z = -0.4;
          b.rotation.x = -0.12;
        }
      }
      // Chair faces the desk; seat height and back vary a touch per room.
      put(g, rbox(0.45, 0.07, 0.45, 0.04), M.chair, 0.0, 0.46, 0.25, true);
      put(g, rbox(0.45, 0.42 + (v % 2) * 0.08, 0.06, 0.03), M.chair, 0.0, 0.72, 0.47, true);
      put(g, rbox(0.08, 0.42, 0.08, 0.02), M.woodDark, 0.0, 0.21, 0.25);
    },
    shelf: (g, v) => {
      put(g, rbox(0.04, 1.7, 0.35, 0.01), M.wood, -0.43, 0.85, 0);
      put(g, rbox(0.04, 1.7, 0.35, 0.01), M.wood, 0.43, 0.85, 0, true);
      for (const y of [0.04, 0.6, 1.15, 1.68]) put(g, rbox(0.9, 0.04, 0.35, 0.01), M.wood, 0, y, 0);
      for (let row = 0; row < 3; row++) {
        const y = [0.06, 0.62, 1.17][row] + 0.12;
        const n = 3 + ((v + row) % 3);
        for (let b = 0; b < n; b++) {
          put(g, rbox(0.08, 0.24, 0.24, 0.015), M.books[(v + row + b) % 4], -0.3 + b * 0.1, y, 0);
        }
      }
    },
    /* Six species, picked by room, so no two rooms share a plant. Each
       instance also gets its own leaf/pot colourway, a yaw offset and a small
       size jitter, so the two rooms sharing a species still differ. */
    plant: (g, v) => {
      const leaf = M.leafTones[v % 4];
      const leaf2 = M.leafTones[(v + 2) % 4];
      const potM = M.potTones[(v + 1) % 4];
      const root = new Group();
      root.rotation.y = ((v * 47) % 360) * DEG;
      root.scale.setScalar(0.92 + ((v * 13) % 7) / 42);
      g.add(root);

      const potTapered = () => {
        put(root, rbox(0.3, 0.3, 0.3, 0.05), potM, 0, 0.15, 0, true);
        put(root, rbox(0.38, 0.08, 0.38, 0.03), potM, 0, 0.33, 0, true);
      };
      const potRound = () => {
        ball(root, potM, 0.19, 0.17, 0.19, 0, 0.17, 0);
        put(root, rbox(0.33, 0.06, 0.33, 0.025), potM, 0, 0.32, 0, true);
      };
      const potCyl = () => put(root, rbox(0.3, 0.38, 0.3, 0.13), potM, 0, 0.19, 0, true);

      switch (v % 6) {
        case 0: {
          // Lidah mertua / snake plant: stiff upright blades, uneven heights.
          potTapered();
          for (let i = 0; i < 6; i++) {
            const h = 0.46 + ((i * 5) % 4) * 0.14;
            const b = put(spoke(root, i * 1.05), rbox(0.08, h, 0.03, 0.013), i % 2 ? leaf : leaf2, 0, 0.36 + h / 2, 0.06, true);
            b.rotation.x = -0.13;
          }
          break;
        }
        case 1: {
          // Monstera: a few thick stems, each carrying one broad flat leaf.
          potCyl();
          for (let i = 0; i < 3; i++) {
            const sp = spoke(root, i * 2.2);
            const h = 0.4 + i * 0.1;
            const st = put(sp, rbox(0.035, h, 0.035, 0.014), leaf2, 0, 0.38 + h / 2, 0.03, true);
            st.rotation.x = -0.18;
            const lf = put(sp, rbox(0.3, 0.025, 0.25, 0.1), leaf, 0, 0.38 + h, 0.13, true);
            lf.rotation.x = 0.26;
          }
          break;
        }
        case 2: {
          // Bushy fern: an irregular cluster, never a stack of equal spheres.
          potRound();
          const blobs: [number, number, number, number][] = [
            [0, 0.56, 0, 0.21],
            [0.13, 0.5, 0.07, 0.15],
            [-0.12, 0.54, -0.06, 0.14],
            [0.05, 0.72, -0.11, 0.13],
            [-0.07, 0.7, 0.1, 0.12],
            [0.01, 0.84, 0.01, 0.1],
          ];
          for (const [x, y, z, r] of blobs) ball(root, x + z > 0 ? leaf : leaf2, r, r * 0.84, r, x, y, z);
          break;
        }
        case 3: {
          // Palm: slim trunk with fronds arching outward and down.
          potTapered();
          const tr = put(root, rbox(0.06, 0.5, 0.06, 0.022), leaf2, 0, 0.62, 0, true);
          tr.rotation.z = 0.05;
          for (let i = 0; i < 5; i++) {
            const f = put(spoke(root, i * 1.257), rbox(0.13, 0.025, 0.36, 0.055), leaf, 0, 0.86, 0.17, true);
            f.rotation.x = 0.42;
          }
          break;
        }
        case 4: {
          // Cactus: a column with one stub arm each side.
          potCyl();
          put(root, rbox(0.17, 0.62, 0.17, 0.08), leaf, 0, 0.69, 0, true);
          for (const sx of [1, -1]) {
            put(root, rbox(0.19, 0.08, 0.08, 0.035), leaf, sx * 0.12, 0.66, 0, true);
            put(root, rbox(0.085, 0.24, 0.085, 0.04), leaf, sx * 0.18, 0.8, 0, true);
          }
          break;
        }
        default: {
          // Pothos: a low mound with trailing shoots over the rim.
          potRound();
          ball(root, leaf, 0.2, 0.14, 0.2, 0, 0.44, 0);
          for (let i = 0; i < 4; i++) {
            const d = put(spoke(root, i * 1.55), rbox(0.07, 0.3, 0.03, 0.014), leaf2, 0, 0.34, 0.16, true);
            d.rotation.x = 0.55;
          }
        }
      }
    },
    dresser: (g) => {
      put(g, rbox(1.1, 0.8, 0.5, 0.03), M.wood, 0, 0.4, 0, true);
      put(g, rbox(1.0, 0.012, 0.01, 0.004), M.seam, 0, 0.3, 0.25);
      put(g, rbox(1.0, 0.012, 0.01, 0.004), M.seam, 0, 0.55, 0.25);
      put(g, rbox(0.12, 0.06, 0.12, 0.02), M.woodDark, 0, 0.83, -0.1);
      put(g, rbox(0.75, 0.44, 0.04, 0.015), M.tv, 0, 1.08, -0.1, true);
    },
    sofa: (g, v) => {
      const m = M.sofas[v % 3];
      put(g, rbox(1.6, 0.42, 0.8, 0.06), m, 0, 0.21, 0, true);
      put(g, rbox(1.6, 0.5, 0.2, 0.06), m, 0, 0.62, -0.3, true);
      put(g, rbox(0.18, 0.55, 0.8, 0.05), m, -0.71, 0.3, 0);
      put(g, rbox(0.18, 0.55, 0.8, 0.05), m, 0.71, 0.3, 0);
      put(g, rbox(0.62, 0.12, 0.55, 0.05), M.pillow, -0.33, 0.48, 0.06);
      put(g, rbox(0.62, 0.12, 0.55, 0.05), M.pillow, 0.33, 0.48, 0.06);
    },
  };

  const hitMat = new MeshBasicMaterial({ visible: false });
  const washGeo = new PlaneGeometry(1, 1);
  const hitBoxes: Mesh[] = [];

  // ── One room, in its own local frame (see layouts.ts) ──────────────────
  function buildRoom(floor: Group, quarter: number, layout: Layout, v: number): DoorState {
    const room = new Group();
    room.rotation.y = quarter * (Math.PI / 2);
    floor.add(room);
    const wall = M.wallTints[v % 4];

    /* Walls BUTT against each other - they never overlap. Overlapping boxes
       leave coplanar faces that z-fight into a flickering dotted strip. Each
       core corner is owned by exactly one room's corridor wall (its left
       end); the next room's partition starts where that wall stops. */

    // Partition to the next room, from the corridor wall's face to the outer
    // edge; its cut end shows the wall's thickness, which reads as a section.
    const pz0 = CORE + WALL_T / 2;
    block(room, M.partition, WALL_T, CLEAR, HALF - pz0, CORE, CLEAR / 2, (pz0 + HALF) / 2);

    // Corridor wall: left jamb (owning this room's left core corner) + header.
    // The door's hinge side meets the next room's corner piece directly.
    const leftX0 = -CORE - WALL_T / 2;
    block(room, wall, DOOR_X0 - leftX0, CLEAR, WALL_T, (leftX0 + DOOR_X0) / 2, CLEAR / 2, CORE);
    block(room, wall, DOOR_W, CLEAR - DOOR_H, WALL_T, (DOOR_X0 + DOOR_X1) / 2, (DOOR_H + CLEAR) / 2, CORE);

    // Door on a hinge pivot so rotation.y swings it into the room.
    const pivot = new Group();
    pivot.position.set(DOOR_X1, 0, CORE);
    room.add(pivot);
    put(pivot, rbox(DOOR_W - 0.03, DOOR_H - 0.015, 0.06, 0.02), M.door, -DOOR_W / 2, DOOR_H / 2, 0, true);
    put(pivot, rbox(0.04, 0.04, 0.11, 0.015), M.handle, -DOOR_W + 0.09, DOOR_H * 0.48, 0);

    // Rug, art, then the layout's furniture.
    put(room, rbox(1.4, 0.02, 1.0, 0.01), M.rugs[(v + 1) % 4], layout.rug[0], 0.01, layout.rug[1]);
    put(room, rbox(0.7, 0.5, 0.04, 0.015), M.art, layout.art, 1.95, BACK_FACE + 0.02);
    put(room, rbox(0.6, 0.4, 0.02, 0.008), M.artInner[v % 4], layout.art, 1.95, BACK_FACE + 0.045);
    for (const item of layout.items) {
      const g = new Group();
      g.position.set(item.x, 0, item.z);
      g.rotation.y = item.r * DEG;
      room.add(g);
      KIT[item.k](g, v);
    }
    // Lamplight pooled on the back wall (a plane ON the wall, so it can never
    // spill past the room's cut faces onto the page) + an invisible volume for
    // hover/click.
    const wash = new Mesh(washGeo, lights[v].wash);
    wash.scale.set(3.3, 2.5, 1);
    wash.position.set((-HALF + PART_FACE) / 2, CLEAR * 0.52, BACK_FACE + 0.015);
    wash.renderOrder = 2;
    room.add(wash);
    const hit = new Mesh(unitBox, hitMat);
    hit.scale.set(HALF + PART_FACE, CLEAR, HALF - BACK_FACE);
    hit.position.set((-HALF + PART_FACE) / 2, CLEAR / 2, (BACK_FACE + HALF) / 2);
    hit.userData.ri = v;
    room.add(hit);
    hitBoxes.push(hit);
    return { pivot, value: 0, target: 0 };
  }

  // ── Floors, rooms, residents ────────────────────────────────────────────
  const floors: FloorState[] = [];
  const toFloor = (room: number, x: number, z: number): [number, number] => {
    const a = room * (Math.PI / 2);
    return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
  };

  for (let i = 0; i < FLOORS; i++) {
    const g = new Group();
    g.position.y = i * FLOOR_H;
    scene.add(g);
    block(g, slabMats, HALF * 2, SLAB_T, HALF * 2, 0, -SLAB_T / 2, 0);
    put(g, rbox(0.5, 0.04, 0.5, 0.015), M.coreLight, 0, CLEAR - 0.03, 0);

    const doors: DoorState[] = [];
    const residents: Resident[] = [];
    for (let q = 0; q < 4; q++) {
      const ri = i * 4 + q;
      const layout = LAYOUTS[ri];
      const door = buildRoom(g, q, layout, ri);
      doors.push(door);

      const rg = new Group();
      put(rg, bodyGeo, M.bodies[(ri + i) % 3], 0, 0.565, 0, true);
      put(rg, headGeo, M.head, 0, 1.3, 0, true);
      put(rg, rbox(0.26, 0.36, 0.13, 0.05), M.pack, 0, 0.78, -0.2, true); // a student's backpack
      rg.visible = false;
      g.add(rg);

      const nav = buildNav(layout);
      const r: Resident = {
        g: rg,
        room: q,
        nav,
        door,
        phase: 'away',
        after: 'out',
        t: rng() * 9, // random start: nobody begins in step
        speed: 0.55 + rng() * 0.45, // each resident walks at their own pace
        path: [],
        pos: [CORRIDOR[0], CORRIDOR[1]],
        node: 0,
        stops: 0,
        heading: 0,
        stride: 0,
        hop: -1,
        ri,
      };
      lights[ri].resident = r;
      // Some residents are already home when the scene appears.
      if ((ri === HERO_ROOM || rng() < 0.45) && nav.wander.length) {
        r.node = nav.wander[Math.floor(rng() * nav.wander.length)];
        r.pos = [...nav.pts[r.node]] as [number, number];
        r.phase = 'pause';
        r.t = rng() * 4;
        r.stops = 1 + Math.floor(rng() * 3);
        r.heading = rng() * Math.PI * 2;
        rg.visible = true;
      }
      residents.push(r);
    }
    floors.push({ group: g, residents, doors, turnIn: 6 + rng() * 18, turning: -1, fromY: 0 });
  }
  block(scene, slabMats, HALF * 2, SLAB_T, HALF * 2, 0, FLOORS * FLOOR_H - SLAB_T / 2, 0);

  // ── Camera: isometric-like - raised and looking down at 10deg so the room
  // floors read, aimed at the centre of the front room. This rest pose is what
  // the page CSS and the poster are measured against; the pointer and a slow
  // idle drift only sway it a few degrees around the same target.
  const target = { x: -(HALF - CORE) / 2, y: FOCUS * FLOOR_H + 1.3, z: (HALF + CORE) / 2 };
  const DIST = 22; // between the tight crop and the full pull-back
  const AZ = -45 * DEG;
  const EL = 10 * DEG;
  const aim = (az: number, el: number) => {
    camera.position.set(
      target.x + DIST * Math.sin(az) * Math.cos(el),
      target.y + DIST * Math.sin(el),
      target.z + DIST * Math.cos(az) * Math.cos(el)
    );
    camera.lookAt(target.x, target.y, target.z);
  };
  aim(AZ, EL);

  // ── Light: a warm key from the open corner (the only shadow caster), a cool
  // sky/ground fill and a cool front fill, so lit faces run warm and shaded ones
  // run teal. The cycle in the loop eases these between DAY and DUSK.
  const hemi = new HemisphereLight(DAY.sky, DAY.gnd, DAY.hemiI);
  scene.add(hemi);
  const coolFill = new DirectionalLight(hsl(186, 60, 78), 0.5);
  coolFill.position.set(target.x + 4, target.y + 3, target.z + 10);
  coolFill.target.position.set(target.x, target.y, target.z);
  scene.add(coolFill, coolFill.target);
  const sun = new DirectionalLight(DAY.sun, DAY.sunI);
  sun.position.set(target.x - 6.5, target.y + DAY.sunY, target.z + 7.5);
  sun.target.position.set(target.x, target.y - 0.5, target.z - 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  sun.shadow.intensity = 0.78; // readable, but tinted by the fill, never black
  const sc = sun.shadow.camera;
  sc.left = -5.5;
  sc.right = 5.5;
  sc.top = 5.5;
  sc.bottom = -5.5;
  sc.near = 0.5;
  sc.far = 40;
  scene.add(sun, sun.target);

  const camSway = { x: 0, y: 0 };
  // The focal room is whichever room of the focus floor currently faces the
  // camera (floors turn), so the lit, mostly-home room never drifts out of view.
  let hero = HERO_ROOM;
  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let onScreen = true;
  const io = new IntersectionObserver((e) => {
    onScreen = e[e.length - 1].isIntersecting;
  });
  io.observe(host);
  let tabVisible = document.visibilityState !== 'hidden';
  const onVis = () => {
    tabVisible = document.visibilityState !== 'hidden';
  };
  document.addEventListener('visibilitychange', onVis);
  let frozen = false;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const onMotion = () => {
    if (mq.matches) frozen = true;
  };
  mq.addEventListener('change', onMotion);

  // ── Pointer: a few degrees of camera sway, hover warms a room, click says hi.
  // Decorative only, mouse/pen only for the sway; never intercepts page clicks
  // (listeners are passive and the hit test is against our own rooms).
  const ray = new Raycaster();
  const ndc = new Vector2();
  const ptr = { x: 0, y: 0, moved: false, seen: false };
  const sway = { x: 0, y: 0 }; // smoothed -1..1
  let hovered = -1;
  const pick = (cx: number, cy: number) => {
    const r = host.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return -1;
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hitBoxes, false)[0];
    return hit ? (hit.object.userData.ri as number) : -1;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.moved = true;
    ptr.seen = true;
  };
  const onLeave = () => {
    ptr.seen = false;
    ptr.moved = true;
  };
  const onClick = (e: MouseEvent) => {
    const i = pick(e.clientX, e.clientY);
    if (i < 0) return;
    const l = lights[i];
    l.pulse = 1;
    const r = l.resident;
    if (!r) return;
    if (r.phase === 'away') r.t = 0; // knock: the resident comes home
    else if (r.phase === 'pause' && r.hop < 0) r.hop = 0;
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave, { passive: true });
  host.addEventListener('click', onClick);

  // ── Behaviour ───────────────────────────────────────────────────────────
  const lerpAngle = (a: number, b: number, k: number) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  };

  const place = (r: Resident) => {
    const [fx, fz] = toFloor(r.room, r.pos[0], r.pos[1]);
    const bob = r.phase === 'walk' ? Math.abs(Math.sin(r.stride * 5.2)) * 0.035 : 0;
    // "Hi" hop: quick rise, soft landing.
    const hop = r.hop >= 0 ? Math.sin(Math.PI * r.hop) * 0.34 : 0;
    r.g.position.set(fx, bob + hop, fz);
    r.g.rotation.y = r.heading + r.room * (Math.PI / 2);
  };

  const walkTo = (r: Resident, path: [number, number][], after: After) => {
    r.path = path;
    r.after = after;
    r.phase = 'walk';
  };

  const pickStop = (r: Resident) => {
    const w = r.nav.wander;
    for (let tries = 0; tries < 8; tries++) {
      const n = w[Math.floor(rng() * w.length)];
      const p = r.nav.pts[n];
      // Prefer somewhere a little way off, so stops read as deliberate moves.
      if (n !== r.node && Math.hypot(p[0] - r.pos[0], p[1] - r.pos[1]) > 0.9) return n;
    }
    return w[Math.floor(rng() * w.length)];
  };

  const stepResident = (r: Resident, dt: number) => {
    switch (r.phase) {
      case 'away':
        r.t -= dt;
        if (r.t <= 0) {
          r.pos = [CORRIDOR[0], CORRIDOR[1]];
          r.heading = 0;
          r.g.visible = true;
          r.door.target = 1;
          r.phase = 'callDoor';
        }
        break;
      case 'callDoor':
        // Wait in the corridor until the door is actually open.
        if (r.door.value > 0.9) walkTo(r, [ENTRY], 'inside');
        break;
      case 'waitDoorOut':
        if (r.door.value > 0.9) walkTo(r, [CORRIDOR], 'out');
        break;
      case 'pause':
        r.t -= dt;
        if (r.t <= 0) {
          if (r.stops > 0 && r.nav.wander.length) {
            r.stops -= 1;
            const n = pickStop(r);
            walkTo(r, r.nav.route(r.node, n), 'arrived');
            r.node = n;
          } else {
            walkTo(r, r.nav.route(r.node, 0), 'toDoor');
            r.node = 0;
          }
        }
        break;
      case 'walk': {
        let budget = r.speed * dt;
        while (budget > 0 && r.path.length) {
          const [tx, tz] = r.path[0];
          const dx = tx - r.pos[0];
          const dz = tz - r.pos[1];
          const d = Math.hypot(dx, dz);
          if (d > 1e-4) r.heading = lerpAngle(r.heading, Math.atan2(dx, dz), Math.min(1, dt * 10));
          // The door starts opening as the resident approaches it to leave.
          if (r.after === 'toDoor' && Math.hypot(ENTRY[0] - r.pos[0], ENTRY[1] - r.pos[1]) < 1.1) r.door.target = 1;
          if (d <= budget) {
            r.pos = [tx, tz];
            r.path.shift();
            budget -= d;
          } else {
            r.pos = [r.pos[0] + (dx / d) * budget, r.pos[1] + (dz / d) * budget];
            r.stride += budget;
            budget = 0;
          }
        }
        if (!r.path.length) {
          switch (r.after) {
            case 'inside':
              r.door.target = 0;
              r.node = 0;
              r.stops = 2 + Math.floor(rng() * 4);
              r.phase = 'pause';
              r.t = 0.3 + rng() * 1.2;
              break;
            case 'arrived':
              r.phase = 'pause';
              // Mostly short looks around; sometimes settle for a while.
              r.t = rng() < 0.25 ? 4 + rng() * 5 : 0.6 + rng() * 2.8;
              if (rng() < 0.5) r.heading += (rng() - 0.5) * Math.PI;
              break;
            case 'toDoor':
              r.door.target = 1;
              r.phase = 'waitDoorOut';
              break;
            case 'out':
              r.door.target = 0;
              r.g.visible = false;
              r.phase = 'away';
              r.t = r.ri === hero ? 0.8 + rng() * 2 : 2 + rng() * 11; // long, uneven absences (short for the focal room)
              break;
          }
        }
        break;
      }
    }
    place(r);
  };

  const stepFloor = (f: FloorState, dt: number) => {
    if (f.turning >= 0) {
      f.turning += dt;
      const p = Math.min(1, f.turning / TURN_S);
      f.group.rotation.y = f.fromY + (Math.PI / 2) * easeInOutBack(p);
      if (p >= 1) {
        f.group.rotation.y = f.fromY + Math.PI / 2;
        f.turning = -1;
        f.turnIn = 14 + rng() * 14;
      }
      return; // residents and doors hold still mid-turn
    }
    f.turnIn -= dt;
    if (f.turnIn <= 0) {
      f.fromY = f.group.rotation.y;
      f.turning = 0;
      return;
    }
    for (const d of f.doors) {
      const rate = dt / 0.6;
      d.value = d.target > d.value ? Math.min(d.target, d.value + rate) : Math.max(d.target, d.value - rate);
      d.pivot.rotation.y = DOOR_OPEN * easeInOutSine(d.value);
    }
    for (const r of f.residents) stepResident(r, dt);
  };

  for (const f of floors) for (const r of f.residents) place(r);

  const timer = new Timer();
  let clock = 0; // simulated seconds (dt is clamped, so this never jumps)
  const mixIn = new Color();
  const warmCol = new Color();
  let raf = 0;
  let first = true;
  let stopped = false;
  const loop = (ts: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    timer.update(ts);
    if (frozen || !onScreen || !tabVisible) return;
    const dt = Math.min(timer.getDelta(), 0.05);
    clock += dt;
    for (const f of floors) stepFloor(f, dt);

    // Hover (only re-tested when the pointer moved).
    if (ptr.moved) {
      ptr.moved = false;
      hovered = ptr.seen ? pick(ptr.x, ptr.y) : -1;
      host.style.cursor = hovered >= 0 ? 'pointer' : '';
      const hr = host.getBoundingClientRect();
      const half = Math.max(1, window.innerWidth / 2);
      // No sway while the pointer is over the copy column (left of the stage):
      // the building must not move while someone reads or types.
      const t = Math.max(0, Math.min(1, (ptr.x - (hr.left - 160)) / 160));
      const gain = ptr.seen ? t * t * (3 - 2 * t) : 0;
      sway.x = Math.max(-1, Math.min(1, (ptr.x - (hr.left + hr.width / 2)) / half)) * gain;
      sway.y = Math.max(-1, Math.min(1, (ptr.y - (hr.top + hr.height / 2)) / (window.innerHeight / 2))) * gain;
    }

    // Camera: eased pointer sway + a slow idle drift (both zero at t = 0, so the
    // first frame equals the poster).
    const ease = 1 - Math.exp(-dt * 3);
    camSway.x += (sway.x - camSway.x) * ease;
    camSway.y += (sway.y - camSway.y) * ease;
    aim(
      AZ + (camSway.x * 3.5 + Math.sin(clock * 0.21) * 1.1) * DEG,
      EL + (-camSway.y * 1.8 + Math.sin(clock * 0.17) * 0.5) * DEG
    );

    const front = (4 - (Math.round(floors[FOCUS].group.rotation.y / (Math.PI / 2)) % 4) + 4) % 4;
    if (FOCUS * 4 + front !== hero) {
      hero = FOCUS * 4 + front;
      const hr0 = lights[hero].resident;
      if (hr0 && hr0.phase === 'away') hr0.t = Math.min(hr0.t, 1.2);
    }

    // Light cycle: midday -> golden hour -> midday, eased.
    const mood = MOOD0 + (1 - MOOD0) * (0.5 - 0.5 * Math.cos((clock / CYCLE_S) * Math.PI * 2));
    sun.color.copy(DAY.sun).lerp(DUSK.sun, mood);
    sun.intensity = DAY.sunI + (DUSK.sunI - DAY.sunI) * mood;
    sun.position.set(target.x - 6.5 + camSway.x * 1.6, target.y + DAY.sunY + (DUSK.sunY - DAY.sunY) * mood, target.z + 7.5);
    hemi.color.copy(DAY.sky).lerp(DUSK.sky, mood);
    hemi.groundColor.copy(DAY.gnd).lerp(DUSK.gnd, mood);
    hemi.intensity = DAY.hemiI + (DUSK.hemiI - DAY.hemiI) * mood;

    // Room lights: lamps follow who is home; hover and clicks warm a room;
    // lamps come on one by one after the first frame (light-only intro).
    const lk = 1 - Math.exp(-dt * 3);
    lights.forEach((l, i) => {
      const r = l.resident;
      const home = r && r.g.visible && r.phase !== 'callDoor' ? 1 : 0;
      l.hover += ((hovered === i ? 1 : 0) - l.hover) * (1 - Math.exp(-dt * 6));
      l.pulse *= Math.exp(-dt * 1.4);
      const on = clock > 0.8 + i * 0.1;
      const full = BASE_WARM + 0.38 * home + 0.35 * l.hover + 0.4 * l.pulse + (i === hero ? 0.18 : 0) + 0.2 * mood;
      l.warm += ((on ? full : BASE_WARM) - l.warm) * lk;
      l.lamp.emissiveIntensity = 0.45 + 1.7 * l.warm;
      l.screen.emissiveIntensity = 0.2 + 0.6 * l.warm;
      l.wash.opacity = Math.min(0.55, 0.05 + 0.4 * l.warm);
      if (r && r.hop >= 0) {
        r.hop += dt / 0.7;
        if (r.hop >= 1) r.hop = -1;
        place(r);
      }
    });
    warmCol.setHSL((34 - 6 * mood) / 360, 1, 0.64);
    mixIn.copy(warmCol);
    for (const l of lights) l.wash.color.copy(mixIn);

    renderer.render(scene, camera);
    if (first) {
      first = false;
      onFirstFrame?.();
    }
  };
  raf = requestAnimationFrame(loop);

  return () => {
    if (stopped) return;
    stopped = true;
    // 1. stop rendering first
    cancelAnimationFrame(raf);
    // 2. observers + listeners
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    mq.removeEventListener('change', onMotion);
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    host.removeEventListener('click', onClick);
    host.style.cursor = '';
    // 3. dispose geometries + materials (Sets: both are shared)
    const geos = new Set<{ dispose(): void }>();
    const mats = new Set<Material>();
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      const mm = mesh.material as Material | Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
      else if (mm) mats.add(mm);
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((x) => x.dispose());
    lights.forEach((l) => {
      l.wash.map?.dispose();
      l.wash.dispose();
    });
    scene.clear();
    // 4. + 5. free the renderer (incl. shadow map), then release the GPU context
    renderer.dispose();
    renderer.forceContextLoss();
    // 6. detach
    renderer.domElement.remove();
  };
}
