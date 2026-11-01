import * as THREE from 'three';
import { BALANCE, growthCost } from '../config/balance';
import { PRODUCERS, RECIPES, res, isCurrency, type ProducerDef, type RecipeDef } from '../config/content';
import type { ResId, ZoneDef } from '../config/layout';
import { Building } from './building';
import { buildingGeo, itemGeo, COLORS } from '../world/models';
import { ItemStore, Pile, CurrencyPile, type PileLayout, type Port } from '../systems/storage';
import { events } from '../core/events';
import type { Cost } from '../systems/economy';
import type { Game } from '../game';

const PU = BALANCE.producers.upgrades;
export type ProducerUpgrade = keyof typeof PU;
export const PRODUCER_UPGRADES = Object.keys(PU) as ProducerUpgrade[];

const layoutOf = (l: number[]): PileLayout => ({ cols: l[0], rows: l[1], dx: l[2], dz: l[3], dy: l[4] });

/** Result of a fast-forward (offline) run. */
export interface SimResult { made: Record<ResId, number>; jobs: number; stopped: '' | 'input' | 'fuel' | 'full' | 'staff' }

/**
 * Generic production building, fully described by data/producers.json + balance.json "recipes":
 * input stores -> timed jobs (parallel slots) -> output store (or a currency pile on the ground).
 * Optional fuel and "tend" (needs a worker or the player nearby). Upgrades: speed, storage, slots.
 */
export class Producer extends Building {
  readonly spec: ProducerDef;
  readonly recipe: RecipeDef;
  readonly inputs = new Map<ResId, ItemStore>();
  /** inputs drawn from the resource bank instead of a local store */
  readonly bankInputs = new Set<ResId>();
  readonly fuel = new Map<ResId, ItemStore>();
  readonly output: ItemStore | null = null;
  readonly cash: CurrencyPile | null = null;
  /** progress 0..1 of each running job (one per slot) */
  jobs: number[] = [];
  /** seconds of fuel left in the fire box */
  burn = 0;
  /** set every frame by a tending worker (e.g. the cook) */
  staffed = false;
  levels: Record<ProducerUpgrade, number> = { speed: 0, capacity: 0, slots: 0 };
  private fxT = 0;
  private baseCaps = new Map<ItemStore, number>();

  constructor(game: Game, def: ZoneDef) {
    const spec = PRODUCERS[def.params?.producer ?? ''];
    super(game, def, buildingGeo(spec.model), spec.footprint);
    this.spec = spec;
    this.recipe = RECIPES[spec.recipe];
    let first = true;
    for (const [r, s] of Object.entries(spec.inputs)) {
      // bank inputs come straight from the Warehouse stock (no pile, no hauling)
      if (s.bank) { this.bankInputs.add(r); continue; }
      const store = this.makeStore(r, s.cap, s.pile, s.layout);
      this.inputs.set(r, store);
      this.port(first ? def.id : `${def.id}_${r}`, s.port, 'in', store);
      first = false;
    }
    if (spec.fuel) {
      const f = spec.fuel;
      Object.keys(f.burn).forEach((r, i) => {
        const store = this.makeStore(r, f.cap, [f.pile[0] + i * 1.1, f.pile[1], f.pile[2]], [1, 2, 0.4, 0.45, 0.3]);
        this.baseCaps.delete(store); // fire boxes don't grow with Storage upgrades: no 100-log stockpiles
        this.fuel.set(r, store);
        this.port(`${def.id}_fuel_${r}`, f.port, 'in', store);
      });
    }
    // fire inside: a glow halo (High quality) — kitchens, smelters, smokehouses
    if (['kitchen', 'smelter', 'smokehouse'].includes(spec.model)) game.world.addGlow(def.x, 1.6, def.z, 0xff8a3c, 4.5);
    const o = spec.output;
    const outRes = Object.keys(this.recipe.out)[0];
    if (o.currencyPile) {
      const p = this.off(o.currencyPile[0], o.currencyPile[1]);
      this.cash = new CurrencyPile(game.scene, outRes, p.x, p.z, o.unit ?? 1, o.visualCap ?? 40);
      game.addCashPile(this.cash);
    } else if (o.cap && o.pile && o.port && o.layout) {
      this.output = this.makeStore(outRes, o.cap, o.pile, o.layout);
      this.port(`${def.id}_out`, o.port, 'out', this.output);
    }
  }

  // ------------------------------------------------------------------ construction helpers
  /** Zone-relative offset -> world position (respects the zone rotation). */
  private off(dx: number, dz: number, y = 0) {
    const r = this.def.rot ?? 0, c = Math.cos(r), s = Math.sin(r);
    return new THREE.Vector3(this.def.x + dx * c + dz * s, y, this.def.z - dx * s + dz * c);
  }

  private makeStore(r: ResId, cap: number, pile: number[], layout: number[]) {
    const p = this.off(pile[0], pile[2], pile[1]);
    const store = new ItemStore(r, cap, new Pile(this.game.scene, itemGeo(r), cap * 2, p, layoutOf(layout), this.def.rot ?? 0));
    this.baseCaps.set(store, cap);
    return store;
  }

  private port(id: string, spec: number[], mode: 'in' | 'out', store: ItemStore) {
    const p = this.off(spec[0], spec[1]);
    // finished medicine waits on the table for patients — the hero shouldn't scoop it up
    const player = !(mode === 'out' && this.spec.output.patientsOnly);
    this.game.addPort({ id, x: p.x, z: p.z, r: spec[2], mode, store, player, workers: true });
  }

  // ------------------------------------------------------------------ derived numbers
  get speed() {
    const g = this.game;
    return (1 + this.levels.speed * PU.speed.perLevel) * (this.spec.speedUpgrade ? g.up.mult(this.spec.speedUpgrade) : 1) * (1 + g.research.value('prod'));
  }
  get slots() { return 1 + this.levels.slots * PU.slots.perLevel; }
  get capMult() { return 1 + this.levels.capacity * PU.capacity.perLevel; }
  get outQty() { return Object.values(this.recipe.out)[0]; }
  get outRes() { return Object.keys(this.recipe.out)[0]; }

  get tended() {
    if (!this.spec.tend || this.staffed) return true;
    const p = this.game.player;
    return p.alive && Math.hypot(p.x - this.def.x, p.z - this.def.z) < BALANCE.producers.tendRadius;
  }

  private reserved(r: ResId) { return this.jobs.length * (this.recipe.in[r] ?? 0); }
  /** amount of an input on hand (local store or the bank) */
  /** amount usable (bank inputs leave the Warehouse reserve alone, see Logistics) */
  have(r: ResId) { return this.bankInputs.has(r) ? Math.max(0, this.game.eco.get(r) - this.game.logistics.bankReserve(r)) : (this.inputs.get(r)?.count ?? 0); }
  private takeInput(r: ResId, n: number) {
    if (this.bankInputs.has(r)) this.game.eco.add(r, -n);
    else for (let i = 0; i < n; i++) this.inputs.get(r)?.take();
  }
  private canStart() {
    for (const [r, n] of Object.entries(this.recipe.in)) {
      if (this.have(r) - this.reserved(r) < n) return false;
    }
    if (this.output && this.output.space() - this.jobs.length * this.outQty < this.outQty) return false;
    if (this.warehouseFull) return false;
    return true;
  }
  /** banked output at its cap (e.g. charcoal kiln stops at 300 coal) */
  get warehouseFull() { const c = this.spec.output.bankCap; return !!c && this.game.eco.get(this.outRes) >= c; }
  get fuelLeftPublic() { return this.fuelLeft(); }
  private fuelLeft() {
    let s = this.burn;
    for (const [r, st] of this.fuel) s += st.count * (this.spec.fuel!.burn[r] ?? 0);
    for (const [r, secs] of Object.entries(this.spec.fuel?.bankFuel ?? {})) s += this.game.eco.get(r) * secs;
    return s;
  }
  private refuel(): boolean {
    if (!this.spec.fuel) return true;
    if (this.burn > 0) return true;
    // charcoal from the Warehouse is the main fuel; wood in the fire box is the fallback
    for (const [r, secs] of Object.entries(this.spec.fuel.bankFuel ?? {})) {
      if (this.game.eco.get(r) >= 1) { this.game.eco.add(r, -1); this.burn += secs; this.game.flows.add(r, -1, `${this.def.id} fuel`); return true; }
    }
    // burn the longest-lasting fuel first (coal before wood)
    const order = [...this.fuel.entries()].sort((a, b) => (this.spec.fuel!.burn[b[0]] ?? 0) - (this.spec.fuel!.burn[a[0]] ?? 0));
    for (const [r, st] of order) if (st.take()) { this.burn += this.spec.fuel.burn[r] ?? 0; this.game.flows.add(r, -1, `${this.def.id} fuel`); return true; }
    return false;
  }

  // ------------------------------------------------------------------ simulation
  get isIndustry() { return this.game.logistics.isIndustry(this.spec.class); }
  /** emergency mode: industry finishes what it started but takes no new jobs */
  get paused() { return this.isIndustry && this.game.logistics.emergency; }

  update(dt: number) {
    const g = this.game;
    this.applyCaps();
    while (!this.paused && this.jobs.length < this.slots && this.canStart()) this.jobs.push(0);
    const working = this.jobs.length > 0 && this.tended && this.refuel();
    g.flows.track(this.def.id, working, dt);
    if (this.spec.output.dispatch) this.dispatch(dt);
    if (working) {
      const k = (dt * this.speed) / this.recipe.seconds;
      if (this.spec.fuel) this.burn = Math.max(0, this.burn - dt * this.speed * g.fuelMult);
      for (let i = 0; i < this.jobs.length; i++) this.jobs[i] += k;
      this.fxT -= dt;
      if (this.fxT <= 0) {
        this.fxT = 0.12;
        g.fx.rise(this.def.x + (Math.random() - 0.5), 1.4, this.def.z + 0.2, Math.random() < 0.5 ? COLORS.orange : 0xbbbbbb, 0.7, 0.13);
      }
      for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i] >= 1) { this.jobs.splice(i, 1); this.finishJob(); }
    }
    this.staffed = false; // workers re-assert every frame
  }

  private dispatchT = 0;
  /** Send finished goods on their own to the least-filled store of that type (e.g. farm meat -> kitchens). */
  private dispatch(dt: number) {
    const out = this.output, g = this.game;
    this.dispatchT -= dt;
    if (!out || out.count <= 0 || this.dispatchT > 0) return;
    this.dispatchT = 0.4;
    let best: Port | null = null, bf = 1;
    for (const p of g.ports) {
      if (p.mode !== 'in' || !p.workers || p.settlement || p.store === out || p.store.type !== out.type || p.store.space() <= 0) continue;
      const fill = (p.store.count + p.store.incoming) / p.store.cap;
      if (fill < bf) { bf = fill; best = p; }
    }
    if (!best) return;
    const to = best;
    const from = out.source().clone();
    out.take();
    to.store.reserve();
    g.fx.fly(itemGeo(out.type), from, () => to.anchor ?? to.store.landing(), { dur: 0.9, arc: 4, done: () => to.store.receive() });
    g.flows.add(`${out.type}>${to.id}`, 1, 'moved');
  }

  private finishJob() {
    const g = this.game;
    for (const [r, n] of Object.entries(this.recipe.in)) { this.takeInput(r, n); g.flows.add(r, -n, this.def.id); }
    g.flows.add(this.outRes, this.outQty, this.def.id);
    const from = this.at(0, 0, 1.4);
    if (this.spec.output.bank) {
      // straight into the resource bank — nothing to haul, nothing to block the building
      const qty = this.outQty;
      g.fx.fly(itemGeo(this.outRes), from, from.clone().setY(4.5), { dur: 0.45, arc: 0.5, scaleTo: 0.3, done: () => g.eco.add(this.outRes, qty) });
      g.labels.float(this.def.x, 3.4, this.def.z, `+${qty} ${res(this.outRes).icon}`, '#ffe9b0', 0.9);
    } else if (this.cash) {
      const amount = this.cashAmount(this.outQty);
      g.fx.fly(itemGeo(this.outRes), from, () => this.cash!.top().setY(0.4), { dur: 0.4, arc: 1, done: () => this.cash!.add(amount) });
    } else if (this.output) {
      const out = this.output;
      for (let i = 0; i < this.outQty; i++) {
        out.reserve();
        g.fx.fly(itemGeo(this.outRes), from, () => out.landing(), { dur: 0.35 + i * 0.05, arc: 1, done: () => out.receive() });
      }
    }
    g.fx.pop(this.model);
    events.emit('producer:done', { id: this.def.id, out: this.outRes, x: this.def.x, z: this.def.z });
    if (this.outRes === 'cooked') events.emit('cook:done', { x: this.def.x, z: this.def.z });
    if (this.outRes === 'gold') events.emit('gold:smelted', { x: this.def.x, z: this.def.z });
  }

  private cashAmount(qty: number) {
    const g = this.game;
    const boost = this.recipe.incomeBoost === 'goldIncome' ? g.up.goldIncomeMult : 1;
    return Math.max(1, Math.round(qty * boost * (g.eco.doubleIncomeLeft > 0 ? 2 : 1)));
  }

  private applyCaps() {
    const m = this.capMult;
    for (const [st, base] of this.baseCaps) st.cap = Math.round(base * m);
  }

  /**
   * Fast-forward `seconds` without visuals (offline progress / debug time skip). Honours input shortage,
   * fuel, output storage and tending (`staffed` = a tending worker exists).
   */
  simulate(seconds: number, staffed: boolean): SimResult {
    const r: SimResult = { made: {}, jobs: 0, stopped: '' };
    if (this.spec.tend && !staffed) { r.stopped = this.inputsReady() ? 'staff' : ''; return r; }
    this.applyCaps();
    const perJob = this.recipe.seconds / this.speed;
    let jobs = Math.floor((seconds * this.slots) / perJob);
    const limit = (n: number, why: SimResult['stopped']) => { if (n < jobs) { jobs = Math.max(0, n); r.stopped = why; } };
    for (const [res_, n] of Object.entries(this.recipe.in)) limit(Math.floor(this.have(res_) / n), 'input');
    if (this.output) limit(Math.floor(this.output.space() / this.outQty), 'full');
    if (this.spec.fuel) limit(Math.floor((this.fuelLeft() / (perJob * this.game.fuelMult)) * this.slots), 'fuel');
    if (jobs <= 0) return r;
    for (const [res_, n] of Object.entries(this.recipe.in)) this.takeInput(res_, jobs * n);
    if (this.spec.fuel) {
      let need = (jobs * perJob * this.game.fuelMult) / this.slots;
      while (need > 0 && (this.burn > 0 || this.refuel())) { const b = Math.min(this.burn, need); this.burn -= b; need -= b; }
    }
    const qty = jobs * this.outQty;
    if (this.spec.output.bank) this.game.eco.add(this.outRes, qty);
    else if (this.cash) this.cash.add(this.cashAmount(qty));
    else this.output?.add(qty);
    r.made[this.outRes] = this.cash ? this.cashAmount(qty) : qty;
    r.jobs = jobs;
    return r;
  }

  private inputsReady() { return Object.entries(this.recipe.in).every(([k, n]) => this.have(k) >= n); }

  // ------------------------------------------------------------------ upgrades
  upgradeCost(u: ProducerUpgrade): Cost {
    const out: Cost = {};
    const mult = this.spec.upgradeCostMult ?? 1;
    for (const [k, v] of Object.entries(PU[u].cost)) out[k] = growthCost(v * mult, 'producers', this.levels[u]);
    return out;
  }
  maxed(u: ProducerUpgrade) { return this.levels[u] >= PU[u].maxLevel; }
  buyUpgrade(u: ProducerUpgrade): boolean {
    if (this.maxed(u) || !this.game.payCost(this.upgradeCost(u))) return false;
    this.levels[u]++;
    this.applyCaps();
    this.game.fx.ring(this.def.x, this.def.z, 0xffe27a, 4, 0.6);
    events.emit('upgrade:bought', { id: `${this.def.id}.${u}`, level: this.levels[u] });
    return true;
  }

  // ------------------------------------------------------------------ persistence / UI
  serialize() {
    const d: Record<string, number> = { burn: this.burn };
    for (const [r, st] of this.inputs) d[`in_${r}`] = st.count;
    for (const [r, st] of this.fuel) d[`fuel_${r}`] = st.count;
    if (this.output) d.out = this.output.count;
    if (this.cash) d.cash = this.cash.amount;
    for (const u of PRODUCER_UPGRADES) d[`lv_${u}`] = this.levels[u];
    this.jobs.forEach((p, i) => { d[`job${i}`] = p; });
    return d;
  }

  restore(d: Record<string, number>) {
    for (const u of PRODUCER_UPGRADES) this.levels[u] = Math.min(PU[u].maxLevel, d[`lv_${u}`] ?? 0);
    this.applyCaps();
    for (const [r, st] of this.inputs) st.add(d[`in_${r}`] ?? 0);
    // fuel added to a building after the save was made (e.g. the smelter): start with a half box
    for (const [r, st] of this.fuel) st.add(d[`fuel_${r}`] ?? Math.floor(st.cap / 2));
    this.output?.add(d.out ?? 0);
    // older saves kept finished goods in a pile here; they now go to the bank
    if (this.spec.output.bank && d.out) this.game.eco.add(this.outRes, d.out);
    this.cash?.add(d.cash ?? 0);
    this.burn = d.burn ?? 0;
    for (let i = 0; d[`job${i}`] !== undefined && i < this.slots; i++) this.jobs.push(d[`job${i}`]);
  }

  /**
   * Indicator over the building — always visible so a stalled chain is obvious at a glance:
   * Working / No <input> / No fuel / Storage full / No worker.
   */
  private state(): { text: string; tone: 'ok' | 'warn' | 'bad' } {
    const tendIcon = this.spec.tend === 'cook' ? '🧑‍🍳' : this.spec.tend === 'fisher' ? '🎣' : '🧑‍🔧';
    if (this.paused && !this.jobs.length) return { text: '⏸ Paused (emergency)', tone: 'warn' };
    if (this.jobs.length) {
      if (!this.tended) return { text: `${tendIcon} No worker — stand here`, tone: 'bad' };
      if (this.spec.fuel && this.burn <= 0 && this.fuelLeft() <= 0) return { text: `🔥 No fuel (${this.fuelNames()})`, tone: 'bad' };
      const p = Math.round(Math.max(...this.jobs) * 100);
      return { text: `⚙️ Working ${p}%${this.jobs.length > 1 ? ` ×${this.jobs.length}` : ''}`, tone: 'ok' };
    }
    if (this.output && this.output.space() < this.outQty) return { text: `📦 Storage full`, tone: 'warn' };
    if (this.warehouseFull) return { text: `📦 Warehouse has ${this.spec.output.bankCap} ${res(this.outRes).icon}`, tone: 'warn' };
    for (const [r, n] of Object.entries(this.recipe.in)) {
      if (this.have(r) < n) {
        // starved on purpose: the base takes logs first
        if (this.isIndustry && !this.game.logistics.industryAllowed(r)) return { text: `${res(r).icon} Waiting: base first`, tone: 'warn' };
        return { text: `${res(r).icon} No ${res(r).name.toLowerCase()}${this.bankInputs.has(r) ? ' in the Warehouse' : ''}`, tone: 'warn' };
      }
    }
    if (this.spec.fuel && this.fuelLeft() <= 0) return { text: `🔥 No fuel (${this.fuelNames()})`, tone: 'bad' };
    if (!this.tended) return { text: `${tendIcon} No worker`, tone: 'bad' };
    return { text: '⚙️ Working', tone: 'ok' };
  }

  private fuelNames() { return Object.keys(this.spec.fuel?.burn ?? {}).map((r) => res(r).icon).join('/'); }

  private stateCache: { text: string; tone: 'ok' | 'warn' | 'bad' } | null = null;
  private stateAt = -1;
  private cachedState() {
    const t = this.game.time;
    if (!this.stateCache || t - this.stateAt > 0.2 || t < this.stateAt) { this.stateCache = this.state(); this.stateAt = t; }
    return this.stateCache;
  }
  status() { return this.cachedState().text; }
  statusTone() { return this.cachedState().tone; }

  debugInfo() {
    const fuel = this.spec.fuel ? ` · 🔥${this.fuelLeft().toFixed(0)}s` : '';
    const staff = this.spec.tend ? ` · ${this.staffed || this.tended ? 'staffed' : 'no staff'}` : '';
    return `${super.debugInfo()}${fuel}${staff} · jobs ${this.jobs.length}/${this.slots}`;
  }
}

/**
 * Warehouse: drop any bankable item here and it goes into the resource bank — used by menus
 * (upgrades, research) and zone item costs.
 */
export class Warehouse extends Building {
  constructor(game: Game, def: ZoneDef) {
    super(game, def, buildingGeo('warehouse'), [3, 2]);
    const store = new ItemStore('*', Number.MAX_SAFE_INTEGER);
    game.addPort({ id: def.id, x: def.x, z: def.z + 2.1, r: BALANCE.warehouse.radius, mode: 'in', store, player: true, workers: true, bank: true, anchor: this.at(0, 0, 1.4) });
  }
  status() { return '🏦'; }
}

export const bankable = (id: ResId) => !isCurrency(id) && !!res(id).bankable;
