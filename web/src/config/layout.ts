// World layout types + helpers. The data itself lives in data/zones.json and data/regions.json:
// adding a zone / building of an existing kind, or a named chunk, needs no code changes.

import zonesData from '../data/zones.json';
import { BALANCE } from './balance';
import regionsData from '../data/regions.json';

/** Any resource id from data/resources.json. Currencies are banked (money, gold), items are carried. */
export type ResId = string;
export type Currency = ResId;
export type ItemType = ResId;

export type BuildingKind =
  | 'furnace' | 'stall' | 'tent' | 'tower' | 'cannon' | 'firetrap' | 'diner'
  | 'lumberhut' | 'house' | 'expansion' | 'worker' | 'perk' | 'minestation' | 'rail'
  | 'cart' | 'stonewall' | 'monument' | 'campwall' | 'wagon' | 'producer' | 'warehouse' | 'trader' | 'lumbercrew'
  | 'minelevel' | 'lantern' | 'campside' | 'market' | 'tradepost' | 'flametower' | 'icetower' | 'mortar' | 'lab' | 'expedition'
  | 'campfire' | 'campdepot' | 'camphut' | 'camptower';

export type WorkerKind = 'lumberjack' | 'carrier' | 'hunter' | 'cook' | 'cashier' | 'miner' | 'guard' | 'fisher' | 'builder';

export type IconId =
  | 'tower' | 'cannon' | 'fire' | 'kitchen' | 'diner' | 'axe' | 'house' | 'expand' | 'carrier' | 'hunter'
  | 'cook' | 'cashier' | 'miner' | 'guard' | 'backpack' | 'rail' | 'smelter' | 'cart' | 'wall' | 'monument'
  | 'meat' | 'camp' | 'wagon' | 'sawmill' | 'warehouse' | 'fish';

export interface RegionDef {
  id: string;
  name: string;
  cx: number;
  cz: number;
  rect: [number, number, number, number]; // minX, minZ, maxX, maxZ
  open?: boolean;
  /** biome (data/regions.json) this chunk belongs to */
  biome: string;
  trees: number;
  bigTrees?: boolean;
  wildBears?: number;
  /** wild animal kinds roaming this chunk (default: bears and wolves) */
  wild?: string[];
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
  /** extra resource costs, paid from the backpack first, then from the Warehouse bank */
  items?: Record<ResId, number>;
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
    /** stall / wagon goods (a trader buys any item id) */
    item?: 'log' | 'cooked';
    /** producer: key in data/producers.json */
    producer?: string;
    /** radius kept free of trees/rocks around the zone */
    clear?: number;
    /** stall: which half of the south wall (+1 east, -1 west) */
    side?: 1 | -1;
    /** campwall: wall level this purchase unlocks */
    level?: number;
    /** campside: which wall moves and how far out (metres from the furnace axis) */
    dir?: 'east' | 'west' | 'north' | 'south';
    reach?: number;
  };
}

// ------------------------------------------------------------------ endless map (chunks)
/** The world is a grid of square chunks; new chunks are bought at the frontier forever (within WORLD bounds). */
export const CHUNK = 56;
export const CHUNK_RANGE = 6; // chunks -6..6 on each axis => a 728 x 728 m world
export const WORLD = { min: -CHUNK * (CHUNK_RANGE + 0.5), max: CHUNK * (CHUNK_RANGE + 0.5) };

const NAMED = regionsData.chunks as Record<string, Omit<RegionDef, 'cx' | 'cz' | 'rect'>>;

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
    id: `c${cx}_${cz}`, name: WILD_NAMES[Math.floor(h * WILD_NAMES.length)], biome: 'forest', cx, cz, rect,
    trees: 260 + Math.floor(h * 80), bigTrees: h > 0.7, wildBears: 5 + d * 2, rocks: 8 + Math.floor(h * 8),
  };
}

/** Named chunk ids reserved for a biome that hasn't shipped yet (kept locked, no frontier zone). */
export function chunkLocked(def: RegionDef) {
  return !regionsData.biomes.find((b) => b.id === def.biome)?.available;
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
    cost: Math.round((BALANCE.zones.frontierBase * Math.pow(BALANCE.growth.frontier, nth) * (1 + BALANCE.zones.frontierPerDistance * (dist - 1))) / 50) * 50, currency: 'money',
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

export const ZONES = zonesData.zones as ZoneDef[];

/** Stage progression: a stage is reached once its key zone is built. */
export const STAGES = regionsData.stages as { id: number; name: string; key: string | null }[];

/** Fixed interaction spots. Stall positions depend on the wall level (see stallSpot). */
export const SLOTS = {
  queueMax: 14,
  furnaceInput: { x: 0, z: 2.5 },
  dinerInput: { x: -9.6, z: 8 },
  lumberOutput: { x: 2.5, z: -5.4 },
};

/** Camp wall rectangle: x0 west, x1 east, z0 north (negative), z1 south. */
export interface CampBounds { x0: number; x1: number; z0: number; z1: number }
export const squareBounds = (H: number): CampBounds => ({ x0: -H, x1: H, z0: -H, z1: H });

/** Where newcomers walk in from (in front of the south gate). */
export const campEntry = (b: CampBounds) => ({ x: 0, z: b.z1 + 7 });

/**
 * Stalls sit in the south wall (one per side of the gate): the player serves from inside,
 * customers queue outside. They stay near the gate however wide the camp grows.
 */
export function stallSpot(side: 1 | -1, b: CampBounds) {
  const gw = 1.5;
  const H = b.z1;
  const reach = Math.min(20, side > 0 ? b.x1 : -b.x0);
  const x = side * (gw + (reach + gw) / 2) / 2;
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

/** Where visiting customers come from (forest south of the camp), per stall side: z = south wall + gap. */
export const VISITOR_SPAWN = { near: 2, far: 18, gap: 7 };
