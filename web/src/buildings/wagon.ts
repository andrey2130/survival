import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { ZoneDef } from '../config/layout';
import { Building } from './building';
import { Geo, mesh, makeShadow } from '../world/models';
import { angleLerp } from '../core/math';
import type { Game } from '../game';
import type { Port } from '../systems/storage';

const WG = BALANCE.wagon;

/** Where each wagon type loads and which buildings it supplies (first that needs goods wins). */
const ROUTES: Record<'log' | 'cooked', { source: string; targets: string[] }> = {
  log: { source: 'lumber_out', targets: ['counter', 'furnace'] },
  cooked: { source: 'kitchen_out', targets: ['meatstall', 'diner'] },
};

/**
 * Wagon: a pony cart that hauls goods in bulk between production and the stalls / furnace.
 * Bought once, then runs forever on its own.
 */
export class Wagon extends Building {
  private cart = new THREE.Group();
  private pony: THREE.Object3D;
  private loadMeshes: THREE.Mesh[] = [];
  private x: number;
  private z: number;
  private rot = 0;
  private path: { x: number; z: number }[] = [];
  private state: 'idle' | 'toSource' | 'load' | 'toTarget' | 'unload' = 'idle';
  private load = 0;
  private target: Port | null = null;
  private t = 0;
  private phase = 0;
  readonly item: 'log' | 'cooked';

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.workerBench());
    this.item = def.params?.item ?? 'log';
    this.x = def.x;
    this.z = def.z + 2;
    const body = mesh(Geo.cart());
    this.cart.add(body);
    this.pony = mesh(Geo.pony());
    this.pony.position.z = 1.9;
    this.cart.add(this.pony, makeShadow(2.4));
    const geo = this.item === 'log' ? Geo.log() : Geo.cooked();
    for (let i = 0; i < 8; i++) {
      const m = mesh(geo);
      m.position.set((i % 2) * 0.45 - 0.22, 1.15 + Math.floor(i / 2) * 0.28, 0);
      m.rotation.y = Math.PI / 2;
      m.visible = false;
      this.cart.add(m);
      this.loadMeshes.push(m);
    }
    game.scene.add(this.cart);
    game.fx.ring(this.x, this.z, 0xffe27a, 3);
  }

  private get route() { return ROUTES[this.item]; }

  private needy(): Port | null {
    for (const id of this.route.targets) {
      const p = this.game.port(id);
      if (p && p.store.space() > 0) return p;
    }
    return null;
  }

  private goTo(x: number, z: number) {
    this.path = this.game.nav.findPath(this.x, this.z, x, z, true) ?? [{ x, z }];
  }

  /** Move along the path; true when arrived. */
  private drive(dt: number) {
    if (!this.path.length) return true;
    const p = this.path[0];
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const step = WG.speed * dt;
    if (d <= step) { this.x = p.x; this.z = p.z; this.path.shift(); }
    else { this.x += (dx / d) * step; this.z += (dz / d) * step; }
    this.rot = angleLerp(this.rot, Math.atan2(dx, dz), Math.min(1, dt * 6));
    this.phase += dt * 10;
    return this.path.length === 0;
  }

  update(dt: number) {
    const g = this.game;
    const src = g.port(this.route.source);
    this.t -= dt;
    let moving = false;
    switch (this.state) {
      case 'idle':
        if (this.load > 0) { this.target = this.needy(); if (this.target) { this.state = 'toTarget'; this.goTo(this.target.x, this.target.z); } }
        else if (src && src.store.count > 0 && this.needy()) { this.state = 'toSource'; this.goTo(src.x, src.z); }
        break;
      case 'toSource':
        moving = true;
        if (this.drive(dt)) this.state = 'load';
        break;
      case 'load':
        if (!src) { this.state = 'idle'; break; }
        if (this.t > 0) break;
        this.t = WG.loadInterval;
        if (this.load < WG.capacity && src.store.count > 0) {
          const from = src.store.source().clone();
          src.store.take();
          this.load++;
          g.fx.fly(this.item === 'log' ? Geo.log() : Geo.cooked(), from, new THREE.Vector3(this.x, 1.4, this.z), { dur: 0.25, arc: 1 });
        } else this.state = 'idle';
        break;
      case 'toTarget':
        moving = true;
        if (this.drive(dt)) this.state = 'unload';
        break;
      case 'unload': {
        const tp = this.target;
        if (!tp || this.load <= 0) { this.state = 'idle'; break; }
        if (this.t > 0) break;
        this.t = WG.loadInterval;
        if (tp.store.space() <= 0) { this.state = 'idle'; break; }
        this.load--;
        tp.store.reserve();
        g.fx.fly(this.item === 'log' ? Geo.log() : Geo.cooked(), new THREE.Vector3(this.x, 1.4, this.z), () => tp.anchor ?? tp.store.landing(), { dur: 0.3, arc: 1.2, done: () => tp.store.receive() });
        break;
      }
    }
    this.cart.position.set(this.x, moving ? Math.abs(Math.sin(this.phase)) * 0.05 : 0, this.z);
    this.cart.rotation.y = this.rot;
    this.pony.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.12 : 0;
    const shown = Math.ceil((this.load / WG.capacity) * this.loadMeshes.length);
    this.loadMeshes.forEach((m, i) => { m.visible = i < shown; });
  }

  status() { return this.load > 0 ? `🛒${this.load}` : null; }
  statusAnchor() { return new THREE.Vector3(this.x, 3, this.z); }
}
