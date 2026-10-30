import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { SLOTS, type ZoneDef } from '../config/layout';
import { Building } from './building';
import { Geo, COLORS, mesh } from '../world/models';
import { ItemStore, Pile, CurrencyPile } from '../systems/storage';
import { events } from '../core/events';
import type { Game } from '../game';
import type { Survivor } from '../entities/survivor';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- Furnace
export class Furnace extends Building {
  heat: number = BALANCE.start.heat;
  readonly fuel: ItemStore;
  private smokeT = 0;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.furnace(), [3.6, 3.6]);
    const pile = new Pile(game.scene, Geo.log(), BALANCE.furnace.reserveCap, v(def.x + 2.8, 0.2, def.z + 0.6), { cols: 1, rows: 3, dx: 0.4, dz: 0.38, dy: 0.32 }, Math.PI / 2);
    this.fuel = new ItemStore('log', BALANCE.furnace.reserveCap, pile);
    this.fuel.onReceive = () => this.burnIfCold();
    game.addPort({ id: 'furnace', x: SLOTS.furnaceInput.x, z: SLOTS.furnaceInput.z, r: 2.3, mode: 'in', store: this.fuel, player: true, workers: true, anchor: v(def.x, 1.2, def.z + 1.4) });
  }

  private burnIfCold() {
    const F = BALANCE.furnace;
    while (this.heat < F.autoBurnBelow && this.fuel.take()) {
      this.heat = Math.min(F.maxHeat, this.heat + this.game.up.heatPerLog);
      this.game.fx.burst(this.def.x, 2.2, this.def.z + 1.4, COLORS.orange, 6, 3, 0.15, -2);
    }
  }

  update(dt: number) {
    const F = BALANCE.furnace;
    this.heat = Math.max(0, this.heat - F.decayPerSec * dt);
    this.burnIfCold();
    const h01 = this.heat / F.maxHeat;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.12;
      if (h01 > 0) this.game.fx.rise(this.def.x, 1.2, this.def.z + 1.5, Math.random() < 0.5 ? COLORS.orange : COLORS.yellow, 0.6, 0.18);
      this.game.fx.rise(this.def.x, 4.6, this.def.z, 0x9aa6b5, 0.4, 0.35 + h01 * 0.2);
    }
  }

  serialize() { return { heat: this.heat, fuel: this.fuel.count }; }
  restore(d: Record<string, number>) { this.heat = d.heat ?? this.heat; this.fuel.add(d.fuel ?? 0); }
  status() { return this.fuel.count > 0 ? `🪵${this.fuel.count}` : null; }
}

// ---------------------------------------------------------------- Counter (wood stall)
export class Counter extends Building {
  readonly stock: ItemStore;
  readonly cash: CurrencyPile;
  queue: Survivor[] = [];
  cashier = false;
  private serveT = 0;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.counter(), [3.6, 1.6]);
    const pile = new Pile(game.scene, Geo.log(), 30, v(def.x, 1.2, def.z), { cols: 3, rows: 2, dx: 0.95, dz: 0.4, dy: 0.32 });
    this.stock = new ItemStore('log', BALANCE.counter.stockCap, pile);
    this.cash = new CurrencyPile(game.scene, 'money', SLOTS.counterCash.x, SLOTS.counterCash.z, 10);
    game.addCashPile(this.cash);
    game.addPort({ id: 'counter', x: SLOTS.counterServe.x, z: SLOTS.counterServe.z, r: BALANCE.counter.serveRadius, mode: 'in', store: this.stock, player: true, workers: true });
  }

  canJoin() { return this.queue.length < this.game.up.queueSlots; }
  joinQueue(s: Survivor) { if (!this.queue.includes(s)) this.queue.push(s); }
  leaveQueue(s: Survivor) { const i = this.queue.indexOf(s); if (i >= 0) this.queue.splice(i, 1); }
  queueIndex(s: Survivor) { return this.queue.indexOf(s); }
  slotPos(i: number) {
    return { x: SLOTS.queueStart.x + SLOTS.queueStep.x * i, z: SLOTS.queueStart.z + SLOTS.queueStep.z * i };
  }

  get serving() {
    const p = this.game.player;
    const near = p.alive && Math.hypot(p.x - SLOTS.counterServe.x, p.z - SLOTS.counterServe.z) < BALANCE.counter.serveRadius;
    return near || this.cashier;
  }

  update(dt: number) {
    const g = this.game;
    this.serveT -= dt;
    const front = this.queue[0];
    if (!front || front.state !== 'queue' || g.heat <= 0 || !this.serving) return;
    if (this.serveT > 0) return;
    this.serveT = BALANCE.economy.serveInterval;
    if (front.got < front.want) {
      if (!this.stock.take()) return;
      front.got++;
      g.fx.fly(Geo.log(), this.stock.source().setY(1.4), v(front.x, 1.2, front.z), { dur: 0.25, arc: 0.8 });
      g.fx.pop(this.model);
    }
    if (front.got >= front.want) {
      const amount = g.eco.earn('money', front.want * g.up.logPrice * g.survivors.moodMult);
      this.leaveQueue(front);
      front.served();
      // coins fly from the customer onto the cash pile
      const n = Math.min(4, Math.ceil(amount / 10));
      for (let i = 0; i < n; i++) {
        g.fx.fly(Geo.cash(), v(front.x, 1.4, front.z), () => this.cash.top().setY(0.4), { dur: 0.35 + i * 0.06, arc: 1.5, done: i === n - 1 ? () => this.cash.add(amount) : undefined });
      }
      events.emit('customer:served', { amount });
    }
  }

  serialize() { return { stock: this.stock.count, cash: this.cash.amount }; }
  restore(d: Record<string, number>) { this.stock.add(d.stock ?? 0); this.cash.add(d.cash ?? 0); }
  status() { return this.queue.length ? `👥${this.queue.length}` : null; }
  statusAnchor() { return this.at(0, 0, 3.4); }
}

// ---------------------------------------------------------------- Kitchen
export class Kitchen extends Building {
  readonly input: ItemStore;
  readonly output: ItemStore;
  progress = 0;
  cook = false;
  private fireT = 0;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.kitchen(), [3.2, 2]);
    const K = BALANCE.kitchen;
    this.input = new ItemStore('meat', K.inputCap, new Pile(game.scene, Geo.meat(), K.inputCap, v(SLOTS.kitchenInput.x - 0.3, 0.15, SLOTS.kitchenInput.z - 1.3), { cols: 2, rows: 2, dx: 0.6, dz: 0.5, dy: 0.22 }));
    this.output = new ItemStore('cooked', K.outputCap, new Pile(game.scene, Geo.cooked(), K.outputCap, v(SLOTS.kitchenOutput.x, 0.15, SLOTS.kitchenOutput.z), { cols: 3, rows: 2, dx: 0.6, dz: 0.5, dy: 0.22 }));
    game.addPort({ id: 'kitchen', x: SLOTS.kitchenInput.x, z: SLOTS.kitchenInput.z, r: 2.0, mode: 'in', store: this.input, player: true, workers: true });
    game.addPort({ id: 'kitchen_out', x: SLOTS.kitchenOutput.x, z: SLOTS.kitchenOutput.z + 0.6, r: 1.7, mode: 'out', store: this.output, player: true, workers: true });
  }

  get tended() {
    const p = this.game.player;
    return this.cook || (p.alive && Math.hypot(p.x - this.def.x, p.z - this.def.z) < BALANCE.kitchen.tendRadius + 1.5);
  }

  update(dt: number) {
    const g = this.game;
    const cooking = this.input.count > 0 && this.output.space() > 0 && this.tended;
    if (cooking) {
      this.progress += dt / g.up.cookSeconds;
      this.fireT -= dt;
      if (this.fireT <= 0) { this.fireT = 0.1; g.fx.rise(this.def.x + (Math.random() - 0.5), 1.2, this.def.z + 0.2, Math.random() < 0.5 ? COLORS.orange : 0xbbbbbb, 0.8, 0.14); }
      if (this.progress >= 1) {
        this.progress = 0;
        this.input.take();
        this.output.reserve();
        g.fx.fly(Geo.cooked(), this.at(0, 0, 1.3), () => this.output.landing(), { dur: 0.35, arc: 1, done: () => this.output.receive() });
        g.fx.pop(this.model);
        events.emit('cook:done', { x: this.def.x, z: this.def.z });
      }
    }
  }

  serialize() { return { input: this.input.count, output: this.output.count }; }
  restore(d: Record<string, number>) { this.input.add(d.input ?? 0); this.output.add(d.output ?? 0); }
  status() {
    if (this.input.count > 0 && !this.tended) return '👨‍🍳?';
    return this.input.count > 0 ? `⏲${Math.round(this.progress * 100)}%` : null;
  }
}

// ---------------------------------------------------------------- Diner (canteen)
export class Diner extends Building {
  readonly food: ItemStore;
  readonly cash: CurrencyPile;
  seats: (Survivor | null)[];
  private plates: THREE.Mesh[] = [];

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.diner(), [3.6, 1.8]);
    const D = BALANCE.diner;
    this.seats = new Array(D.seats).fill(null);
    this.food = new ItemStore('cooked', D.foodCap, new Pile(game.scene, Geo.cooked(), D.foodCap, v(SLOTS.dinerInput.x, 0.15, SLOTS.dinerInput.z + 1.2), { cols: 2, rows: 2, dx: 0.6, dz: 0.5, dy: 0.22 }));
    this.cash = new CurrencyPile(game.scene, 'money', def.x - 2.8, def.z + 2.2, 12);
    game.addCashPile(this.cash);
    game.addPort({ id: 'diner', x: SLOTS.dinerInput.x, z: SLOTS.dinerInput.z, r: 1.9, mode: 'in', store: this.food, player: true, workers: true });
    for (let i = 0; i < D.seats; i++) {
      const p = mesh(Geo.cooked());
      const sp = this.seatPos(i);
      p.position.set(sp.x, 1.1, def.z + (sp.z > def.z ? 0.45 : -0.45));
      p.visible = false;
      game.scene.add(p);
      this.plates.push(p);
    }
  }

  seatPos(i: number) {
    const side = i % 2 === 0 ? 1 : -1;
    const col = Math.floor(i / 2);
    return { x: this.def.x - 0.8 + col * 1.6, z: this.def.z + side * 1.3 };
  }
  claimSeat(s: Survivor) { const i = this.seats.indexOf(null); if (i >= 0) this.seats[i] = s; return i; }
  releaseSeat(i: number) { if (i >= 0) { this.seats[i] = null; this.plates[i].visible = false; } }
  takeFood(s: Survivor) {
    if (!this.food.take()) return false;
    const i = this.seats.indexOf(s);
    if (i >= 0) {
      this.game.fx.fly(Geo.cooked(), this.food.source().setY(0.6), this.plates[i].position.clone(), { dur: 0.3, arc: 0.8, done: () => { this.plates[i].visible = this.seats[i] === s; } });
    }
    return true;
  }
  pay(s: Survivor) {
    const g = this.game;
    const amount = g.eco.earn('money', g.up.mealPrice * (0.5 + 0.5 * s.mood));
    g.fx.fly(Geo.cash(), v(s.x, 1.4, s.z), () => this.cash.top().setY(0.4), { dur: 0.4, arc: 1.5, done: () => this.cash.add(amount) });
    const i = this.seats.indexOf(s);
    if (i >= 0) this.plates[i].visible = false;
    events.emit('meal:eaten', { amount });
  }

  serialize() { return { food: this.food.count, cash: this.cash.amount }; }
  restore(d: Record<string, number>) { this.food.add(d.food ?? 0); this.cash.add(d.cash ?? 0); }
  status() { const n = this.seats.filter((s) => s).length; return n ? `🍽${n}/${this.seats.length}` : null; }
}

// ---------------------------------------------------------------- Lumber hut (log storage)
export class LumberHut extends Building {
  readonly store: ItemStore;
  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.lumberhut(), [3.6, 2.6]);
    const cap = BALANCE.storage.lumberHutCap;
    this.store = new ItemStore('log', cap, new Pile(game.scene, Geo.log(), cap, v(SLOTS.lumberOutput.x, 0.2, SLOTS.lumberOutput.z + 0.2), { cols: 3, rows: 2, dx: 0.95, dz: 0.38, dy: 0.32 }));
    // workers drop logs in; the player can only pick logs up here
    game.addPort({ id: 'lumber_in', x: SLOTS.lumberOutput.x, z: SLOTS.lumberOutput.z, r: 2.2, mode: 'in', store: this.store, player: false, workers: true });
    game.addPort({ id: 'lumber_out', x: SLOTS.lumberOutput.x, z: SLOTS.lumberOutput.z + 0.4, r: 1.8, mode: 'out', store: this.store, player: true, workers: true });
  }
  serialize() { return { logs: this.store.count }; }
  restore(d: Record<string, number>) { this.store.add(d.logs ?? 0); }
  status() { return `🪵${this.store.count}`; }
}

// ---------------------------------------------------------------- Homes (tents & cabins)
export class Home extends Building {
  constructor(game: Game, def: ZoneDef) {
    super(game, def, def.kind === 'tent' ? Geo.tent() : Geo.house(), def.kind === 'tent' ? [2.4, 2.4] : [3.2, 2.8]);
    const pop = def.params?.population ?? 2;
    const r = def.rot ?? 0;
    game.survivors.addHome(def.x + Math.sin(r) * 2.4, def.z + Math.cos(r) * 2.4, pop);
  }
}

// ---------------------------------------------------------------- Frost Beacon (end-game monument)
export class Monument extends Building {
  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.monument(), [4, 4]);
    const light = new THREE.PointLight(0x7fe0ff, 40, 18, 1.5);
    light.position.set(0, 6, 0);
    this.root.add(light);
  }
  update(dt: number) {
    if (Math.random() < dt * 8) this.game.fx.rise(this.def.x, 6, this.def.z, 0x9fe8ff, 1.2, 0.2);
  }
}
