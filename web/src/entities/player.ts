import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { MINE } from '../config/layout';
import { makeHuman, animateHuman, type Character, COLORS } from '../world/models';
import { ResourceStack } from './stack';
import { events } from '../core/events';
import { angleLerp, clamp } from '../core/math';
import type { Game } from '../game';
import type { Tree } from '../world/trees';
import type { Enemy } from './enemy';

const P = BALANCE.player;

type Target = { kind: 'enemy'; e: Enemy } | { kind: 'tree'; t: Tree } | { kind: 'rock' };

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
  private attackCd = 0;
  private swing = 0; // 0 = idle, else progress 0..1
  private swingTarget: Target | null = null;
  private hitApplied = false;
  private lastHit = -99;
  private rockHits = 0;
  readonly hpBarAnchor = new THREE.Vector3();

  constructor(private game: Game) {
    this.char = makeHuman(COLORS.blue, COLORS.red, 'axe', 1.05);
    this.stack = new ResourceStack(this.char.root, P.stackCap, -0.5, 0.85);
    game.scene.add(this.char.root);
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
      this.swing = 0;
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

    // ---- auto actions ----
    this.attackCd -= dt * (this.moving ? P.attackWhileMovingMult : 1);
    if (this.swing > 0) this.updateSwing(dt);
    else if (this.attackCd <= 0) {
      const target = this.findTarget();
      if (target) {
        this.swingTarget = target;
        this.swing = 0.001;
        this.hitApplied = false;
        this.attackCd = g.up.attackInterval;
        events.emit('player:attack', { target: target.kind });
      }
    }
    if (this.swing > 0 && this.swingTarget && !this.moving) {
      const p = this.targetPos(this.swingTarget);
      this.facing = angleLerp(this.facing, Math.atan2(p.x - this.x, p.z - this.z), Math.min(1, dt * 16));
    }

    root.position.set(this.x, 0, this.z);
    root.rotation.y = this.facing;
    animateHuman(this.char, dt, Math.min(1, this.speed01), this.swing);
    const cos = Math.cos(this.facing), sin = Math.sin(this.facing);
    this.stack.update(dt, this.vx * sin + this.vz * cos, this.vx * cos - this.vz * sin);
    this.hpBarAnchor.set(this.x, 2.6, this.z);
  }

  private move(dx: number, dz: number) {
    const nav = this.game.nav;
    const r = P.radius;
    if (nav.walkableR(this.x + dx, this.z, r)) this.x += dx;
    if (nav.walkableR(this.x, this.z + dz, r)) this.z += dz;
    const p = this.game.world.pushOut(this.x, this.z, r);
    if (nav.walkableR(p.x, p.z, r)) { this.x = p.x; this.z = p.z; }
  }

  private targetPos(t: Target) {
    if (t.kind === 'enemy') return { x: t.e.x, z: t.e.z };
    if (t.kind === 'tree') return { x: t.t.x, z: t.t.z };
    return MINE.rock;
  }

  private findTarget(): Target | null {
    const g = this.game;
    const e = g.nearestEnemy(this.x, this.z, P.attackRangeEnemy);
    if (e) return { kind: 'enemy', e };
    if (this.moving && !P.chopWhileMoving) return null;
    if (this.stack.full) return null;
    const t = g.trees.nearestGrown(this.x, this.z, P.attackRangeTree, (r) => g.world.isOpen(r), true);
    if (t) return { kind: 'tree', t };
    if (g.world.isOpen('north') && (this.x - MINE.rock.x) ** 2 + (this.z - MINE.rock.z) ** 2 < 3.6 ** 2) return { kind: 'rock' };
    return null;
  }

  private updateSwing(dt: number) {
    const g = this.game;
    this.swing += dt / 0.28;
    if (!this.hitApplied && this.swing >= 0.45 && this.swingTarget) {
      this.hitApplied = true;
      const t = this.swingTarget;
      const dmgMult = g.up.damageMult;
      if (t.kind === 'enemy') {
        if (t.e.alive && (t.e.x - this.x) ** 2 + (t.e.z - this.z) ** 2 < (P.attackRangeEnemy + 0.8) ** 2) {
          t.e.hit(P.axeDamageEnemy * dmgMult, this.x, this.z, 'player');
        }
      } else if (t.kind === 'tree') {
        const logs = g.trees.hit(t.t, P.axeDamageTree * dmgMult, this.x, this.z);
        g.fx.burst(t.t.x, 1.1, t.t.z, COLORS.woodLight, 6, 3.5, 0.13);
        g.fx.burst(t.t.x, 2.2, t.t.z, COLORS.snow, 5, 2.5, 0.16);
        g.haptic('light');
        if (logs > 0) g.spawnLogsFromTree(t.t.x, t.t.z, logs, this);
      } else {
        events.emit('rock:hit', MINE.rock);
        g.fx.burst(MINE.rock.x, 1.6, MINE.rock.z + 1.5, COLORS.gold, 6, 3.5, 0.13);
        g.haptic('light');
        if (++this.rockHits >= BALANCE.goldRock.hits) {
          this.rockHits = 0;
          g.giveItemTo(this.stack, 'ore', new THREE.Vector3(MINE.rock.x, 2, MINE.rock.z + 1.5));
        }
      }
    }
    if (this.swing >= 1) { this.swing = 0; this.swingTarget = null; }
  }

  serialize() { return { x: this.x, z: this.z, hp: this.hp, stack: this.stack.slots.map((s) => s.type) }; }
}
