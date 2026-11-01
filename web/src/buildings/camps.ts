import * as THREE from 'three';
import { CAMP, WORKSHOPS, parseCampId, partDef } from '../config/settlements';
import { res } from '../config/content';
import type { ZoneDef, WorkerKind } from '../config/layout';
import { Building } from './building';
import { Geo, COLORS, buildingGeo } from '../world/models';
import { ItemStore, Pile } from '../systems/storage';
import type { Game } from '../game';

const F = CAMP.fire;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Chunk id of the camp a zone belongs to. */
const chunkOf = (def: ZoneDef) => parseCampId(def.id)!.chunk;

// ---------------------------------------------------------------- Camp fire (the camp's furnace)
/**
 * Bought with the "Found camp" zone. Burns slowly; while it's lit, the camp's workers stay warm
 * anywhere in their location (cold workers lose mood and work slower). Camp lumberjacks keep it fed.
 */
export class CampFire extends Building {
  readonly chunk: string;
  readonly fuel: ItemStore;
  heat = 60;
  private flame: THREE.Mesh;
  private t = 0;
  private smokeT = 0;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.campfire(), [2.2, 2.2]);
    this.chunk = chunkOf(def);
    this.flame = new THREE.Mesh(Geo.flame(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.flame.position.y = 0.15;
    this.root.add(this.flame);
    const pile = new Pile(game.scene, Geo.log(), F.fuelCap, v(def.x + 1.9, 0.2, def.z - 0.6), { cols: 2, rows: 2, dx: 0.95, dz: 0.38, dy: 0.32 }, Math.PI / 2);
    this.fuel = new ItemStore('log', F.fuelCap, pile);
    game.addPort({ id: def.id, x: def.x + 1.9, z: def.z + 1.4, r: 2, mode: 'in', store: this.fuel, player: true, workers: true, settlement: this.chunk });
    game.settlements.found(this.chunk, this);
  }

  get lit() { return this.heat > 0; }
  get short() { return this.fuel.count + this.fuel.incoming < F.lowFuel && this.fuel.space() > 0; }

  update(dt: number) {
    const g = this.game;
    this.heat = Math.max(0, this.heat - F.decayPerSec * dt);
    while (this.heat < F.autoBurnBelow && this.fuel.take()) {
      g.flows.add('log', -1, 'camp fires');
      this.heat = Math.min(F.maxHeat, this.heat + F.heatPerLog);
    }
    // no logs in the box: the camp's own peat
    const c = g.settlements.camp(this.chunk);
    while (c && this.heat < F.autoBurnBelow - 20 && g.settlements.take(c, 'peat', 1)) {
      g.flows.add('peat', -1, 'camp fires');
      this.heat = Math.min(F.maxHeat, this.heat + F.heatPerLog * 2);
    }
    const h01 = this.heat / F.maxHeat;
    this.t += dt;
    const fl = 1 + Math.sin(this.t * 15) * 0.1;
    const k = h01 <= 0 ? 0.0001 : 0.25 + 0.35 * h01;
    this.flame.scale.set(k * (2 - fl), k * fl, k * (2 - fl));
    this.flame.rotation.y += dt * 1.5;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.25;
      if (h01 > 0) g.fx.rise(this.def.x, 1.2 + h01, this.def.z, Math.random() < 0.5 ? COLORS.orange : COLORS.yellow, 0.8, 0.15);
      else g.fx.rise(this.def.x, 0.8, this.def.z, 0x9aa6b5, 0.6, 0.3);
    }
  }

  serialize() { return { heat: this.heat, fuel: this.fuel.count }; }
  restore(d: Record<string, number>) { this.heat = d.heat ?? this.heat; this.fuel.add(d.fuel ?? 0); }
  status() {
    const c = this.game.settlements.camp(this.chunk);
    const lvl = c ? ` Lv${c.level}` : '';
    return this.lit ? `🏕️${lvl} 🔥${this.fuel.count}` : `🏕️${lvl} ❄️ fire out`;
  }
  statusTone() { return this.lit ? '' as const : 'bad' as const; }
  statusAnchor() { return this.at(0, 0, 2.6); }
}

// ---------------------------------------------------------------- Forest depot (the camp's hub)
/** Camp workers drop their logs here (short trips); the hero can pick them up. */
export class CampDepot extends Building {
  readonly chunk: string;
  readonly store: ItemStore;
  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.campDepot(), [3.6, 2.0]);
    this.chunk = chunkOf(def);
    const cap = partDef('depot').cap ?? 80;
    this.store = new ItemStore('log', cap, new Pile(game.scene, Geo.log(), Math.min(cap, 60), v(def.x, 0.3, def.z), { cols: 3, rows: 4, dx: 0.95, dz: 0.4, dy: 0.32 }));
    game.addPort({ id: def.id, x: def.x, z: def.z + 2.0, r: 2.2, mode: 'in', store: this.store, player: false, workers: true, settlement: this.chunk });
    game.addPort({ id: `${def.id}_out`, x: def.x, z: def.z + 2.4, r: 1.8, mode: 'out', store: this.store, player: true, workers: true, settlement: this.chunk });
  }
  serialize() { return { logs: this.store.count }; }
  restore(d: Record<string, number>) { this.store.add(d.logs ?? 0); }
  status() { return `🪵${this.store.count}/${this.store.cap}`; }
  statusTone() { return this.store.space() <= 0 ? 'warn' as const : '' as const; }
}

// ---------------------------------------------------------------- Woodcutters' hut (camp housing)
/** Tents of the camp's woodcutters: hires lumberjacks who only work this location. */
export class CampHut extends Building {
  readonly chunk: string;
  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.tent(), [2.4, 2.4]);
    this.chunk = chunkOf(def);
    const n = partDef('hut').hires ?? 1;
    for (let i = 0; i < n; i++) game.hireWorker('lumberjack', def.x - 1 + i * 2, def.z + 2.2, undefined, def.id, this.chunk);
  }
}

// ---------------------------------------------------------------- Camp workshops (slot buildings)
/**
 * Sawmill, nursery, hunting lodge, gatherers' hut, tar kiln (data/settlements.json → camp.workshops).
 * They work from the camp's own stock: recipes turn camp goods into other goods, gatherers find goods,
 * the lodge hires a hunter for the location, the nursery speeds up regrowth (see Settlements.treeMod).
 */
export class CampWorkshop extends Building {
  readonly chunk: string;
  readonly type: string;
  private recipe = -1;
  private progress = 0;
  private acc = 0;
  /** goods made in the last minute (status label) */
  private made = 0;
  private madeT = 0;
  private lastOut = '';

  constructor(game: Game, def: ZoneDef) {
    super(game, def, buildingGeo(WORKSHOPS[def.params!.producer!].model), [3.2, 2.4]);
    this.chunk = chunkOf(def);
    this.type = def.params!.producer!;
    const w = WORKSHOPS[this.type];
    for (const [kind, n] of Object.entries(w.hires ?? {})) {
      for (let i = 0; i < n; i++) game.hireWorker(kind as WorkerKind, def.x + i, def.z + 2.4, undefined, def.id, this.chunk);
    }
  }

  get spec() { return WORKSHOPS[this.type]; }

  update(dt: number) {
    const S = this.game.settlements, c = S.camp(this.chunk);
    if (!c) return;
    this.madeT += dt;
    if (this.madeT > 60) { this.madeT = 0; this.made = 0; }
    const mult = S.productionMult(c, this.type);
    const w = this.spec;
    if (w.gather) {
      this.acc += (dt * w.gather * mult) / 60;
      while (this.acc >= 1) {
        this.acc -= 1;
        const item = S.gatherPick(c);
        if (item && S.add(c, item, 1)) { this.made++; this.lastOut = item; this.game.flows.add(item, 1, 'camp gatherers'); }
      }
    }
    const rs = w.recipes;
    if (!rs) return;
    if (this.recipe < 0) {
      this.recipe = rs.findIndex((r) => Object.entries(r.until ?? {}).every(([k, n]) => S.count(c, k) < n)
        && Object.entries(r.in).every(([k, n]) => S.count(c, k) >= n) && Object.keys(r.out).every((k) => S.space(c, k) > 0));
      if (this.recipe < 0) return;
      const r = rs[this.recipe];
      for (const [k, n] of Object.entries(r.in)) { S.take(c, k, n); this.game.flows.add(k, -n, this.spec.name); }
      this.progress = 0;
    }
    const r = rs[this.recipe];
    this.progress += (dt * mult) / r.seconds;
    if (this.progress < 1) return;
    for (const [k, n] of Object.entries(r.out)) { S.add(c, k, n); this.game.flows.add(k, n, this.spec.name); this.made += n; this.lastOut = k; }
    this.recipe = -1;
  }

  serialize() { return { recipe: this.recipe, progress: this.progress }; }
  restore(d: Record<string, number>) { this.recipe = d.recipe ?? -1; this.progress = d.progress ?? 0; }
  status() {
    const w = this.spec;
    if (w.regrow) return `${w.icon} regrowth x${w.regrow}`;
    if (w.hires) return `${w.icon}`;
    if (this.recipe >= 0 && w.recipes) return `${w.icon} → ${Object.keys(w.recipes[this.recipe].out).map((k) => res(k).icon).join('')}`;
    return this.made ? `${w.icon} +${this.made}${this.lastOut ? res(this.lastOut).icon : ''}/min` : `${w.icon} idle`;
  }
}
