import * as THREE from 'three';
import { CAMP } from '../config/settlements';
import { res } from '../config/content';
import { Geo, mesh, makeShadow, COLORS } from '../world/models';
import { angleLerp } from '../core/math';
import type { Game } from '../game';
import type { Camp, Settlements } from './settlements';
import type { Port } from './storage';

const RT = CAMP.route;
export type RouteTier = { name: string; icon: string; cost: Record<string, number>; capacity?: number; speed?: number; flow?: number; road?: boolean };
export const ROUTE_TIERS = RT.tiers as RouteTier[];

/** Logs from a route go to the base's wood stores in priority order (furnace reserve, stall, lumber hut). */
export function baseLogPort(game: Game): Port | undefined {
  const L = game.logistics;
  const furnace = game.port('furnace'), counter = game.port('counter'), hut = game.port('lumber_in');
  if (furnace && L.furnaceShort()) return furnace;
  if (counter && L.counterShort()) return counter;
  if (hut && hut.store.space() > 0) return hut;
  if (counter && L.counterOpen()) return counter;
  if (furnace && furnace.store.space() > 0) return furnace;
  // base wood stores full: industry (sawmills, fire boxes, kiln) like the base lumberjacks' logs
  if (hut && L.industryAllowed('log')) { const p = L.logDrop(hut.x, hut.z); if (p && p.store.space() > 0 && L.isIndustryLogPort(p)) return p; }
  return undefined;
}

/** Can the base take one unit of this item from a route right now? */
export function baseAccepts(game: Game, item: string) {
  if (item === 'log') return !!baseLogPort(game);
  return !!game.port('warehouse');
}

/** Hand one unit to the base (route arrival). Returns false if nothing takes it. */
export function deliverToBase(game: Game, item: string, from?: THREE.Vector3): boolean {
  if (item === 'log') {
    const p = baseLogPort(game);
    if (!p) return false;
    if (p.id === 'counter') game.logistics.counterFed();
    // far-away industry stores are filled by the base's carters (no flying logs across the map)
    if (from && Math.hypot(p.x - from.x, p.z - from.z) < RT.unloadReach) { p.store.reserve(); game.fx.fly(Geo.log(), from, () => p.anchor ?? p.store.landing(), { dur: 0.35, arc: 1.4, done: () => p.store.receive() }); }
    else p.store.add(1);
    return true;
  }
  if (!game.port('warehouse')) return false;
  game.eco.add(item, 1);
  return true;
}

/**
 * Sled of a camp route: loads what the route rules allow at the camp depot, drives to the base's
 * lumber hut, hands logs to the wood stores and everything else to the Warehouse, drives back.
 */
export class Sled {
  private root = new THREE.Group();
  private animals: THREE.Object3D[] = [];
  private loadMeshes: THREE.Mesh[] = [];
  x: number;
  z: number;
  private rot = 0;
  private phase = 0;
  private path: { x: number; z: number }[] = [];
  state: 'load' | 'toBase' | 'unload' | 'toCamp' = 'load';
  load: Record<string, number> = {};
  private t = 0;
  private waitT = 0;
  private road: THREE.Mesh | null = null;

  constructor(private game: Game, private S: Settlements, private camp: Camp) {
    const d = S.depotPort(camp.chunk) ?? S.firePort(camp.chunk)!;
    this.x = d.x + 1.5;
    this.z = d.z + 1;
    this.root.add(mesh(Geo.cart()), makeShadow(2.4));
    for (let i = 0; i < 10; i++) {
      const m = mesh(Geo.log());
      m.position.set((i % 2) * 0.45 - 0.22, 1.15 + Math.floor(i / 2) * 0.28, 0);
      m.rotation.y = Math.PI / 2;
      m.visible = false;
      this.root.add(m);
      this.loadMeshes.push(m);
    }
    game.scene.add(this.root);
    this.refreshLook();
  }

  get tier() { return ROUTE_TIERS[this.camp.route.tier - 1]; }
  get carried() { return Object.values(this.load).reduce((a, b) => a + b, 0); }

  /** pony for the sled, a two-reindeer team on the road */
  refreshLook() {
    for (const a of this.animals) this.root.remove(a);
    this.animals = [];
    const n = this.tier?.road ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = mesh(Geo.pony());
      a.position.set(n > 1 ? (i - 0.5) * 0.9 : 0, 0, 1.9);
      this.root.add(a);
      this.animals.push(a);
    }
    if (this.tier?.road && !this.road) this.buildRoad();
  }

  /** A trodden snow road along the route (built with the reindeer team). */
  private buildRoad() {
    const hut = this.game.port('lumber_in'), d = this.S.depotPort(this.camp.chunk);
    if (!hut || !d) return;
    const pts = this.game.nav.findPath(d.x, d.z, hut.x, hut.z, true) ?? [{ x: hut.x, z: hut.z }];
    const all = [{ x: d.x, z: d.z }, ...pts];
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.1) continue;
      const g = new THREE.PlaneGeometry(2.2, len + 0.6);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(b.x - a.x, b.z - a.z));
      g.translate((a.x + b.x) / 2, 0.03, (a.z + b.z) / 2);
      geos.push(g);
    }
    if (!geos.length) return;
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (const g of geos) { const ng = g.toNonIndexed(); pos.push(...(ng.attributes.position.array as Float32Array)); }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.road = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: COLORS.dirt, transparent: true, opacity: 0.35, depthWrite: false }));
    this.road.renderOrder = 1;
    this.game.scene.add(this.road);
  }

  private goTo(x: number, z: number) { this.path = this.game.nav.findPath(this.x, this.z, x, z, true) ?? [{ x, z }]; }

  private drive(dt: number) {
    if (!this.path.length) return true;
    const p = this.path[0];
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const step = (this.tier?.speed ?? 3.6) * dt;
    if (d <= step) { this.x = p.x; this.z = p.z; this.path.shift(); }
    else { this.x += (dx / d) * step; this.z += (dz / d) * step; }
    this.rot = angleLerp(this.rot, Math.atan2(dx, dz), Math.min(1, dt * 6));
    this.phase += dt * 10;
    return this.path.length === 0;
  }

  update(dt: number) {
    const g = this.game, S = this.S, c = this.camp;
    this.t -= dt;
    let moving = false;
    const depot = S.depotPort(c.chunk);
    const hut = g.port('lumber_in') ?? g.port('furnace');
    switch (this.state) {
      case 'load': {
        if (!depot || !hut) break;
        if (Math.hypot(this.x - depot.x, this.z - depot.z) > 3) { this.goTo(depot.x + 1.5, depot.z + 1); this.state = 'toCamp'; break; }
        if (this.t > 0) break;
        this.t = RT.loadInterval;
        const cap = S.routeCapacity(c);
        const item = this.carried < cap ? S.nextToSend(c, (id) => baseAccepts(g, id)) : null;
        if (item && S.take(c, item, 1)) {
          this.load[item] = (this.load[item] ?? 0) + 1;
          if (item === 'log') g.fx.fly(Geo.log(), depot.store.source().clone(), new THREE.Vector3(this.x, 1.4, this.z), { dur: 0.25, arc: 1 });
          this.waitT = 0;
        } else if (this.carried >= cap || (this.carried > 0 && (this.waitT += RT.loadInterval) > 4)) {
          this.state = 'toBase';
          this.goTo(hut.x + 2.2, hut.z + 1.5);
        }
        break;
      }
      case 'toBase':
        moving = true;
        if (this.drive(dt)) { this.state = 'unload'; this.waitT = 0; }
        break;
      case 'unload': {
        if (this.t > 0) break;
        this.t = RT.loadInterval;
        const item = Object.keys(this.load).find((k) => this.load[k] > 0 && baseAccepts(g, k));
        if (item && deliverToBase(g, item, new THREE.Vector3(this.x, 1.4, this.z))) {
          this.load[item]--;
          if (!this.load[item]) delete this.load[item];
          S.delivered(c, item, 1);
          this.waitT = 0;
        } else if (!this.carried || (this.waitT += RT.loadInterval) > 20) {
          // base stores full: take the rest back home (it's unloaded into the depot again)
          if (depot) { this.state = 'toCamp'; this.goTo(depot.x + 1.5, depot.z + 1); }
        }
        break;
      }
      case 'toCamp':
        moving = true;
        if (this.drive(dt)) {
          for (const [k, n] of Object.entries(this.load)) S.add(c, k, n);
          this.load = {};
          this.state = 'load';
        }
        break;
    }
    this.root.position.set(this.x, moving ? Math.abs(Math.sin(this.phase)) * 0.05 : 0, this.z);
    this.root.rotation.y = this.rot;
    for (const a of this.animals) a.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.12 : 0;
    const shown = Math.ceil((this.carried / Math.max(1, S.routeCapacity(c))) * this.loadMeshes.length);
    this.loadMeshes.forEach((m, i) => { m.visible = i < shown; });
  }

  label(): string {
    const items = Object.entries(this.load).map(([k, n]) => `${res(k).icon}${n}`).join(' ');
    return `${this.tier?.icon ?? '🛷'} ${items || (this.state === 'load' ? 'loading' : '')}`;
  }
  get anchor() { return new THREE.Vector3(this.x, 2.8, this.z); }

  dispose() {
    this.game.scene.remove(this.root);
    if (this.road) this.game.scene.remove(this.road);
  }
}
