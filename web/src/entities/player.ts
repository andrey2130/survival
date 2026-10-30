import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { MINE } from '../config/layout';
import { makeHuman, animateHuman, type Character, COLORS, Geo, mesh } from '../world/models';
import { ResourceStack } from './stack';
import { events } from '../core/events';
import { angleLerp, clamp } from '../core/math';
import type { Game } from '../game';

const P = BALANCE.player;


/** PlayerController — movement, auto-attack / auto-chop by proximity, HP & knockout. */
export class Player {
  readonly char: Character;
  readonly stack: ResourceStack;
  x = P.respawn.x;
  z = P.respawn.z;
  facing = Math.PI;
  speed01 = 0;
  hp = P.hp;
  ko = 0;
  moving = false;
  private vx = 0;
  private vz = 0;
  /** Spinning axes orbiting the hero — they hit whatever they sweep over. */
  private orbit = new THREE.Group();
  private trail: THREE.Mesh;
  private spin = 0;
  private hitCd = new Map<object, number>();
  private lastHit = -99;
  private rockHits = 0;
  readonly hpBarAnchor = new THREE.Vector3();

  constructor(private game: Game) {
    this.char = makeHuman(COLORS.blue, COLORS.red, null, 1.05);
    this.stack = new ResourceStack(this.char.root, P.stackCap, -0.5, 0.85);
    game.scene.add(this.char.root);
    for (let i = 0; i < P.orbitAxes; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / P.orbitAxes) * Math.PI * 2;
      const axe = mesh(Geo.spinAxe());
      axe.position.set(P.orbitRadius, 1.0, 0);
      pivot.add(axe);
      this.orbit.add(pivot);
    }
    const ringGeo = new THREE.RingGeometry(P.orbitRadius - 0.35, P.orbitRadius + 0.35, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.trail = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    this.trail.position.y = 0.06;
    this.trail.renderOrder = 2;
    this.orbit.add(this.trail);
    game.scene.add(this.orbit);
    this.char.root.position.set(this.x, 0, this.z);
  }

  get maxHp() { return this.game.up.maxHp; }
  get alive() { return this.ko <= 0; }

  hit(dmg: number) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.lastHit = this.game.time;
    events.emit('player:hit', { dmg });
    this.game.fx.burst(this.x, 1.2, this.z, COLORS.red, 6, 3);
    this.game.shake(0.25);
    if (this.hp <= 0) {
      this.hp = 0;
      this.ko = P.knockoutSeconds;
      this.stack.clear(); // the stack is lost
      events.emit('player:ko', {});
    }
  }

  update(dt: number, camYaw: number) {
    const g = this.game;
    this.stack.cap = g.up.stackCap;
    const root = this.char.root;

    if (this.ko > 0) {
      this.ko -= dt;
      root.rotation.x = Math.min(Math.PI / 2, root.rotation.x + dt * 6);
      if (this.ko <= 0) {
        this.x = P.respawn.x; this.z = P.respawn.z;
        this.hp = this.maxHp;
        root.rotation.x = 0;
        g.fx.ring(this.x, this.z, 0x9fd8ff, 2.5);
      }
      root.position.set(this.x, 0, this.z);
      this.orbit.visible = false;
      return;
    }

    // ---- movement (joystick is screen-space; rotate by camera yaw) ----
    const inp = g.input.read();
    const mag = Math.min(1, Math.hypot(inp.x, inp.y));
    const speed = g.up.moveSpeed;
    let tvx = 0, tvz = 0;
    if (mag > 0.01) {
      // screen up = away from camera
      const c = Math.cos(camYaw), s = Math.sin(camYaw);
      const fx = -s, fz = -c; // forward
      const rx = c, rz = -s; // right
      tvx = (rx * inp.x + fx * -inp.y) * speed;
      tvz = (rz * inp.x + fz * -inp.y) * speed;
    }
    const acc = Math.min(1, dt * 14);
    this.vx += (tvx - this.vx) * acc;
    this.vz += (tvz - this.vz) * acc;
    this.moving = Math.hypot(this.vx, this.vz) > 0.6;
    this.move(this.vx * dt, this.vz * dt);
    this.speed01 = clamp(Math.hypot(this.vx, this.vz) / P.speed, 0, 1.3);
    if (this.moving) this.facing = angleLerp(this.facing, Math.atan2(this.vx, this.vz), Math.min(1, dt * 14));

    // ---- regen ----
    if (g.time - this.lastHit > P.regenDelay) this.hp = Math.min(this.maxHp, this.hp + P.regenPerSec * dt);
    this.hp = Math.min(this.hp, this.maxHp);

    // ---- spinning axes: hit everything they sweep over ----
    this.updateOrbit(dt);

    root.position.set(this.x, 0, this.z);
    root.rotation.y = this.facing;
    animateHuman(this.char, dt, Math.min(1, this.speed01), 0);
    const cos = Math.cos(this.facing), sin = Math.sin(this.facing);
    this.stack.update(dt, this.vx * sin + this.vz * cos, this.vx * cos - this.vz * sin);
    this.hpBarAnchor.set(this.x, 2.6, this.z);
  }

  /** If something got built on top of the hero (tower, wall...), step out to the nearest free spot. */
  private unstick() {
    const nav = this.game.nav;
    const r = P.radius;
    if (nav.walkableR(this.x, this.z, r)) return;
    for (let ring = 1; ring <= 24; ring++) {
      const d = ring * 0.25;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = this.x + Math.cos(a) * d, z = this.z + Math.sin(a) * d;
        if (nav.walkableR(x, z, r)) { this.x = x; this.z = z; return; }
      }
    }
  }

  private move(dx: number, dz: number) {
    this.unstick();
    const nav = this.game.nav;
    const r = P.radius;
    if (nav.walkableR(this.x + dx, this.z, r)) this.x += dx;
    if (nav.walkableR(this.x, this.z + dz, r)) this.z += dz;
    const p = this.game.world.pushOut(this.x, this.z, r);
    if (nav.walkableR(p.x, p.z, r)) { this.x = p.x; this.z = p.z; }
  }

  /** Angle (world, around Y) between an axe and a point — true when the axe is sweeping over it. */
  private swept(tx: number, tz: number, axeAngles: number[]) {
    const a = Math.atan2(tz - this.z, tx - this.x);
    for (const b of axeAngles) {
      let d = Math.abs(a - b) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 0.45) return true;
    }
    return false;
  }

  private ready(target: object, cd: number) {
    if ((this.hitCd.get(target) ?? 0) > this.game.time) return false;
    this.hitCd.set(target, this.game.time + cd);
    return true;
  }

  private updateOrbit(dt: number) {
    const g = this.game;
    const speedMult = g.up.attackSpeedMult;
    this.spin += P.orbitSpeed * speedMult * (this.moving ? 0.8 : 1) * dt;
    this.orbit.visible = true;
    this.orbit.position.set(this.x, 0, this.z);
    this.orbit.rotation.y = this.spin;
    // world angle of each axe in the XZ plane (rotation.y is clockwise seen from above)
    const angles: number[] = [];
    for (let i = 0; i < P.orbitAxes; i++) angles.push(-(this.spin + (i / P.orbitAxes) * Math.PI * 2));
    if (this.hitCd.size > 64) for (const [k, t] of this.hitCd) if (t < g.time) this.hitCd.delete(k);
    const cd = g.up.attackInterval * (this.moving ? 1 / P.attackWhileMovingMult : 1);
    const reach = P.orbitRadius + 0.6;
    const dmgMult = g.up.damageMult;

    for (const e of g.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - this.x, e.z - this.z);
      if (d > reach + e.radius || !this.swept(e.x, e.z, angles) || !this.ready(e, cd)) continue;
      e.hit(P.axeDamageEnemy * dmgMult, this.x, this.z, 'player');
      g.fx.burst(e.x, 1.3, e.z, 0xffffff, 4, 3, 0.14);
    }

    if (this.moving && !P.chopWhileMoving) return;
    if (!this.stack.full) {
      for (const t of g.trees.list) {
        if (!t.grown || t.growAnim < 0.9) continue;
        const dx = t.x - this.x, dz = t.z - this.z;
        if (dx * dx + dz * dz > reach * reach || !g.world.isOpen(t.region)) continue;
        if (!this.swept(t.x, t.z, angles) || !this.ready(t, cd)) continue;
        const logs = g.trees.hit(t, P.axeDamageTree * dmgMult, this.x, this.z);
        g.fx.burst(t.x, 1.1, t.z, COLORS.woodLight, 6, 3.5, 0.13);
        g.fx.burst(t.x, 2.2, t.z, COLORS.snow, 5, 2.5, 0.16);
        g.haptic('light');
        if (logs > 0) g.spawnLogsFromTree(t.x, t.z, logs, this);
      }
      const r = MINE.rock;
      if (g.world.isOpen('north') && Math.hypot(r.x - this.x, r.z - this.z) < reach + 2.2 && this.swept(r.x, r.z, angles) && this.ready(MINE, cd)) {
        events.emit('rock:hit', r);
        g.fx.burst(r.x, 1.6, r.z + 1.5, COLORS.gold, 6, 3.5, 0.13);
        g.haptic('light');
        if (++this.rockHits >= BALANCE.goldRock.hits) {
          this.rockHits = 0;
          g.giveItemTo(this.stack, 'ore', new THREE.Vector3(r.x, 2, r.z + 1.5));
        }
      }
    }
  }

  serialize() { return { x: this.x, z: this.z, hp: this.hp, stack: this.stack.slots.map((s) => s.type) }; }
}
