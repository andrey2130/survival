// Data-driven world layout: regions (map chunks) and every purchase zone / building.
// Adding a new building of an existing kind = adding an entry here, no code changes.

export type Currency = 'money' | 'gold';
export type ItemType = 'log' | 'meat' | 'cooked' | 'ore';

export type BuildingKind =
  | 'furnace' | 'stall' | 'tent' | 'tower' | 'cannon' | 'firetrap' | 'kitchen' | 'diner'
  | 'lumberhut' | 'house' | 'expansion' | 'worker' | 'perk' | 'minestation' | 'rail' | 'smelter'
  | 'cart' | 'stonewall' | 'monument' | 'campwall' | 'wagon';

export type WorkerKind = 'lumberjack' | 'carrier' | 'hunter' | 'cook' | 'cashier' | 'miner' | 'guard';

export type IconId =
  | 'tower' | 'cannon' | 'fire' | 'kitchen' | 'diner' | 'axe' | 'house' | 'expand' | 'carrier' | 'hunter'
  | 'cook' | 'cashier' | 'miner' | 'guard' | 'backpack' | 'rail' | 'smelter' | 'cart' | 'wall' | 'monument'
  | 'meat' | 'camp' | 'wagon';

export interface RegionDef {
  id: string;
  name: string;
  cx: number;
  cz: number;
  rect: [number, number, number, number]; // minX, minZ, maxX, maxZ
  open?: boolean;
  trees: number;
  bigTrees?: boolean;
  wildBears?: number;
  rocks: number;
}

export interface ZoneDef {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  rot?: number; // radians
  cost: number;
  currency: Currency;
  requires?: string[];
  region: string;
  label: string;
  icon: IconId;
  prebuilt?: boolean;
  /** Kind-specific parameters (worker kind, region to open, rail points, upgrade id ...). */
  params?: {
    worker?: WorkerKind;
    opens?: string;
    from?: [number, number];
    to?: [number, number];
    upgrade?: string;
    levels?: number;
    population?: number;
    /** stall / wagon goods */
    item?: 'log' | 'cooked';
    /** stall: which half of the south wall (+1 east, -1 west) */
    side?: 1 | -1;
    /** campwall: wall level this purchase unlocks */
    level?: number;
    zoneOffset?: [number, number];
  };
}

// ------------------------------------------------------------------ endless map (chunks)
/** The world is a grid of square chunks; new chunks are bought at the frontier forever (within WORLD bounds). */
export const CHUNK = 56;
export const CHUNK_RANGE = 6; // chunks -6..6 on each axis => a 728 x 728 m world
export const WORLD = { min: -CHUNK * (CHUNK_RANGE + 0.5), max: CHUNK * (CHUNK_RANGE + 0.5) };

const NAMED: Record<string, Omit<RegionDef, 'cx' | 'cz' | 'rect'>> = {
  '0,0': { id: 'camp', name: 'Frostwood Camp', open: true, trees: 300, wildBears: 5, rocks: 8 },
  '1,0': { id: 'east', name: 'Pine Ridge', trees: 300, wildBears: 8, rocks: 8 },
  '-1,0': { id: 'west', name: 'Hollow Woods', trees: 300, wildBears: 6, rocks: 8 },
  '0,-1': { id: 'north', name: 'Gold Cliffs', trees: 70, rocks: 18 },
  '0,1': { id: 'south', name: 'Glacier Pass', trees: 120, bigTrees: true, wildBears: 6, rocks: 10 },
};

const WILD_NAMES = ['Frozen Hollow', 'Bear Den', 'Silent Pines', 'Howling Ridge', 'Icefall Woods', 'Snowdrift Vale', 'Frostbite Glen',
  'Pale Thicket', 'Wolf Run', 'Blizzard Flats', 'Rimewood', 'Northwind Grove', 'Crystal Firs', 'Old Timber', 'Whitebark Wilds'];

const hash2 = (a: number, b: number) => {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
};

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;
export const chunkOf = (x: number, z: number) => ({ cx: Math.floor((x + CHUNK / 2) / CHUNK), cz: Math.floor((z + CHUNK / 2) / CHUNK) });
export const inWorld = (cx: number, cz: number) => Math.abs(cx) <= CHUNK_RANGE && Math.abs(cz) <= CHUNK_RANGE;

/** Region (chunk) definition — named near the camp, procedurally generated further out. */
export function regionDef(cx: number, cz: number): RegionDef {
  const rect: [number, number, number, number] = [cx * CHUNK - CHUNK / 2, cz * CHUNK - CHUNK / 2, cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2];
  const named = NAMED[chunkKey(cx, cz)];
  if (named) return { ...named, cx, cz, rect };
  const d = Math.abs(cx) + Math.abs(cz);
  const h = hash2(cx, cz);
  return {
    id: `c${cx}_${cz}`, name: WILD_NAMES[Math.floor(h * WILD_NAMES.length)], cx, cz, rect,
    trees: 260 + Math.floor(h * 80), bigTrees: h > 0.7, wildBears: 5 + d * 2, rocks: 8 + Math.floor(h * 8),
  };
}

export function regionById(id: string): RegionDef | undefined {
  for (const [k, v] of Object.entries(NAMED)) if (v.id === id) { const [cx, cz] = k.split(',').map(Number); return regionDef(cx, cz); }
  const m = /^c(-?\d+)_(-?\d+)$/.exec(id);
  return m ? regionDef(Number(m[1]), Number(m[2])) : undefined;
}

/** Generic frontier expansion: on the edge of an open chunk, towards a locked neighbour. */
export function frontierZone(from: RegionDef, to: RegionDef, nth: number): ZoneDef {
  const dx = to.cx - from.cx, dz = to.cz - from.cz;
  const c = { x: from.cx * CHUNK, z: from.cz * CHUNK };
  const dist = Math.abs(to.cx) + Math.abs(to.cz);
  return {
    id: `exp_${to.id}`, kind: 'expansion', x: c.x + dx * (CHUNK / 2 - 5) + dz * 6, z: c.z + dz * (CHUNK / 2 - 5) + dx * 6,
    cost: Math.round((2500 * Math.pow(1.45, nth) * (1 + 0.35 * (dist - 1))) / 50) * 50, currency: 'money',
    region: from.id, label: to.name, icon: 'expand', params: { opens: to.id },
  };
}

// ------------------------------------------------------------------ camp walls
/** Palisade half-size per wall level. The camp starts small and is expanded for money. */
export const WALL_LEVELS = [10, 15, 20];

// Mine / rail geometry (north region).
export const MINE = {
  rock: { x: 0, z: -57 },
  station: { x: 0, z: -51 },
  smelter: { x: 17, z: -36 },
};

export const ZONES: ZoneDef[] = [
  // ---- prebuilt camp core (small camp, wall level 1: ±10) ----
  { id: 'furnace', kind: 'furnace', x: 0, z: -1, cost: 0, currency: 'money', region: 'camp', label: 'Furnace', icon: 'fire', prebuilt: true },
  { id: 'counter', kind: 'stall', x: 3.6, z: 8.4, cost: 0, currency: 'money', region: 'camp', label: 'Wood Stall', icon: 'cashier', prebuilt: true, params: { item: 'log', side: 1 } },
  { id: 'tent1', kind: 'tent', x: -7, z: -2, rot: 0.5, cost: 0, currency: 'money', region: 'camp', label: 'Tent', icon: 'house', prebuilt: true, params: { population: 2 } },
  { id: 'tent2', kind: 'tent', x: -7, z: -6.2, rot: 0.2, cost: 0, currency: 'money', region: 'camp', label: 'Tent', icon: 'house', prebuilt: true, params: { population: 2 } },

  // ---- stage 1: camp ----
  { id: 'backpack', kind: 'perk', x: 5, z: 2.5, cost: 40, currency: 'money', region: 'camp', label: 'Bigger Pack', icon: 'backpack', params: { upgrade: 'stackCap', levels: 2 } },
  { id: 'tower1', kind: 'tower', x: 7.5, z: -7.5, cost: 100, currency: 'money', region: 'camp', label: 'Ballista', icon: 'tower' },
  { id: 'kitchen', kind: 'kitchen', x: -6.5, z: 1.5, cost: 150, currency: 'money', requires: ['tower1'], region: 'camp', label: 'Kitchen', icon: 'kitchen' },
  { id: 'meatstall', kind: 'stall', x: -3.6, z: 7.2, cost: 180, currency: 'money', requires: ['kitchen'], region: 'camp', label: 'Meat Stall', icon: 'meat', params: { item: 'cooked', side: -1 } },
  { id: 'lumberhut', kind: 'lumberhut', x: 2.5, z: -7.5, cost: 200, currency: 'money', requires: ['tower1'], region: 'camp', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'exp_east', kind: 'expansion', x: 25, z: 6, cost: 250, currency: 'money', requires: ['tower1'], region: 'camp', label: 'Pine Ridge', icon: 'expand', params: { opens: 'east' } },
  { id: 'carrier', kind: 'worker', x: 5.8, z: -3.6, cost: 300, currency: 'money', requires: ['lumberhut'], region: 'camp', label: 'Carrier', icon: 'carrier', params: { worker: 'carrier' } },
  { id: 'cashier', kind: 'worker', x: 7.2, z: -1, cost: 350, currency: 'money', requires: ['lumberhut'], region: 'camp', label: 'Cashier', icon: 'cashier', params: { worker: 'cashier' } },
  { id: 'cook', kind: 'worker', x: -2.8, z: -5.2, cost: 400, currency: 'money', requires: ['meatstall'], region: 'camp', label: 'Cook', icon: 'cook', params: { worker: 'cook' } },
  { id: 'wall2', kind: 'campwall', x: -4.5, z: -8.6, cost: 700, currency: 'money', requires: ['kitchen', 'lumberhut'], region: 'camp', label: 'Bigger Camp', icon: 'camp', params: { level: 2 } },

  // ---- stage 2: settlement (wall level 2: ±15) ----
  { id: 'diner', kind: 'diner', x: -12.5, z: 8, cost: 300, currency: 'money', requires: ['wall2', 'kitchen'], region: 'camp', label: 'Canteen', icon: 'diner' },
  { id: 'house1', kind: 'house', x: -12, z: -3.5, rot: 1.3, cost: 300, currency: 'money', requires: ['wall2'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'house2', kind: 'house', x: -12, z: -8.5, rot: 1.3, cost: 450, currency: 'money', requires: ['house1'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'house3', kind: 'house', x: -8, z: -12.3, cost: 650, currency: 'money', requires: ['house2'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'house4', kind: 'house', x: -1.5, z: -12.3, cost: 900, currency: 'money', requires: ['house3'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'tower2', kind: 'tower', x: 12.5, z: -12.5, cost: 400, currency: 'money', requires: ['wall2'], region: 'camp', label: 'Ballista', icon: 'tower' },
  { id: 'cashier2', kind: 'worker', x: -9.8, z: 2.5, cost: 500, currency: 'money', requires: ['wall2', 'meatstall'], region: 'camp', label: 'Meat Cashier', icon: 'cashier', params: { worker: 'cashier' } },
  { id: 'wagon_wood', kind: 'wagon', x: 12, z: -5.5, cost: 900, currency: 'money', requires: ['wall2', 'lumberhut'], region: 'camp', label: 'Wood Wagon', icon: 'wagon', params: { item: 'log' } },
  { id: 'wagon_meat', kind: 'wagon', x: -12.5, z: 1.5, cost: 1200, currency: 'money', requires: ['wall2', 'meatstall', 'cook'], region: 'camp', label: 'Meat Wagon', icon: 'wagon', params: { item: 'cooked' } },
  { id: 'guard1', kind: 'worker', x: 12, z: 6, cost: 400, currency: 'money', requires: ['tower2'], region: 'camp', label: 'Guard', icon: 'guard', params: { worker: 'guard' } },
  { id: 'firetrap_e', kind: 'firetrap', x: 22.5, z: 0, cost: 350, currency: 'money', requires: ['exp_east'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'exp_west', kind: 'expansion', x: -25, z: 6, cost: 900, currency: 'money', requires: ['wall2', 'exp_east'], region: 'camp', label: 'Hollow Woods', icon: 'expand', params: { opens: 'west' } },

  // ---- east region ----
  { id: 'hunter', kind: 'worker', x: 34, z: -5, cost: 600, currency: 'money', requires: ['exp_east', 'kitchen'], region: 'east', label: 'Hunter', icon: 'hunter', params: { worker: 'hunter' } },
  { id: 'lumberjack2', kind: 'worker', x: 34, z: 6, cost: 600, currency: 'money', requires: ['exp_east', 'lumberhut'], region: 'east', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'exp_north', kind: 'expansion', x: 6, z: -25, cost: 1500, currency: 'money', requires: ['exp_east', 'wall2'], region: 'camp', label: 'Gold Cliffs', icon: 'expand', params: { opens: 'north' } },

  // ---- west region ----
  { id: 'lumberjack3', kind: 'worker', x: -34, z: 6, cost: 900, currency: 'money', requires: ['exp_west'], region: 'west', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'carrier2', kind: 'worker', x: 6.5, z: -11.5, cost: 900, currency: 'money', requires: ['wall2', 'exp_west', 'carrier'], region: 'camp', label: 'Carrier', icon: 'carrier', params: { worker: 'carrier' } },
  { id: 'firetrap_w', kind: 'firetrap', x: -22.5, z: 0, cost: 800, currency: 'money', requires: ['exp_west'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'guard2', kind: 'worker', x: 12, z: 2.5, cost: 900, currency: 'money', requires: ['guard1', 'exp_west'], region: 'camp', label: 'Guard', icon: 'guard', params: { worker: 'guard' } },

  // ---- stage 3: mine (north) ----
  { id: 'minestation', kind: 'minestation', x: MINE.station.x, z: MINE.station.z, cost: 0, currency: 'money', requires: ['exp_north'], region: 'north', label: 'Ore Loader', icon: 'miner', prebuilt: true },
  { id: 'rail1', kind: 'rail', x: 2.2, z: -46, cost: 300, currency: 'money', requires: ['exp_north'], region: 'north', label: 'Rails', icon: 'rail', params: { from: [0, -49], to: [0, -42] } },
  { id: 'rail2', kind: 'rail', x: 6.5, z: -40.5, cost: 450, currency: 'money', requires: ['rail1'], region: 'north', label: 'Rails', icon: 'rail', params: { from: [0, -42], to: [7, -36] } },
  { id: 'rail3', kind: 'rail', x: 10.5, z: -33.8, cost: 600, currency: 'money', requires: ['rail2'], region: 'north', label: 'Rails', icon: 'rail', params: { from: [7, -36], to: [14.5, -36] } },
  { id: 'smelter', kind: 'smelter', x: MINE.smelter.x, z: MINE.smelter.z, cost: 800, currency: 'money', requires: ['rail1'], region: 'north', label: 'Smelter', icon: 'smelter', params: { zoneOffset: [0, 3.5] } },
  { id: 'cart', kind: 'cart', x: -3, z: -46, cost: 500, currency: 'money', requires: ['rail3', 'smelter'], region: 'north', label: 'Mine Cart', icon: 'cart' },
  { id: 'miner', kind: 'worker', x: -4, z: -53, cost: 1200, currency: 'money', requires: ['cart'], region: 'north', label: 'Miner', icon: 'miner', params: { worker: 'miner' } },
  { id: 'tower3', kind: 'cannon', x: 12.5, z: 12.5, cost: 15, currency: 'gold', requires: ['smelter', 'wall2'], region: 'camp', label: 'Cannon', icon: 'cannon' },

  // ---- stage 4: fortress (wall level 3: ±20) ----
  { id: 'wall3', kind: 'campwall', x: -4.5, z: -8.6, cost: 5000, currency: 'money', requires: ['wall2', 'house2', 'exp_east'], region: 'camp', label: 'Big Camp', icon: 'camp', params: { level: 3 } },
  { id: 'stonewall', kind: 'stonewall', x: 4, z: -12.5, cost: 30, currency: 'gold', requires: ['tower3'], region: 'camp', label: 'Stone Wall', icon: 'wall' },
  { id: 'tower4', kind: 'cannon', x: -12.5, z: 12.5, cost: 25, currency: 'gold', requires: ['stonewall'], region: 'camp', label: 'Cannon', icon: 'cannon' },
  { id: 'tower5', kind: 'tower', x: 17.5, z: -17.5, cost: 2500, currency: 'money', requires: ['wall3'], region: 'camp', label: 'Ballista', icon: 'tower' },
  { id: 'tower6', kind: 'tower', x: -17.5, z: 17.5, cost: 2500, currency: 'money', requires: ['wall3'], region: 'camp', label: 'Ballista', icon: 'tower' },
  { id: 'house5', kind: 'house', x: -17, z: -5, rot: 1.3, cost: 1500, currency: 'money', requires: ['wall3', 'house4'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'house6', kind: 'house', x: -17, z: -11, rot: 1.3, cost: 2000, currency: 'money', requires: ['house5'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'firetrap_n', kind: 'firetrap', x: 0, z: -22.5, cost: 10, currency: 'gold', requires: ['stonewall'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'firetrap_s', kind: 'firetrap', x: 0, z: 23.5, cost: 10, currency: 'gold', requires: ['stonewall', 'wall3'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'exp_south', kind: 'expansion', x: -6, z: 25.5, cost: 60, currency: 'gold', requires: ['stonewall'], region: 'camp', label: 'Glacier Pass', icon: 'expand', params: { opens: 'south' } },

  // ---- stage 5: new region ----
  { id: 'lumberjack4', kind: 'worker', x: -6, z: 36, cost: 2500, currency: 'money', requires: ['exp_south'], region: 'south', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'hunter2', kind: 'worker', x: 8, z: 36, cost: 2500, currency: 'money', requires: ['exp_south'], region: 'south', label: 'Hunter', icon: 'hunter', params: { worker: 'hunter' } },
  { id: 'monument', kind: 'monument', x: 0, z: 48, cost: 150, currency: 'gold', requires: ['exp_south'], region: 'south', label: 'Frost Beacon', icon: 'monument' },
];

/** Stage progression: a stage is reached once its key zone is built. */
export const STAGES = [
  { id: 1, name: 'Camp', key: null as string | null },
  { id: 2, name: 'Settlement', key: 'wall2' },
  { id: 3, name: 'Mine', key: 'exp_north' },
  { id: 4, name: 'Fortress', key: 'wall3' },
  { id: 5, name: 'Glacier Pass', key: 'exp_south' },
];

/** Fixed interaction spots. Stall positions depend on the wall level (see stallSpot). */
export const SLOTS = {
  queueMax: 14,
  furnaceInput: { x: 0, z: 2.5 },
  kitchenInput: { x: -4, z: 1.5 },
  kitchenOutput: { x: -6.5, z: 3.8 },
  dinerInput: { x: -9.6, z: 8 },
  lumberOutput: { x: 2.5, z: -5.4 },
  campEntry: { x: 0, z: 27 },
};

/**
 * Stalls sit in the south wall (one per side of the gate): the player serves from inside,
 * customers queue outside. Everything is derived from the current wall half-size H.
 */
export function stallSpot(side: 1 | -1, H: number) {
  const gw = 1.5;
  const x = side * (gw + (H + gw) / 2) / 2;
  return {
    x, z: H - 1.6,
    serve: { x, z: H - 3.5 },
    cash: { x: x + side * 2.6, z: H - 4.2 },
    queue: (i: number) => {
      const straight = 4, step = 1.15;
      if (i < straight) return { x, z: H + 1.8 + step * i };
      return { x: x + side * step * (i - straight + 1), z: H + 1.8 + step * (straight - 1) };
    },
  };
}

/** Where visiting customers come from (forest south of the camp), per stall side. */
export const VISITOR_SPAWN = { near: 2, far: 18, z: 27 };
