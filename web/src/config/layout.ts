// Data-driven world layout: regions and every purchase zone / building.
// Adding a new building of an existing kind = adding an entry here, no code changes.

export type Currency = 'money' | 'gold';
export type ItemType = 'log' | 'meat' | 'cooked' | 'ore';

export type BuildingKind =
  | 'furnace' | 'counter' | 'tent' | 'tower' | 'cannon' | 'firetrap' | 'kitchen' | 'diner'
  | 'lumberhut' | 'house' | 'expansion' | 'worker' | 'perk' | 'minestation' | 'rail' | 'smelter'
  | 'cart' | 'stonewall' | 'monument';

export type WorkerKind = 'lumberjack' | 'carrier' | 'hunter' | 'cook' | 'cashier' | 'miner' | 'guard';

export type IconId =
  | 'tower' | 'cannon' | 'fire' | 'kitchen' | 'diner' | 'axe' | 'house' | 'expand' | 'carrier' | 'hunter'
  | 'cook' | 'cashier' | 'miner' | 'guard' | 'backpack' | 'rail' | 'smelter' | 'cart' | 'wall' | 'monument';

export interface RegionDef {
  id: string;
  name: string;
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
    zoneOffset?: [number, number];
  };
}

export const WORLD = { min: -66, max: 66, outerForestDepth: 18 };

export const REGIONS: RegionDef[] = [
  { id: 'camp', name: 'Frostwood Camp', rect: [-28, -28, 28, 28], open: true, trees: 46, rocks: 10 },
  { id: 'east', name: 'Pine Ridge', rect: [28, -28, 64, 28], trees: 46, wildBears: 3, rocks: 10 },
  { id: 'west', name: 'Hollow Woods', rect: [-64, -28, -28, 28], trees: 52, rocks: 10 },
  { id: 'north', name: 'Gold Cliffs', rect: [-28, -64, 28, -28], trees: 18, rocks: 22 },
  { id: 'south', name: 'Glacier Pass', rect: [-28, 28, 28, 64], trees: 30, bigTrees: true, wildBears: 2, rocks: 14 },
];

// Mine / rail geometry (north region).
export const MINE = {
  rock: { x: 0, z: -57 },
  station: { x: 0, z: -51 },
  smelter: { x: 17, z: -36 },
};

export const ZONES: ZoneDef[] = [
  // ---- prebuilt camp core ----
  { id: 'furnace', kind: 'furnace', x: 0, z: -1, cost: 0, currency: 'money', region: 'camp', label: 'Furnace', icon: 'fire', prebuilt: true },
  { id: 'counter', kind: 'counter', x: 7, z: 3, cost: 0, currency: 'money', region: 'camp', label: 'Wood Stall', icon: 'cashier', prebuilt: true },
  { id: 'tent1', kind: 'tent', x: -9, z: -2.5, rot: 0.5, cost: 0, currency: 'money', region: 'camp', label: 'Tent', icon: 'house', prebuilt: true, params: { population: 2 } },
  { id: 'tent2', kind: 'tent', x: -5.5, z: -5.5, rot: 0.2, cost: 0, currency: 'money', region: 'camp', label: 'Tent', icon: 'house', prebuilt: true, params: { population: 2 } },

  // ---- stage 1: camp ----
  { id: 'backpack', kind: 'perk', x: 3, z: 7.5, cost: 40, currency: 'money', region: 'camp', label: 'Bigger Pack', icon: 'backpack', params: { upgrade: 'stackCap', levels: 2 } },
  { id: 'tower1', kind: 'tower', x: 10.3, z: 10.3, cost: 100, currency: 'money', region: 'camp', label: 'Ballista', icon: 'tower' },
  { id: 'kitchen', kind: 'kitchen', x: -6.5, z: 3, cost: 150, currency: 'money', requires: ['tower1'], region: 'camp', label: 'Kitchen', icon: 'kitchen' },
  { id: 'lumberhut', kind: 'lumberhut', x: 5.5, z: -8, cost: 200, currency: 'money', requires: ['tower1'], region: 'camp', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'exp_east', kind: 'expansion', x: 21, z: 0, cost: 250, currency: 'money', requires: ['tower1'], region: 'camp', label: 'Pine Ridge', icon: 'expand', params: { opens: 'east' } },

  // ---- stage 2: settlement ----
  { id: 'diner', kind: 'diner', x: -6.5, z: 8.5, cost: 120, currency: 'money', requires: ['kitchen'], region: 'camp', label: 'Canteen', icon: 'diner' },
  { id: 'cashier', kind: 'worker', x: 10, z: 1.2, cost: 350, currency: 'money', requires: ['lumberhut'], region: 'camp', label: 'Cashier', icon: 'cashier', params: { worker: 'cashier' } },
  { id: 'carrier', kind: 'worker', x: 8.3, z: -6, cost: 300, currency: 'money', requires: ['lumberhut'], region: 'camp', label: 'Carrier', icon: 'carrier', params: { worker: 'carrier' } },
  { id: 'cook', kind: 'worker', x: -9.5, z: 5.5, cost: 450, currency: 'money', requires: ['diner'], region: 'camp', label: 'Cook', icon: 'cook', params: { worker: 'cook' } },
  { id: 'house1', kind: 'house', x: -10, z: -7, rot: 0.3, cost: 300, currency: 'money', requires: ['kitchen'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'house2', kind: 'house', x: -5, z: -10, rot: -0.2, cost: 450, currency: 'money', requires: ['house1'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'house3', kind: 'house', x: -1, z: -10.3, rot: 0.1, cost: 650, currency: 'money', requires: ['house2'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },
  { id: 'tower2', kind: 'tower', x: -10.3, z: -10.3, cost: 400, currency: 'money', requires: ['kitchen'], region: 'camp', label: 'Ballista', icon: 'tower' },
  { id: 'guard1', kind: 'worker', x: 2, z: 10.5, cost: 400, currency: 'money', requires: ['tower2'], region: 'camp', label: 'Guard', icon: 'guard', params: { worker: 'guard' } },
  { id: 'firetrap_e', kind: 'firetrap', x: 16.5, z: 0, cost: 350, currency: 'money', requires: ['exp_east'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'exp_west', kind: 'expansion', x: -21, z: 0, cost: 900, currency: 'money', requires: ['kitchen', 'exp_east'], region: 'camp', label: 'Hollow Woods', icon: 'expand', params: { opens: 'west' } },

  // ---- east region ----
  { id: 'hunter', kind: 'worker', x: 32, z: -5, cost: 600, currency: 'money', requires: ['exp_east', 'kitchen'], region: 'east', label: 'Hunter', icon: 'hunter', params: { worker: 'hunter' } },
  { id: 'lumberjack2', kind: 'worker', x: 32, z: 6, cost: 600, currency: 'money', requires: ['exp_east', 'lumberhut'], region: 'east', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'exp_north', kind: 'expansion', x: 0, z: -21, cost: 1500, currency: 'money', requires: ['exp_east', 'lumberhut'], region: 'camp', label: 'Gold Cliffs', icon: 'expand', params: { opens: 'north' } },

  // ---- west region ----
  { id: 'lumberjack3', kind: 'worker', x: -32, z: 6, cost: 900, currency: 'money', requires: ['exp_west'], region: 'west', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'carrier2', kind: 'worker', x: 8.3, z: -9.5, cost: 900, currency: 'money', requires: ['exp_west', 'carrier'], region: 'camp', label: 'Carrier', icon: 'carrier', params: { worker: 'carrier' } },
  { id: 'firetrap_w', kind: 'firetrap', x: -16.5, z: 0, cost: 800, currency: 'money', requires: ['exp_west'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'guard2', kind: 'worker', x: -2, z: 10.5, cost: 900, currency: 'money', requires: ['guard1', 'exp_west'], region: 'camp', label: 'Guard', icon: 'guard', params: { worker: 'guard' } },
  { id: 'house4', kind: 'house', x: -10.2, z: -10.4, rot: 0.6, cost: 1100, currency: 'money', requires: ['house3', 'exp_west'], region: 'camp', label: 'Cabin', icon: 'house', params: { population: 3 } },

  // ---- stage 3: mine (north) ----
  { id: 'minestation', kind: 'minestation', x: MINE.station.x, z: MINE.station.z, cost: 0, currency: 'money', requires: ['exp_north'], region: 'north', label: 'Ore Loader', icon: 'miner', prebuilt: true },
  { id: 'rail1', kind: 'rail', x: 2.2, z: -46, cost: 300, currency: 'money', requires: ['exp_north'], region: 'north', label: 'Rails', icon: 'rail', params: { from: [0, -49], to: [0, -42] } },
  { id: 'rail2', kind: 'rail', x: 6.5, z: -40.5, cost: 450, currency: 'money', requires: ['rail1'], region: 'north', label: 'Rails', icon: 'rail', params: { from: [0, -42], to: [7, -36] } },
  { id: 'rail3', kind: 'rail', x: 10.5, z: -33.8, cost: 600, currency: 'money', requires: ['rail2'], region: 'north', label: 'Rails', icon: 'rail', params: { from: [7, -36], to: [14.5, -36] } },
  { id: 'smelter', kind: 'smelter', x: MINE.smelter.x, z: MINE.smelter.z, cost: 800, currency: 'money', requires: ['rail1'], region: 'north', label: 'Smelter', icon: 'smelter', params: { zoneOffset: [0, 3.5] } },
  { id: 'cart', kind: 'cart', x: -3, z: -46, cost: 500, currency: 'money', requires: ['rail3', 'smelter'], region: 'north', label: 'Mine Cart', icon: 'cart' },
  { id: 'miner', kind: 'worker', x: -4, z: -53, cost: 1200, currency: 'money', requires: ['cart'], region: 'north', label: 'Miner', icon: 'miner', params: { worker: 'miner' } },
  { id: 'tower3', kind: 'cannon', x: 10.3, z: -10.3, cost: 15, currency: 'gold', requires: ['smelter'], region: 'camp', label: 'Cannon', icon: 'cannon' },

  // ---- stage 4: fortress ----
  { id: 'stonewall', kind: 'stonewall', x: -3, z: -14.5, cost: 30, currency: 'gold', requires: ['tower3'], region: 'camp', label: 'Stone Wall', icon: 'wall' },
  { id: 'tower4', kind: 'cannon', x: -10.3, z: 10.3, cost: 25, currency: 'gold', requires: ['stonewall'], region: 'camp', label: 'Cannon', icon: 'cannon' },
  { id: 'firetrap_n', kind: 'firetrap', x: 0, z: -16.5, cost: 10, currency: 'gold', requires: ['stonewall'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'firetrap_s', kind: 'firetrap', x: 0, z: 16.5, cost: 10, currency: 'gold', requires: ['stonewall'], region: 'camp', label: 'Fire Trap', icon: 'fire' },
  { id: 'exp_south', kind: 'expansion', x: 5, z: 21, cost: 60, currency: 'gold', requires: ['stonewall'], region: 'camp', label: 'Glacier Pass', icon: 'expand', params: { opens: 'south' } },

  // ---- stage 5: new region ----
  { id: 'lumberjack4', kind: 'worker', x: -6, z: 34, cost: 2500, currency: 'money', requires: ['exp_south'], region: 'south', label: 'Lumberjack', icon: 'axe', params: { worker: 'lumberjack' } },
  { id: 'hunter2', kind: 'worker', x: 8, z: 34, cost: 2500, currency: 'money', requires: ['exp_south'], region: 'south', label: 'Hunter', icon: 'hunter', params: { worker: 'hunter' } },
  { id: 'monument', kind: 'monument', x: 0, z: 46, cost: 150, currency: 'gold', requires: ['exp_south'], region: 'south', label: 'Frost Beacon', icon: 'monument' },
];

/** Stage progression: a stage is reached once its key zone is built. */
export const STAGES = [
  { id: 1, name: 'Camp', key: null as string | null },
  { id: 2, name: 'Settlement', key: 'kitchen' },
  { id: 3, name: 'Mine', key: 'exp_north' },
  { id: 4, name: 'Fortress', key: 'stonewall' },
  { id: 5, name: 'Glacier Pass', key: 'exp_south' },
];

/** Survivor seating / queue geometry relative to buildings. */
export const SLOTS = {
  queueStart: { x: 7, z: 5.0 },
  queueStep: { x: -1.15, z: 0 },
  counterServe: { x: 7, z: 1.4 },
  counterCash: { x: 9.6, z: 4.2 },
  furnaceInput: { x: 0, z: 1.9 },
  kitchenInput: { x: -3.8, z: 3 },
  kitchenOutput: { x: -6.5, z: 5.4 },
  dinerInput: { x: -3.6, z: 8.5 },
  lumberOutput: { x: 5.5, z: -5.4 },
  gateDistance: 13,
  campEntry: { x: 0, z: 26 },
};
