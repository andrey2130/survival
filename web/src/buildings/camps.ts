import * as THREE from 'three';
import { CAMP, parseCampId, partDef } from '../config/settlements';
import type { ZoneDef } from '../config/layout';
import { Building } from './building';
import { Geo, COLORS } from '../world/models';
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
    this.store = new ItemStore('log', cap, new Pile(game.scene, Geo.log(), Math.min(cap, 48), v(def.x, 0.3, def.z), { cols: 3, rows: 4, dx: 0.95, dz: 0.4, dy: 0.32 }));
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
