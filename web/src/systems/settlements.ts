import { CAMP, CAMP_LEVELS, TIERS, WORKSHOPS, partDef, SLOTS, campZoneId, parseWorkshopId, traitOf, traitId, distanceMult, workshopZone, type SettlementTier, type TraitDef } from '../config/settlements';
import * as THREE from 'three';
import { pick } from '../core/math';
import { Geo, mesh } from '../world/models';
import { regionById, type WorkerKind } from '../config/layout';
import { res } from '../config/content';
import { events } from '../core/events';
import { Sled, ROUTE_TIERS, baseAccepts, deliverToBase } from './routes';
import type { Game } from '../game';
import type { CampFire, CampDepot } from '../buildings/camps';
import type { Worker } from '../entities/worker';
import type { Port } from './storage';

const RT = CAMP.route;

export interface RouteRule { send: boolean; keep: number }
export interface CampRoute {
  /** 0 = no route, 1..3 = ROUTE_TIERS[tier - 1] */
  tier: number;
  /** throughput level */
  level: number;
  rules: Record<string, RouteRule>;
}

/** One camp in an opened location (chunk). Its buildings are ordinary zones: camp:<chunk>:<part>. */
export interface Camp {
  tier: 'camp';
  chunk: string;
  name: string;
  level: number;
  fire: CampFire;
  /** goods kept in the camp besides the logs on the depot's rack */
  stock: Record<string, number>;
  route: CampRoute;
  sled?: Sled;
  /** flume: fractional items carried so far */
  flowAcc: number;
  /** per-item totals sent to the base (stats) */
  sent: Record<string, number>;
  /** location character (data: camp.traits) */
  trait: TraitDef | null;
  traitId: string | null;
  /** specialisation chosen at camp level 3 */
  spec?: string;
  /** 0..1: buildings damaged by a lost fight (slows the camp until repaired) */
  damage: number;
  /** look stage shown (0 tents, 1 cabins, 2 palisade) */
  look?: number;
  palisade?: THREE.Mesh;
  /** seconds until the next raid; while warning > 0 animals are on their way */
  raidT: number;
  warning: number;
  /** last raid result for the camp tab */
  lastRaid?: string;
  repairT: number;
}

interface SavedCamp { level?: number; stock?: Record<string, number>; route?: Partial<CampRoute>; spec?: string; damage?: number; raidT?: number; lastRaid?: string }

/**
 * Settlements: the base, region outposts (tier only for now) and location camps in one system.
 * Levels are capped by the parent: a camp by its region's outpost if there is one, else by the base,
 * whose level is the Furnace Level (1-30).
 */
export class Settlements {
  readonly camps = new Map<string, Camp>();
  private saved: Record<string, SavedCamp> = {};
  private autoT = 30;

  constructor(private game: Game) {}

  /** Furnace Level 1..30 */
  get baseLevel() { return 1 + (this.game.up.levels.furnace ?? 0); }

  /** Highest level a settlement of this tier may have right now. */
  maxLevel(tier: SettlementTier) {
    if (tier === 'base') return TIERS.base.maxLevel;
    if (tier === 'outpost') return Math.min(TIERS.outpost.maxLevel, this.baseLevel);
    // camps: the highest level whose base requirement is met (outposts will cap this too)
    let l = 1;
    CAMP_LEVELS.forEach((d, i) => { if (this.baseLevel >= d.baseLevel) l = i + 1; });
    return Math.min(TIERS.camp.maxLevel, l);
  }

  camp(chunk: string) { return this.camps.get(chunk); }
  levelDef(c: Camp) { return CAMP_LEVELS[c.level - 1]; }

  /** Called by the camp fire when the camp is founded (or rebuilt from a save). */
  found(chunk: string, fire: CampFire) {
    const name = regionById(chunk)?.name ?? chunk;
    const sv = this.saved[chunk] ?? {};
    const level = Math.max(1, Math.min(sv.level ?? 1, TIERS.camp.maxLevel));
    const route: CampRoute = { tier: sv.route?.tier ?? 0, level: sv.route?.level ?? 0, rules: { ...JSON.parse(JSON.stringify(RT.defaultRules)), ...sv.route?.rules } };
    const def = regionById(chunk)!;
    this.camps.set(chunk, { tier: 'camp', chunk, name, level, fire, stock: { ...sv.stock }, route, flowAcc: 0, sent: {}, trait: traitOf(def), traitId: traitId(def), spec: sv.spec, damage: sv.damage ?? 0, raidT: sv.raidT ?? CAMP.raids.firstAfter, warning: 0, lastRaid: sv.lastRaid, repairT: 0 });
    if (!this.game.loading) events.emit('toast', { text: `🏕️ Camp founded in ${name}! Build a Forest Depot next`, color: '#ffe27a' });
  }

  depot(chunk: string): CampDepot | undefined { return this.game.building<CampDepot>(campZoneId(chunk, 'depot')); }
  depotPort(chunk: string): Port | undefined { return this.game.port(campZoneId(chunk, 'depot')); }
  firePort(chunk: string): Port | undefined { return this.game.port(campZoneId(chunk, 'fire')); }
  hutSpot(chunk: string) {
    const b = this.game.buildings.get(campZoneId(chunk, 'hut')) ?? this.game.buildings.get(campZoneId(chunk, 'fire'));
    return b ? { x: b.def.x, z: b.def.z + 2.4 } : { x: 0, z: 0 };
  }

  // ------------------------------------------------------------------ stock
  /** How many of an item the camp holds (logs: the depot's rack). */
  count(c: Camp, item: string) { return item === 'log' ? this.depotPort(c.chunk)?.store.count ?? 0 : c.stock[item] ?? 0; }
  space(c: Camp, item: string) {
    if (item === 'log') return this.depotPort(c.chunk)?.store.space() ?? 0;
    return this.depotPort(c.chunk) ? Math.max(0, CAMP.stockCap - (c.stock[item] ?? 0)) : 0;
  }
  take(c: Camp, item: string, n: number) {
    if (this.count(c, item) < n) return false;
    if (item === 'log') { for (let i = 0; i < n; i++) this.depotPort(c.chunk)!.store.take(); }
    else c.stock[item] -= n;
    return true;
  }
  /** Add goods to the camp (what doesn't fit is lost). Returns how many fit. */
  add(c: Camp, item: string, n: number) {
    const k = Math.min(n, this.space(c, item));
    if (k <= 0) return 0;
    if (item === 'log') this.depotPort(c.chunk)!.store.add(k);
    else c.stock[item] = (c.stock[item] ?? 0) + k;
    return k;
  }
  /** Items the camp holds, logs first. */
  items(c: Camp) {
    const out: [string, number][] = [['log', this.count(c, 'log')]];
    for (const [k, n] of Object.entries(c.stock)) if (n > 0) out.push([k, n]);
    return out;
  }

  /** Where a camp worker drops logs: the fire if it runs low, else the depot, else the fire's box. */
  logDrop(chunk: string): Port | undefined {
    const c = this.camps.get(chunk);
    const fire = this.firePort(chunk), depot = this.depotPort(chunk);
    if (c && fire && c.fire.short) return fire;
    if (depot && depot.store.space() > 0) return depot;
    if (fire && fire.store.space() > 0) return fire;
    return depot ?? fire;
  }

  // ------------------------------------------------------------------ location character & workshops
  /** Trees of a location: logs per tree, hits per tree, regrowth (nursery). Applies to every chopper. */
  treeMod(region: string) {
    const def = regionById(region);
    const t = def ? traitOf(def) : null;
    const c = this.camps.get(region);
    const nursery = c ? this.workshops(c).find((w) => WORKSHOPS[w].regrow) : undefined;
    return { logMult: t?.logMult ?? 1, hitMult: t?.hitMult ?? 1, regrow: nursery ? WORKSHOPS[nursery].regrow! : 1 };
  }
  /** Extra logs for camp lumberjacks: specialisation and distance. */
  campLogMult(c: Camp) { return distanceMult(regionById(c.chunk)!) * (c.spec === 'logging' ? 1 + CAMP.specBonus : 1); }
  /** A camp lumberjack felled a tree: the location's bonus goods (bark, charcoal) go to the camp. */
  onFell(chunk: string) {
    const c = this.camps.get(chunk);
    if (!c?.trait?.fell) return;
    for (const [k, n] of Object.entries(c.trait.fell)) {
      const got = this.roll(n * this.productionMult(c, 'fell'));
      if (got) { this.add(c, k, got); this.game.flows.add(k, got, 'camp lumberjacks'); }
    }
  }
  /** fractional amounts become whole ones by chance */
  roll(x: number) { return Math.floor(x) + (Math.random() < x % 1 ? 1 : 0); }
  /** Speed / amount multiplier of camp production (distance, fire, specialisation, damage). */
  productionMult(c: Camp, what: string) {
    const def = regionById(c.chunk)!;
    let k = distanceMult(def) * (c.fire.lit ? 1 : 0.5) * (1 - c.damage * 0.7) * (1 + CAMP.levelBonus * (c.level - 1));
    const sp = c.spec ? (CAMP.specs as Record<string, { boosts: string[] }>)[c.spec] : undefined;
    if (sp?.boosts.includes(what)) k *= 1 + CAMP.specBonus;
    return k;
  }
  /** What the gatherers find here this time. */
  gatherPick(c: Camp): string | null {
    const g = c.trait?.gather ?? { berries: 1, mushrooms: 1, herb: 1 };
    const bag: string[] = [];
    for (const [k, w] of Object.entries(g)) for (let i = 0; i < w; i++) bag.push(k);
    return bag.length ? pick(bag) : null;
  }
  /** Built workshop types of a camp. */
  workshops(c: Camp) {
    const out: string[] = [];
    for (const id of this.game.zones.built) { const w = parseWorkshopId(id); if (w && w.chunk === c.chunk) out.push(w.type); }
    return out;
  }
  /** Slots free for workshops at the current level. */
  freeSlots(c: Camp) {
    const used = new Set<number>();
    for (const id of this.game.zones.built) { const w = parseWorkshopId(id); if (w && w.chunk === c.chunk) used.add(w.slot); }
    const total = Math.min(SLOTS.length, this.levelDef(c).slots - CAMP.coreSlots);
    const free: number[] = [];
    for (let i = 0; i < total; i++) if (!used.has(i)) free.push(i);
    return free;
  }
  workshopCost(c: Camp, type: string) { return this.scaled(c, WORKSHOPS[type].cost); }
  /** Build a workshop in the next free slot: money from the bank, logs from the camp, the rest from the bank. */
  buildWorkshop(c: Camp, type: string) {
    const slot = this.freeSlots(c)[0];
    if (slot === undefined || this.workshops(c).includes(type) || !this.depotPort(c.chunk)) return false;
    if (!this.payLocal(c, this.workshopCost(c, type))) return false;
    const def = workshopZone(regionById(c.chunk)!, slot, type);
    this.game.zones.ensure(def.id);
    this.game.zones.build(def.id);
    return true;
  }
  /** Can the cost be paid? Local goods (logs and camp goods) count from the camp first, then the bank. */
  canPayLocal(c: Camp, cost: Record<string, number>) {
    return Object.entries(cost).every(([k, n]) => this.count(c, k) + this.game.spendable(k) >= n);
  }
  payLocal(c: Camp, cost: Record<string, number>) {
    if (!this.canPayLocal(c, cost)) return false;
    const bank: Record<string, number> = {};
    for (const [k, n] of Object.entries(cost)) {
      const local = Math.min(this.count(c, k), n);
      if (local) this.take(c, k, local);
      if (n - local > 0) bank[k] = n - local;
    }
    return this.game.payCost(bank);
  }

  // ------------------------------------------------------------------ levels, specialisation, looks
  /** Cost of the next camp level (food = pie / stew / smoked fish; signature = the location's good). */
  levelUpCost(c: Camp): Record<string, number> | null {
    const d = CAMP_LEVELS[c.level];
    if (!d?.cost) return null;
    const cost = this.scaled(c, d.cost);
    const sig = c.trait?.signature;
    if (sig && d.signature) cost[sig] = (cost[sig] ?? 0) + d.signature;
    return cost;
  }
  /** Why the camp can't level up now ('' = it can). */
  levelUpBlock(c: Camp): string {
    const d = CAMP_LEVELS[c.level];
    if (!d) return 'max level';
    if (this.baseLevel < d.baseLevel) return `needs Furnace Level ${d.baseLevel}`;
    const cost = this.levelUpCost(c)!;
    for (const [k, n] of Object.entries(cost)) {
      const have = k === 'food' ? this.foodInBank() : k === 'money' || k === 'gold' ? this.game.eco.get(k) : this.count(c, k) + this.game.spendable(k);
      if (have < n) return `needs ${n - have} more ${k === 'food' ? 'food' : res(k).name.toLowerCase()}`;
    }
    return '';
  }
  private foodInBank() { return (CAMP.foods as string[]).reduce((n, f) => n + this.game.eco.get(f), 0); }
  levelUp(c: Camp) {
    if (this.levelUpBlock(c)) return false;
    const cost = { ...this.levelUpCost(c)! };
    let food = cost.food ?? 0;
    delete cost.food;
    if (!this.payLocal(c, cost)) return false;
    for (const f of CAMP.foods as string[]) { const k = Math.min(food, this.game.eco.get(f)); if (k > 0) { this.game.eco.add(f, -k); food -= k; } }
    c.level++;
    this.applyLook(c);
    this.game.fx.ring(c.fire.def.x, c.fire.def.z, 0xffe27a, 10, 0.9);
    events.emit('toast', { text: `🏕️ ${c.name} is now level ${c.level}!${c.level === CAMP.specLevel ? ' Choose a specialisation in Logistics' : ''}`, color: '#ffe27a' });
    return true;
  }
  chooseSpec(c: Camp, spec: string) {
    if (c.spec || c.level < CAMP.specLevel || !(spec in CAMP.specs)) return false;
    c.spec = spec;
    return true;
  }
  /** Tents → cabins → a palisade ring as the camp grows. */
  applyLook(c: Camp) {
    const stage = c.level >= CAMP.palisadeAt ? 2 : c.level >= CAMP.cabinsAt ? 1 : 0;
    const hut = this.game.buildings.get(campZoneId(c.chunk, 'hut'));
    if (stage === c.look && (!hut || hut.model.userData.look === stage)) return;
    c.look = stage;
    if (hut && hut.model instanceof THREE.Mesh) { hut.model.geometry = stage ? Geo.house() : Geo.tent(); hut.model.userData.look = stage; }
    if (stage === 2 && !c.palisade) {
      const f = c.fire.def;
      const gate = Math.atan2(-f.x, -f.z); // the gap faces the base (the route leaves there)
      c.palisade = mesh(Geo.campPalisade(CAMP.radius + 0.3, gate));
      c.palisade.position.set(f.x, 0, f.z);
      this.game.scene.add(c.palisade);
    }
  }

  // ------------------------------------------------------------------ raids
  /** Defence of a camp against a raid (tower, hunters, hunting specialisation). */
  defence(c: Camp) {
    const R = CAMP.raids;
    const tower = this.game.buildings.has(campZoneId(c.chunk, 'tower')) ? R.towerPower * (1 + R.towerPerLevel * c.level) * this.game.up.towerDamageMult : 0;
    const hunters = this.workers(c.chunk).filter((w) => w.kind === 'hunter' && w.alive).length * R.hunterPower;
    return tower + hunters + (c.spec === 'hunting' ? R.specDefence : 0);
  }
  /** Average threat of the next raid. */
  threat(c: Camp) {
    const R = CAMP.raids;
    return (R.threatBase + R.threatPerLevel * c.level + R.threatPerWave * this.game.waves.wave) * (c.trait?.wildMult ?? 1);
  }
  raiding(c: Camp) { return c.warning > 0; }

  private raids(c: Camp, dt: number) {
    const g = this.game, R = CAMP.raids, f = c.fire.def;
    // damaged buildings get mended with the depot's logs
    if (c.damage > 0) {
      c.repairT -= dt;
      if (c.repairT <= 0) { c.repairT = R.repairEvery; if (this.take(c, 'log', 1)) { c.damage = Math.max(0, c.damage - R.repairPerLog); g.flows.add('log', -1, 'camp repairs'); } }
    }
    if (c.warning > 0) {
      c.warning -= dt;
      if (c.warning <= 0) this.resolveRaid(c);
      return;
    }
    c.raidT -= dt;
    if (c.raidT > 0) return;
    c.raidT = R.everyMin + Math.random() * (R.everyMax - R.everyMin);
    c.warning = R.warn;
    const near = Math.hypot(g.player.x - f.x, g.player.z - f.z) < R.heroNear;
    events.emit('toast', { text: `🐺 Bears and wolves are heading for the ${c.name} camp!`, color: '#ffb4a8' });
    if (near) {
      // the hero is here: the animals really come (the tower, hunters and the hero fight them)
      const n = Math.max(2, Math.min(8, Math.round(this.threat(c) / 3)));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        g.spawnEnemy(i % 3 === 0 ? 'bear' : 'wolf', f.x + Math.sin(a) * (CAMP.radius + 6), f.z + Math.cos(a) * (CAMP.radius + 6), 1 + g.waves.wave * 0.02, true);
      }
      c.lastRaid = 'the animals came while the hero was there';
      c.warning = 0;
    }
  }

  /** The hero wasn't there: defence against threat decides. */
  private resolveRaid(c: Camp) {
    const R = CAMP.raids;
    const def = this.defence(c), threat = this.threat(c) * (0.7 + Math.random() * 0.6);
    if (def >= threat) {
      c.lastRaid = `repelled (defence ${def.toFixed(0)} vs ${threat.toFixed(0)})`;
      events.emit('toast', { text: `🛡️ ${c.name} camp drove the animals off`, color: '#b8f5a8' });
      return;
    }
    const share = 1 - def / threat;
    let lost = 0;
    for (const [item, n] of this.items(c)) { const k = Math.floor(n * R.stockLoss * share); if (k > 0 && this.take(c, item, k)) lost += k; }
    c.damage = Math.min(0.9, c.damage + R.damagePerLoss * share);
    c.lastRaid = `lost: ${lost} goods, buildings ${Math.round(c.damage * 100)}% damaged (defence ${def.toFixed(0)} vs ${threat.toFixed(0)})`;
    events.emit('logistics:alert', { text: `🐺 ${c.name} camp was raided: ${lost} goods lost, buildings damaged. Build or upgrade its Watchtower, add a Hunting Lodge.` });
  }

  // ------------------------------------------------------------------ routes
  rule(c: Camp, item: string): RouteRule { return c.route.rules[item] ??= { send: true, keep: RT.defaultKeep }; }
  /** Items per trip (sled) or per minute (flume). */
  routeCapacity(c: Camp) {
    const t = ROUTE_TIERS[c.route.tier - 1];
    if (!t) return 0;
    const def = regionById(c.chunk);
    const far = t.flow || !def ? 1 : 1 + RT.distanceCapacity * Math.max(0, Math.abs(def.cx) + Math.abs(def.cz) - 1);
    return Math.round((t.capacity ?? t.flow ?? 0) * (1 + RT.levelBonus * c.route.level) * far);
  }
  /** Rough items per minute the route moves (for the menus and the simulations). */
  routeRate(c: Camp) {
    const t = ROUTE_TIERS[c.route.tier - 1];
    if (!t) return 0;
    if (t.flow) return this.routeCapacity(c);
    const d = this.depotPort(c.chunk), hut = this.game.port('lumber_in');
    const dist = d && hut ? Math.hypot(d.x - hut.x, d.z - hut.z) * 1.3 : 80;
    const cap = this.routeCapacity(c);
    return (cap / ((2 * dist) / (t.speed ?? 3.6) + cap * RT.loadInterval * 2 + 2)) * 60;
  }
  /** Most valuable item above its keep amount that the route may send (and the base can take). */
  nextToSend(c: Camp, accepts: (item: string) => boolean): string | null {
    let best: string | null = null, bv = -1;
    for (const [item, n] of this.items(c)) {
      const r = this.rule(c, item);
      if (!r.send || n <= r.keep || !accepts(item)) continue;
      const v = res(item).value ?? 0;
      if (v > bv) { bv = v; best = item; }
    }
    return best;
  }
  delivered(c: Camp, item: string, n: number) {
    c.sent[item] = (c.sent[item] ?? 0) + n;
    this.game.flows.add(`${item}>camp route`, n, 'moved');
  }
  routeCost(c: Camp): Record<string, number> | null {
    const t = ROUTE_TIERS[c.route.tier];
    return t ? this.scaled(c, t.cost) : null;
  }
  levelCost(c: Camp): Record<string, number> | null {
    if (!c.route.tier || c.route.level >= RT.maxLevel) return null;
    const k = Math.pow(RT.levelGrowth, c.route.level) * c.route.tier;
    const out: Record<string, number> = {};
    for (const [r, n] of Object.entries(RT.levelCost)) out[r] = Math.round((n * k) / 10) * 10;
    return out;
  }
  private scaled(c: Camp, cost: Record<string, number>) {
    const def = regionById(c.chunk);
    const k = 1 + CAMP.distanceCost * Math.max(0, def ? Math.abs(def.cx) + Math.abs(def.cz) - 1 : 0);
    const out: Record<string, number> = {};
    for (const [r, n] of Object.entries(cost)) out[r] = r === 'money' ? Math.round((n * k) / 50) * 50 : Math.ceil(n * k);
    return out;
  }
  buyRoute(c: Camp) {
    const cost = this.routeCost(c);
    if (!cost || !this.depotPort(c.chunk) || !this.game.payCost(cost)) return false;
    c.route.tier++;
    this.syncSled(c);
    events.emit('toast', { text: `${ROUTE_TIERS[c.route.tier - 1].icon} ${ROUTE_TIERS[c.route.tier - 1].name}: ${c.name} → base`, color: '#b8f5a8' });
    return true;
  }
  buyRouteLevel(c: Camp) {
    const cost = this.levelCost(c);
    if (!cost || !this.game.payCost(cost)) return false;
    c.route.level++;
    return true;
  }
  /** Sled tiers have a sled; the flume doesn't. */
  private syncSled(c: Camp) {
    const t = ROUTE_TIERS[c.route.tier - 1];
    const wantSled = !!t && !t.flow && !!this.depotPort(c.chunk);
    if (wantSled && !c.sled) c.sled = new Sled(this.game, this, c);
    else if (wantSled) c.sled!.refreshLook();
    if (!wantSled && c.sled) {
      for (const [k, n] of Object.entries(c.sled.load)) this.add(c, k, n);
      c.sled.dispose();
      c.sled = undefined;
    }
  }

  /** Flume: items flow to the base continuously. */
  private flow(c: Camp, dt: number) {
    c.flowAcc = Math.min(5, c.flowAcc + (this.routeCapacity(c) * dt) / 60);
    while (c.flowAcc >= 1) {
      const item = this.nextToSend(c, (id) => baseAccepts(this.game, id));
      if (!item || !this.take(c, item, 1)) { c.flowAcc = Math.min(c.flowAcc, 1); return; }
      deliverToBase(this.game, item);
      this.delivered(c, item, 1);
      c.flowAcc -= 1;
    }
  }

  // ------------------------------------------------------------------ workers
  workers(chunk: string) { return this.game.workers.filter((w) => w.camp === chunk); }
  places(c: Camp) { return this.levelDef(c).workers; }
  freePlaces(c: Camp) { return Math.max(0, this.places(c) - this.workers(c.chunk).length); }

  /** Base lumberjacks that could move to a camp, longest trips first. */
  private movable(): Worker[] {
    return this.game.workers.filter((w) => w.kind === 'lumberjack' && !w.camp && w.alive).sort((a, b) => Number(!!a.res?.hired) - Number(!!b.res?.hired) || b.tripAvg - a.tripAvg);
  }

  /** An idle resident becomes a lumberjack of this camp. */
  hireIdle(chunk: string, kind: WorkerKind = 'lumberjack'): Worker | null {
    const c = this.camps.get(chunk);
    const s = this.game.residents.idleSurvivors()[0];
    if (!c || !s || this.freePlaces(c) <= 0 || !this.depotPort(chunk)) return null;
    const res = s.res!;
    this.game.survivors.remove(s);
    const at = this.hutSpot(chunk);
    const w = this.game.hireWorker(kind, at.x, at.z, res, undefined, chunk);
    w.x = s.x; w.z = s.z;
    return w;
  }

  /** Move a base lumberjack to the camp. */
  moveFromBase(chunk: string, minLeft = 0): Worker | null {
    const c = this.camps.get(chunk);
    if (!c || this.freePlaces(c) <= 0 || !this.depotPort(chunk)) return null;
    const list = this.movable();
    if (list.length <= minLeft) return null;
    const w = list[0];
    w.relocate(chunk, this.hutSpot(chunk));
    return w;
  }

  /** + in the camp tab: an idle resident if there is one, otherwise a lumberjack from the base. */
  assign(chunk: string) {
    const w = this.hireIdle(chunk) ?? this.moveFromBase(chunk);
    if (w) events.emit('toast', { text: `${w.res?.name ?? 'A lumberjack'} now works in ${this.camps.get(chunk)?.name}`, color: '#b8f5a8' });
    return !!w;
  }

  /** − in the camp tab: a camp lumberjack (not one of the hut's own) goes back to the base. */
  sendBack(chunk: string) {
    const hutId = campZoneId(chunk, 'hut');
    const ws = this.workers(chunk);
    const w = ws.find((q) => q.res?.zone !== hutId) ?? null;
    if (!w) return false;
    w.relocate(undefined, this.game.residents.workplace('lumberjack') ?? { x: 2.5, z: -3 });
    return true;
  }

  /**
   * Auto-assign: idle residents fill free camp places; then base lumberjacks whose recent trips are
   * long move to camps that have a route (their logs reach the base anyway, with short walks).
   */
  autoDistribute() {
    let n = 0;
    for (const c of this.camps.values()) {
      while (this.hireIdle(c.chunk)) n++;
      if (!c.route.tier) continue;
      // a full depot means the route is the bottleneck: more choppers there wouldn't help the base
      const dp = this.depotPort(c.chunk);
      if (!dp || dp.store.count > dp.store.cap * CAMP.autoMaxDepotFill) continue;
      while (this.freePlaces(c) > 0) {
        const w = this.movable()[0];
        if (!w || w.tripAvg < CAMP.autoMoveTrip || this.movable().length <= CAMP.minBaseLumberjacks) break;
        // the route must be able to carry what one more chopper fells
        const choppers = this.workers(c.chunk).filter((q) => q.kind === 'lumberjack').length + 1;
        if (this.routeRate(c) < choppers * CAMP.lumberjackRate * this.campLogMult(c)) break;
        w.relocate(c.chunk, this.hutSpot(c.chunk));
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    for (const c of this.camps.values()) {
      this.applyLook(c);
      // the depot grows with the camp (level-up costs need room for their logs)
      const dp = this.depotPort(c.chunk);
      if (dp) dp.store.cap = (partDef('depot').cap ?? 200) + CAMP.depotCapPerLevel * (c.level - 1);
      // logs saved on a sled come back to the depot's rack
      if (c.stock.log && this.depotPort(c.chunk)) { this.add(c, 'log', c.stock.log); delete c.stock.log; }
      if (c.route.tier && !c.sled && !ROUTE_TIERS[c.route.tier - 1]?.flow) this.syncSled(c);
      this.raids(c, dt);
      if (c.sled) c.sled.update(dt);
      else if (ROUTE_TIERS[c.route.tier - 1]?.flow) this.flow(c, dt);
    }
    // long walks at the base: re-check every minute (only moves people when the camp has a route)
    this.autoT -= dt;
    if (this.autoT <= 0) {
      this.autoT = 60;
      if (this.autoOn) { const n = this.autoDistribute(); if (n) events.emit('toast', { text: `🏕️ ${n} lumberjacks moved to camps (shorter trips)`, color: '#b8f5a8' }); }
    }
  }
  /** automatic distribution of lumberjacks to camps (Logistics screen toggle) */
  autoOn = false;

  serialize() {
    const camps: Record<string, SavedCamp> = {};
    for (const [k, c] of this.camps) {
      const stock = { ...c.stock };
      for (const [it, n] of Object.entries(c.sled?.load ?? {})) stock[it] = (stock[it] ?? 0) + n; // what's on the sled
      camps[k] = { level: c.level, stock, route: c.route, spec: c.spec, damage: c.damage, raidT: c.raidT, lastRaid: c.lastRaid };
    }
    return { camps, auto: this.autoOn };
  }
  /** Before zones are rebuilt, so founded camps get their saved state. */
  restore(d: { camps?: Record<string, SavedCamp>; auto?: boolean } | undefined) {
    this.saved = d?.camps ?? {};
    this.autoOn = !!d?.auto;
  }
}
