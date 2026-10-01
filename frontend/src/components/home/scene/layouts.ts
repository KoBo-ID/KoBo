/**
 * Room geometry, the 12 room layouts and the resident wander-area maths.
 *
 * Pure data + math, no three.js import, so it stays out of the WebGL concerns
 * and can be validated on its own (overlaps, door clearance, walkable area).
 *
 * Units are METRES. Rooms sit on a 4.0 x 3.0 m structural grid with 0.375 m
 * partitions, so the CLEAR interior is ~3.81 m wide and the ceiling is set to
 * keep the open face you look at at exactly 5 : 4. In the pinwheel floor plan
 * the corridor core's side equals width - depth.
 *
 * Room-local frame:
 *   x in [-HALF, CORE]  (4.0 m)  - the +x side is the partition to the next room
 *   z in [CORE, HALF]   (3.0 m)  - the z = CORE side is the corridor wall + door
 *   the -x and +z faces are the cut-away section, open to the camera.
 */

export const HALF = 3.5;
export const CORE = 0.5;
export const SLAB_T = 0.25;
/** Partitions read as solid masonry: 1.5x the floor slab's thickness. */
export const WALL_T = SLAB_T * 1.5;
/** Clear interior width, i.e. what you actually see through the open face. */
export const CLEAR_W = HALF + CORE - WALL_T / 2;
/** Ceiling set so the open face is exactly 5:4. */
export const CLEAR = CLEAR_W / 1.25;
export const FLOOR_H = CLEAR + SLAB_T;

// Door in the corridor wall, hinged on its +x edge so it opens flat against
// the partition.
export const DOOR_X1 = CORE - WALL_T / 2; // hinge meets the partition face
export const DOOR_X0 = DOOR_X1 - 0.6;
export const DOOR_H = 2.05;

/** Inner wall faces. */
export const BACK_FACE = CORE + WALL_T / 2; // 0.45
export const PART_FACE = CORE - WALL_T / 2; // 0.30

/** Where a resident stands just inside the doorway, and out in the corridor. */
export const ENTRY: [number, number] = [(DOOR_X0 + DOOR_X1) / 2, BACK_FACE + 0.4];
export const CORRIDOR: [number, number] = [(DOOR_X0 + DOOR_X1) / 2, BACK_FACE - 0.4];

/** Floor area furniture may never occupy: the door swing plus the entry. */
const KEEP_OUT = { x0: DOOR_X0 - 0.2, x1: PART_FACE, z0: BACK_FACE, z1: BACK_FACE + 0.8 };

export type Kind =
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'desk'
  | 'shelf'
  | 'plant'
  | 'dresser'
  | 'sofa';

/** Footprint in the item's own frame: w along local x, d along local z. The
 *  item's back is at -z, so rotation 0 puts its back against the back wall. */
export const FOOTPRINT: Record<Kind, [number, number]> = {
  bed: [1.0, 2.0],
  nightstand: [0.45, 0.45],
  wardrobe: [1.0, 0.6],
  desk: [1.1, 1.1], // desk + its chair
  shelf: [0.9, 0.35],
  plant: [0.45, 0.45],
  dresser: [1.1, 0.5],
  sofa: [1.6, 0.8],
};

/** r: 0 back to back wall, 90 back to the left edge, 180 back to the front
 *  edge, 270 back to the partition. */
export interface Item {
  k: Kind;
  x: number;
  z: number;
  r: 0 | 90 | 180 | 270;
}

export interface Layout {
  items: Item[];
  /** rug centre */
  rug: [number, number];
  /** x of the framed art on the back wall */
  art: number;
}

const it = (k: Kind, x: number, z: number, r: Item['r'] = 0): Item => ({ k, x, z, r });

/* Twelve rooms, all different: 3 floors x 4 rooms. Beds rotate between the
   back wall, the partition and the open left edge; desks, wardrobes, shelves,
   sofas and dressers move around them. */
/* Authored for the original 3.75 m room (core half 0.375). rebase() below
   moves them into the current room. */
const AUTHORED: Layout[] = [
  {
    items: [it('bed', -2.8, 1.45), it('nightstand', -2.0, 0.675), it('wardrobe', -1.2, 0.75), it('desk', -0.25, 2.4, 270), it('plant', -2.0, 3.05)],
    rug: [-1.4, 2.3],
    art: -2.8,
  },
  {
    items: [it('bed', -2.325, 2.7, 90), it('desk', -1.5, 1.0), it('wardrobe', -2.8, 0.75), it('shelf', 0.125, 2.2, 270)],
    rug: [-0.9, 1.9],
    art: -1.5,
  },
  {
    items: [it('bed', -0.7, 2.7, 270), it('nightstand', 0.075, 1.9, 270), it('desk', -2.6, 1.0), it('wardrobe', -1.4, 0.75), it('sofa', -2.925, 2.5, 90)],
    rug: [-1.6, 2.0],
    art: -2.6,
  },
  {
    items: [it('bed', -2.0, 1.45), it('nightstand', -1.15, 0.675), it('wardrobe', -3.025, 1.0, 90), it('desk', -0.25, 2.65, 270), it('plant', -2.6, 3.0)],
    rug: [-1.2, 2.4],
    art: -2.0,
  },
  {
    items: [it('bed', -2.325, 1.0, 90), it('desk', -1.0, 2.775, 180), it('wardrobe', 0.0, 2.6, 270), it('plant', -3.0, 1.95)],
    rug: [-1.8, 2.1],
    art: -1.0,
  },
  {
    items: [it('bed', -2.8, 1.45), it('desk', -1.5, 1.0), it('wardrobe', 0.0, 1.9, 270), it('sofa', -1.2, 2.925, 180), it('plant', -3.0, 3.0)],
    rug: [-1.4, 2.0],
    art: -2.8,
  },
  {
    items: [it('bed', -0.7, 2.7, 270), it('desk', -2.775, 1.2, 90), it('wardrobe', -1.6, 0.75), it('plant', -3.1, 3.1)],
    rug: [-1.6, 1.9],
    art: -1.6,
  },
  {
    items: [it('bed', -2.325, 2.775, 90), it('nightstand', -3.1, 1.95), it('desk', -0.25, 2.6, 270), it('wardrobe', -2.8, 0.75), it('dresser', -1.6, 0.7)],
    rug: [-1.4, 1.7],
    art: -1.6,
  },
  {
    items: [it('bed', -2.8, 1.45), it('nightstand', -2.0, 0.675), it('shelf', -1.3, 0.625), it('desk', -1.6, 2.775, 180), it('plant', -3.0, 3.0)],
    rug: [-1.4, 1.9],
    art: -2.8,
  },
  {
    items: [it('sofa', -0.1, 2.4, 270), it('bed', -2.8, 1.45), it('wardrobe', -1.75, 0.75), it('dresser', -1.5, 3.075, 180), it('plant', -3.0, 3.0)],
    rug: [-1.4, 2.1],
    art: -2.8,
  },
  {
    items: [it('bed', -2.325, 2.1, 90), it('nightstand', -3.1, 3.05), it('desk', -2.7, 1.0), it('wardrobe', -1.4, 0.75), it('sofa', -0.5, 2.925, 180), it('plant', 0.0, 2.0)],
    rug: [-0.9, 1.9],
    art: -2.7,
  },
  {
    items: [it('bed', -2.85, 1.5), it('shelf', 0.125, 2.2, 270), it('desk', -1.2, 2.8, 180), it('plant', -0.1, 3.1)],
    rug: [-1.2, 2.0],
    art: -0.9,
  },
];

/** Geometry the layouts were authored against. */
const AUTH = { core: 0.375, half: 3.375, back: 0.45, part: 0.3 };

/**
 * Rebase an authored layout onto the current room.
 *
 * Both axes are remapped the same way: an item flush against an edge stays
 * flush against that edge, anything free-standing moves proportionally, and
 * everything is clamped inside the clear interior. Translating z alone was not
 * enough once thicker partitions changed the room's depth as well as its
 * width - items flush to the open front edge ended up outside the room.
 */
function rebase(l: Layout): Layout {
  const map = (c: number, lo0: number, hi0: number, lo1: number, hi1: number, e: number) => {
    if (c - e <= lo0 + 0.01) return lo1 + e;
    if (c + e >= hi0 - 0.01) return hi1 - e;
    const t = (c - lo0) / (hi0 - lo0);
    return Math.min(hi1 - e, Math.max(lo1 + e, lo1 + t * (hi1 - lo1)));
  };
  const mapX = (x: number, e = 0) => map(x, -AUTH.half, AUTH.part, -HALF, PART_FACE, e);
  const mapZ = (z: number, e = 0) => map(z, AUTH.back, AUTH.half, BACK_FACE, HALF, e);
  return {
    items: l.items.map((item) => {
      const b = footprint(item);
      return {
        ...item,
        x: mapX(item.x, (b.x1 - b.x0) / 2),
        z: mapZ(item.z, (b.z1 - b.z0) / 2),
      };
    }),
    rug: [mapX(l.rug[0]), mapZ(l.rug[1])],
    art: mapX(l.art),
  };
}

export const LAYOUTS: Layout[] = AUTHORED.map(rebase);

export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Axis-aligned footprint of an item in room-local coordinates. */
export function footprint(item: Item): Box2 {
  const [w, d] = FOOTPRINT[item.k];
  const sideways = item.r === 90 || item.r === 270;
  const ex = (sideways ? d : w) / 2;
  const ez = (sideways ? w : d) / 2;
  return { x0: item.x - ex, x1: item.x + ex, z0: item.z - ez, z1: item.z + ez };
}

const RESIDENT_R = 0.25; // body radius plus a little elbow room
const GRID = 0.25;

function blocked(layout: Layout, x: number, z: number): boolean {
  if (x < -HALF + 0.3 || x > PART_FACE - 0.22 || z < BACK_FACE + 0.22 || z > HALF - 0.3) return true;
  for (const item of layout.items) {
    const b = footprint(item);
    if (x > b.x0 - RESIDENT_R && x < b.x1 + RESIDENT_R && z > b.z0 - RESIDENT_R && z < b.z1 + RESIDENT_R) {
      return true;
    }
  }
  return false;
}

/** True when a resident can walk the straight line a -> b without clipping furniture. */
export function segmentClear(layout: Layout, a: [number, number], b: [number, number]): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(len / 0.06));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (blocked(layout, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
  }
  return true;
}

export interface NavMesh {
  /** node 0 is always the doorway entry */
  pts: [number, number][];
  /** nodes reachable from the door, excluding the doorway itself: the wander area */
  wander: number[];
  /** walkable polyline from node a to node b, string-pulled, excluding a */
  route: (a: number, b: number) => [number, number][];
}

/**
 * Per-room navigation. A 0.25 m grid of free floor points, linked to their
 * 8 neighbours when the step between them is clear, searched breadth-first
 * from the doorway. The connected set IS this room's wander area, so it
 * differs per layout, and every route bends around that room's furniture.
 */
export function buildNav(layout: Layout): NavMesh {
  const pts: [number, number][] = [ENTRY];
  for (let x = -HALF + 0.3; x <= PART_FACE - 0.2; x += GRID) {
    for (let z = BACK_FACE + 0.25; z <= HALF - 0.3; z += GRID) {
      const p: [number, number] = [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000];
      if (Math.hypot(p[0] - ENTRY[0], p[1] - ENTRY[1]) < 0.12) continue;
      if (!blocked(layout, p[0], p[1])) pts.push(p);
    }
  }
  const adj: number[][] = pts.map(() => []);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d <= GRID * 1.5 && segmentClear(layout, pts[i], pts[j])) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const bfs = (from: number) => {
    const prev = new Array<number>(pts.length).fill(-2);
    prev[from] = -1;
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      for (const n of adj[c]) if (prev[n] === -2) {
        prev[n] = c;
        q.push(n);
      }
    }
    return prev;
  };
  const fromDoor = bfs(0);
  const wander = pts
    .map((_, i) => i)
    .filter((i) => i !== 0 && fromDoor[i] !== -2 && Math.hypot(pts[i][0] - ENTRY[0], pts[i][1] - ENTRY[1]) > 0.6);

  const route = (a: number, b: number): [number, number][] => {
    const prev = bfs(a);
    if (prev[b] === -2) return [pts[b]];
    const chain: number[] = [];
    for (let c = b; c !== -1; c = prev[c]) chain.push(c);
    chain.reverse(); // a ... b
    // String-pull: skip intermediate nodes whenever the straight line is clear,
    // so residents walk natural diagonals instead of grid staircases.
    const out: [number, number][] = [];
    let anchor = pts[a];
    let i = 1;
    while (i < chain.length) {
      let far = i;
      while (far + 1 < chain.length && segmentClear(layout, anchor, pts[chain[far + 1]])) far++;
      out.push(pts[chain[far]]);
      anchor = pts[chain[far]];
      i = far + 1;
    }
    return out;
  };

  return { pts, wander, route };
}

/** Build-time sanity check: overlaps, room bounds, door clearance, wander area. */
export function validate(layout: Layout, label: string): string[] {
  const errs: string[] = [];
  const boxes = layout.items.map(footprint);
  boxes.forEach((b, i) => {
    const k = layout.items[i].k;
    if (b.x0 < -HALF - 1e-6 || b.x1 > PART_FACE + 1e-6 || b.z0 < BACK_FACE - 1e-6 || b.z1 > HALF + 1e-6) {
      errs.push(`${label}: ${k} outside room`);
    }
    if (b.x0 < KEEP_OUT.x1 && b.x1 > KEEP_OUT.x0 && b.z0 < KEEP_OUT.z1 && b.z1 > KEEP_OUT.z0) {
      errs.push(`${label}: ${k} blocks the door`);
    }
    for (let j = i + 1; j < boxes.length; j++) {
      const o = boxes[j];
      if (b.x0 < o.x1 - 0.02 && b.x1 > o.x0 + 0.02 && b.z0 < o.z1 - 0.02 && b.z1 > o.z0 + 0.02) {
        errs.push(`${label}: ${k} overlaps ${layout.items[j].k}`);
      }
    }
  });
  const n = buildNav(layout).wander.length;
  if (n < 10) errs.push(`${label}: only ${n} wander points`);
  return errs;
}
