import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { MINE, ZONES, type ZoneDef } from '../config/layout';
import { Building } from './building';
import { Geo, mesh } from '../world/models';
import { ItemStore, Pile } from '../systems/storage';
import type { Game } from '../game';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = BALANCE.mine;

/** Gold rock (decor + mining target) and the ore loader where carts get filled. */
export class MineStation extends Building {
  readonly ore: ItemStore;
  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.mineStation(), [3.2, 2.6]);
    const rock = mesh(Geo.goldRock());
    rock.position.set(MINE.rock.x, 0, MINE.rock.z);
    game.scene.add(rock);
    game.nav.setCircle(MINE.rock.x, MINE.rock.z, 2.4, 1);
    const cap = BALANCE.storage.mineStationCap;
    this.ore = new ItemStore('ore', cap, new Pile(game.scene, Geo.ore(), cap, v(def.x + 2.4, 0.15, def.z + 0.4), { cols: 2, rows: 2, dx: 0.45, dz: 0.45, dy: 0.3 }));
    game.addPort({ id: 'minestation', x: def.x + 2.4, z: def.z + 1.4, r: 2.0, mode: 'in', store: this.ore, player: true, workers: true });
  }
  serialize() { return { ore: this.ore.count }; }
  restore(d: Record<string, number>) { this.ore.add(d.ore ?? 0); }
  status() { return this.ore.count ? `⛏${this.ore.count}` : null; }
}

/** Gallery entrance: buying it opens the mine level (the system draws the cave). */
export class MineLevel extends Building {
  constructor(game: Game, def: ZoneDef) {
    super(game, def, null);
    game.mine.unlock(def.params?.level ?? 2);
  }
}

/** Lantern post inside a gallery: each one makes it lighter (faster mining, fewer bats). */
const lanternGlass = new THREE.MeshBasicMaterial({ color: 0xffd27a });
export class Lantern extends Building {
  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.lantern());
    this.model.add(new THREE.Mesh(Geo.lanternGlass(), lanternGlass));
    game.mine.addLantern(def.params?.level ?? 2, def.x, def.z);
    game.nav.setCircle(def.x, def.z, 0.4, 1);
  }
}

/** One stretch of rail track. */
export class Rail extends Building {
  constructor(game: Game, def: ZoneDef) {
    super(game, def, null);
    const [ax, az] = def.params!.from!, [bx, bz] = def.params!.to!;
    const len = Math.hypot(bx - ax, bz - az);
    const m = mesh(Geo.rail(len + 0.4));
    m.position.set((ax + bx) / 2 - def.x, 0, (az + bz) / 2 - def.z);
    m.rotation.y = Math.atan2(bx - ax, bz - az);
    this.root.rotation.y = 0;
    this.root.add(m);
  }
}

/** Mine cart: loads ore at the station, rides the rails, unloads into the smelter. */
export class Cart extends Building {
  private cart: THREE.Mesh;
  private oreMesh: THREE.Mesh;
  private path: { x: number; z: number }[];
  private lengths: number[] = [];
  private total = 0;
  private s = 0;
  private state: 'load' | 'go' | 'unload' | 'back' = 'load';
  private load = 0;
  private t = 0;
  private wait = 0;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, null);
    // extra carts start spread along the track so they don't ride on top of each other
    const nth = ZONES.filter((z) => z.kind === 'cart').findIndex((z) => z.id === def.id);
    const rails = ZONES.filter((z) => z.kind === 'rail');
    this.path = [{ x: rails[0].params!.from![0], z: rails[0].params!.from![1] }, ...rails.map((r) => ({ x: r.params!.to![0], z: r.params!.to![1] }))];
    for (let i = 1; i < this.path.length; i++) {
      const l = Math.hypot(this.path[i].x - this.path[i - 1].x, this.path[i].z - this.path[i - 1].z);
      this.lengths.push(l);
      this.total += l;
    }
    this.cart = mesh(Geo.cart());
    this.oreMesh = mesh(Geo.ore());
    this.oreMesh.scale.setScalar(2.2);
    this.oreMesh.position.y = 1.0;
    this.cart.add(this.oreMesh);
    game.scene.add(this.cart);
    this.root.visible = false;
    if (nth > 0) { this.s = (this.total * nth) / 3; this.state = 'back'; }
    this.place();
  }

  private get capacity() { return M.cartCapacity + Math.round(this.game.up.mult('cartCapacity') - 1); }
  private get speed() { return M.cartSpeed * this.game.up.mult('cartSpeed'); }

  private place() {
    let s = this.s;
    for (let i = 0; i < this.lengths.length; i++) {
      if (s <= this.lengths[i] || i === this.lengths.length - 1) {
        const a = this.path[i], b = this.path[i + 1];
        const k = Math.min(1, s / this.lengths[i]);
        this.cart.position.set(a.x + (b.x - a.x) * k, 0, a.z + (b.z - a.z) * k);
        this.cart.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        return;
      }
      s -= this.lengths[i];
    }
  }

  update(dt: number) {
    const g = this.game;
    const station = g.building<MineStation>('minestation');
    const smelter = g.port('smelter')?.store;
    if (!station || !smelter) return;
    this.oreMesh.visible = this.load > 0;
    this.oreMesh.scale.setScalar(1.2 + (this.load / this.capacity) * 1.4);
    this.t -= dt;
    switch (this.state) {
      case 'load':
        if (this.load < this.capacity && station.ore.count > 0) {
          if (this.t <= 0) {
            this.t = M.cartLoadInterval;
            station.ore.take();
            g.fx.fly(Geo.ore(), station.ore.source().setY(0.6), this.cart.position.clone().setY(1.2), { dur: 0.25, arc: 0.8 });
            this.load++;
            this.wait = 0;
          }
        } else if (this.load > 0) {
          this.wait += dt;
          if (this.load >= this.capacity || this.wait > 2.5) this.state = 'go';
        }
        break;
      case 'go':
        this.s = Math.min(this.total, this.s + this.speed * dt);
        if (this.s >= this.total) this.state = 'unload';
        break;
      case 'unload':
        if (this.t <= 0) {
          this.t = M.cartLoadInterval;
          if (this.load > 0 && smelter.space() > 0) {
            this.load--;
            smelter.reserve();
            g.fx.fly(Geo.ore(), this.cart.position.clone().setY(1.2), () => smelter.landing(), { dur: 0.25, arc: 0.8, done: () => smelter.receive() });
          } else if (this.load === 0) this.state = 'back';
        }
        break;
      case 'back':
        this.s = Math.max(0, this.s - this.speed * 1.3 * dt);
        if (this.s <= 0) this.state = 'load';
        break;
    }
    this.place();
  }
}
