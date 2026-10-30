import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { ZoneDef } from '../config/layout';
import { Building } from './building';
import { Geo, COLORS, mesh } from '../world/models';
import { Pool } from '../core/pool';
import { events } from '../core/events';
import { angleLerp } from '../core/math';
import type { Game } from '../game';
import type { Enemy } from '../entities/enemy';

const T = BALANCE.towers;

interface Projectile { m: THREE.Mesh; target: Enemy | null; tx: number; tz: number; from: THREE.Vector3; t: number; dur: number; dmg: number; splash: number; kind: 'bolt' | 'shell' }

/** Shared projectile simulation (pooled bolts and cannon shells). */
export class Projectiles {
  private list: Projectile[] = [];
  private bolts: Pool<THREE.Mesh>;
  private shells: Pool<THREE.Mesh>;
  constructor(private game: Game) {
    const add = (m: THREE.Mesh) => game.scene.add(m);
    const rem = (m: THREE.Mesh) => game.scene.remove(m);
    this.bolts = new Pool(() => mesh(Geo.bolt()), add, rem).prewarm(10);
    this.shells = new Pool(() => mesh(Geo.shell()), add, rem).prewarm(4);
  }

  fire(kind: 'bolt' | 'shell', from: THREE.Vector3, target: Enemy, dmg: number, splash = 0) {
    const m = (kind === 'bolt' ? this.bolts : this.shells).get();
    m.position.copy(from);
    const d = Math.hypot(target.x - from.x, target.z - from.z);
    const speed = kind === 'bolt' ? T.ballista.boltSpeed : T.cannon.shellSpeed;
    this.list.push({ m, target, tx: target.x, tz: target.z, from: from.clone(), t: 0, dur: Math.max(0.12, d / speed), dmg, splash, kind });
  }

  update(dt: number) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.target?.alive) { p.tx = p.target.x; p.tz = p.target.z; }
      const k = Math.min(1, p.t / p.dur);
      const prev = p.m.position.clone();
      p.m.position.set(p.from.x + (p.tx - p.from.x) * k, p.from.y + (1.0 - p.from.y) * k + (p.kind === 'shell' ? Math.sin(k * Math.PI) * 4 : 0), p.from.z + (p.tz - p.from.z) * k);
      p.m.lookAt(p.m.position.clone().add(p.m.position.clone().sub(prev)));
      if (k < 1) continue;
      if (p.kind === 'bolt') {
        if (p.target?.alive) p.target.hit(p.dmg, p.from.x, p.from.z, 'tower');
        this.bolts.release(p.m);
      } else {
        for (const e of g.enemies) if (e.alive && (e.x - p.tx) ** 2 + (e.z - p.tz) ** 2 < p.splash ** 2) e.hit(p.dmg, p.tx, p.tz, 'tower');
        g.fx.burst(p.tx, 0.5, p.tz, COLORS.orange, 14, 6, 0.22);
        g.fx.burst(p.tx, 0.5, p.tz, 0x555555, 8, 3, 0.3);
        g.fx.ring(p.tx, p.tz, COLORS.orange, p.splash, 0.35);
        g.shake(0.2);
        events.emit('cannon:explode', { x: p.tx, z: p.tz });
        this.shells.release(p.m);
      }
      this.list.splice(i, 1);
    }
  }
}

/** Ballista or cannon tower: auto-targets the nearest enemy in range. */
export class Tower extends Building {
  private turret: THREE.Object3D;
  private cd = 0.5;
  private recoil = 0;
  readonly cannon: boolean;
  readonly rangeRing: THREE.Mesh;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.tower(), [2.4, 2.4]);
    this.cannon = def.kind === 'cannon';
    this.turret = mesh(this.cannon ? Geo.cannon() : Geo.ballista());
    this.turret.position.y = 3.5;
    this.root.add(this.turret);
    const ringGeo = new THREE.RingGeometry(0.97, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.rangeRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rangeRing.position.set(def.x, 0.06, def.z);
    game.scene.add(this.rangeRing);
  }

  get range() { return (this.cannon ? T.cannon.range : T.ballista.range) * this.game.up.towerRangeMult; }

  update(dt: number) {
    const g = this.game;
    this.rangeRing.scale.setScalar(this.range);
    (this.rangeRing.material as THREE.MeshBasicMaterial).opacity = g.waves.state === 'active' ? 0.35 : 0.12;
    this.cd -= dt * g.up.towerRateMult;
    const target = g.nearestEnemy(this.def.x, this.def.z, this.range);
    if (target) {
      const want = Math.atan2(target.x - this.def.x, target.z - this.def.z);
      this.turret.rotation.y = angleLerp(this.turret.rotation.y, want, Math.min(1, dt * 10));
      if (this.cd <= 0) {
        const C = this.cannon ? T.cannon : T.ballista;
        this.cd = C.interval;
        this.recoil = 0.2;
        const from = new THREE.Vector3(this.def.x, 4.0, this.def.z);
        if (this.cannon) g.projectiles.fire('shell', from, target, T.cannon.damage * g.up.towerDamageMult, T.cannon.splash);
        else g.projectiles.fire('bolt', from, target, T.ballista.damage * g.up.towerDamageMult);
        if (this.cannon) g.fx.burst(this.def.x, 4.3, this.def.z, 0xdddddd, 6, 2, 0.25, -1);
        events.emit('tower:fire', { x: this.def.x, z: this.def.z });
      }
    }
    if (this.recoil > 0) this.recoil -= dt;
    this.turret.position.z = 0;
    this.turret.scale.setScalar(1 + Math.max(0, this.recoil) * 0.8);
  }
}

/** Fire trap: burns enemies standing on it. */
export class FireTrap extends Building {
  private t = 0;
  private tick = 0;
  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.firetrap());
  }
  update(dt: number) {
    const g = this.game;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.06;
      const a = Math.random() * Math.PI * 2, r = Math.random() * T.fireTrap.radius * 0.8;
      g.fx.rise(this.def.x + Math.cos(a) * r, 0.3, this.def.z + Math.sin(a) * r, Math.random() < 0.6 ? COLORS.orange : COLORS.yellow, 0.3, 0.2);
    }
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.5;
      for (const e of g.enemies) {
        if (e.alive && !e.wild && (e.x - this.def.x) ** 2 + (e.z - this.def.z) ** 2 < T.fireTrap.radius ** 2) e.hit(T.fireTrap.dps * 0.5 * g.up.towerDamageMult, this.def.x, this.def.z, 'tower');
      }
    }
  }
}
