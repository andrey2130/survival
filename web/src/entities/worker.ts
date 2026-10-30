import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { MINE, SLOTS, type WorkerKind } from '../config/layout';
import { Walker } from './walker';
import { ResourceStack } from './stack';
import { COLORS } from '../world/models';
import { Bubble } from '../ui/bubbles';
import type { Game } from '../game';
import type { Damageable, Enemy } from './enemy';
import type { Tree } from '../world/trees';
import type { Port } from '../systems/storage';

const W = BALANCE.workers;

const LOOK: Record<WorkerKind, { shirt: number; hat: number; tool: 'axe' | 'spear' | 'pickaxe' | null }> = {
  lumberjack: { shirt: 0xb03a2e, hat: 0x2c3e50, tool: 'axe' },
  carrier: { shirt: 0x8d6e63, hat: 0xd35400, tool: null },
  hunter: { shirt: 0x4e7d3a, hat: 0x6d4c41, tool: 'spear' },
  cook: { shirt: 0xf5f5f5, hat: 0xffffff, tool: null },
  cashier: { shirt: 0xe6b422, hat: 0x27ae60, tool: null },
  miner: { shirt: 0xe67e22, hat: 0xf1c40f, tool: 'pickaxe' },
  guard: { shirt: 0x546e8a, hat: 0x95a5a6, tool: 'spear' },
};

/** WorkerAI — every automation role is a small state machine on top of Walker. */
export class Worker extends Walker implements Damageable {
  readonly stack: ResourceStack;
  hp: number;
  alive = true;
  private downT = 0;
  private state = 'start';
  private t = 0;
  private tree: Tree | null = null;
  private prey: Enemy | null = null;
  private rockHits = 0;
  private patrolI = 0;
  private bubble: Bubble;

  constructor(game: Game, readonly kind: WorkerKind, readonly home: { x: number; z: number }) {
    super(game, home.x, home.z, LOOK[kind].shirt, LOOK[kind].hat, LOOK[kind].tool);
    this.stack = new ResourceStack(this.char.root, W.capacity, -0.5, 0.8);
    this.hp = this.maxHp;
    this.bubble = new Bubble(this.char.root, 2.9);
    game.fx.ring(home.x, home.z, 0xffe27a, 2.5);
  }

  get maxHp() { return this.kind === 'guard' ? W.guardHp * this.game.up.guardMult : W.guardHp * 0.8; }
  get combatant() { return this.kind === 'guard' || this.kind === 'hunter'; }

  hit(dmg: number) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.game.fx.burst(this.x, 1.2, this.z, COLORS.red, 5, 3);
    if (this.hp <= 0) {
      this.alive = false;
      this.downT = W.guardRespawn;
      this.stack.clear();
      this.stop();
      if (this.tree) { this.tree.reservedBy = null; this.tree = null; }
    }
  }

  update(dt: number) {
    const g = this.game;
    this.speed = g.up.workerSpeed;
    this.stack.cap = g.up.workerCap;
    if (!this.alive) {
      this.downT -= dt;
      this.char.root.rotation.x = Math.min(Math.PI / 2, this.char.root.rotation.x + dt * 6);
      this.bubble.set('zzz');
      if (this.downT <= 0) {
        this.alive = true;
        this.hp = this.maxHp;
        this.x = this.home.x; this.z = this.home.z;
        this.char.root.rotation.x = 0;
        this.state = 'start';
        this.bubble.set(null);
      }
      this.char.root.position.set(this.x, 0, this.z);
      return;
    }
    this.t -= dt;
    if (this.swing > 0) { this.swing += dt / 0.3; if (this.swing >= 1) this.swing = 0; }
    switch (this.kind) {
      case 'lumberjack': this.lumberjack(dt); break;
      case 'carrier': this.carrier(dt); break;
      case 'hunter': this.hunter(dt); break;
      case 'cook': this.cook(dt); break;
      case 'cashier': this.cashier(dt); break;
      case 'miner': this.miner(dt); break;
      case 'guard': this.guard(dt); break;
    }
    if (this.kind === 'guard' && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 2);
    this.stack.update(dt, this.moving ? this.speed : 0, 0);
    this.sync(dt);
  }

  // ---------------------------------------------------------------- helpers
  /** Walk into a port and drop matching items one by one. Returns true when nothing is left to drop. */
  private unloadAt(port: Port | undefined, dt: number): boolean {
    if (!port) return true;
    if (this.distTo(port.x, port.z) > port.r * 0.8) { this.goTo(port.x, port.z); this.walk(dt); return false; }
    this.stop();
    if (this.t > 0) return false;
    this.t = 0.12;
    if (!this.stack.has(port.store.type)) return true;
    if (port.store.space() <= 0) return false;
    this.game.transferToPort(this.stack, port);
    return false;
  }

  private loadAt(port: Port | undefined, dt: number, max: number): boolean {
    if (!port) return true;
    if (this.distTo(port.x, port.z) > port.r * 0.8) { this.goTo(port.x, port.z); this.walk(dt); return false; }
    this.stop();
    if (this.t > 0) return false;
    this.t = 0.12;
    if (this.stack.full || port.store.count <= 0 || this.stack.size >= max) return true;
    this.game.takeFromPort(port, this.stack);
    return false;
  }

  private idleAt(x: number, z: number, dt: number) {
    if (this.distTo(x, z) > 0.6) { this.goTo(x, z); this.walk(dt); }
    else { this.stop(); this.moving = false; }
  }

  private strike(target: { x: number; z: number }, dt: number) {
    this.face(target.x, target.z, dt);
    if (this.swing === 0) this.swing = 0.001;
  }

  // ---------------------------------------------------------------- roles
  private lumberjack(dt: number) {
    const g = this.game;
    if (this.state === 'start' || this.state === 'find') {
      if (this.stack.full) { this.state = 'deliver'; return; }
      this.tree = g.trees.nearestGrown(this.x, this.z, 70, (r) => g.world.isOpen(r), false, this);
      if (!this.tree) { if (this.stack.size) this.state = 'deliver'; else this.idleAt(this.home.x, this.home.z, dt); return; }
      this.tree.reservedBy = this;
      this.state = 'walk';
      const d = Math.hypot(this.tree.x - this.x, this.tree.z - this.z) || 1;
      this.goTo(this.tree.x + ((this.x - this.tree.x) / d) * 1.3, this.tree.z + ((this.z - this.tree.z) / d) * 1.3);
    }
    if (this.state === 'walk') {
      if (!this.tree || !this.tree.grown) { this.state = 'find'; return; }
      if (!this.walk(dt)) this.state = 'chop';
    }
    if (this.state === 'chop') {
      const t = this.tree;
      if (!t || !t.grown) { this.state = this.stack.full ? 'deliver' : 'find'; return; }
      this.strike(t, dt);
      if (this.t <= 0) {
        this.t = W.chopInterval;
        this.swing = 0.001;
        const logs = g.trees.hit(t, W.lumberjackDamage, this.x, this.z);
        g.fx.burst(t.x, 1.1, t.z, COLORS.woodLight, 4, 3, 0.12);
        if (logs > 0) {
          g.spawnLogsFromTree(t.x, t.z, logs, this);
          this.tree = null;
          this.state = this.stack.space() <= 0 ? 'deliver' : 'find';
        }
      }
    }
    if (this.state === 'deliver') {
      if (this.unloadAt(g.port('lumber_in'), dt)) this.state = 'find';
      else if (g.port('lumber_in')?.store.space() === 0 && this.arrived) this.bubble.set('zzz');
      else this.bubble.set(null);
    }
  }

  private carrier(dt: number) {
    const g = this.game;
    const hut = g.port('lumber_out');
    const furnace = g.port('furnace');
    const counter = g.port('counter');
    if (!hut || !furnace || !counter) return;
    if (this.state === 'start' || this.state === 'decide') {
      if (this.stack.size) { this.state = 'deliver'; return; }
      const need = (furnace.store.space() > 0 && g.heat < 80) || counter.store.space() > 0 || furnace.store.space() > 0;
      if (hut.store.count > 0 && need) this.state = 'load';
      else this.idleAt(this.home.x, this.home.z, dt);
    }
    if (this.state === 'load') {
      if (this.loadAt(hut, dt, this.stack.cap)) this.state = this.stack.size ? 'deliver' : 'decide';
    }
    if (this.state === 'deliver') {
      // furnace first when it's getting cold, else the stall, else stock the furnace
      const target = g.heat < 60 && furnace.store.space() > 0 ? furnace : counter.store.space() > 0 ? counter : furnace;
      if (this.unloadAt(target, dt) || (target.store.space() === 0 && this.arrived)) {
        if (!this.stack.size) this.state = 'decide';
        else if (furnace.store.space() === 0 && counter.store.space() === 0) this.state = 'decide';
      }
    }
  }

  private hunter(dt: number) {
    const g = this.game;
    if (this.stack.full || (this.state === 'deliver' && this.stack.has('meat'))) {
      this.state = 'deliver';
      if (this.unloadAt(g.port('kitchen'), dt)) this.state = 'hunt';
      return;
    }
    this.state = 'hunt';
    if (!this.prey || !this.prey.alive) this.prey = g.nearestEnemy(this.x, this.z, 45, (e) => !g.palisade.inside(e.x, e.z));
    const meat = g.pickups.nearest(this.x, this.z, 14, 'meat');
    if (this.prey) {
      const d = this.distTo(this.prey.x, this.prey.z);
      if (d > W.hunterRange) {
        if (this.t <= 0 || this.arrived) { this.t = 0.6; this.goTo(this.prey.x, this.prey.z); }
        this.walk(dt);
      } else {
        this.stop();
        this.strike(this.prey, dt);
        if (this.t <= 0) {
          this.t = W.hunterInterval;
          this.swing = 0.001;
          this.prey.hit(W.hunterDamage * g.up.guardMult, this.x, this.z, 'worker', this);
        }
      }
    } else if (meat) {
      if (this.distTo(meat.x, meat.z) > 0.8) { this.goTo(meat.x, meat.z); this.walk(dt); }
    } else if (this.stack.has('meat')) this.state = 'deliver';
    else this.idleAt(this.home.x, this.home.z, dt);
    g.pickups.collect(this.x, this.z, this.stack, 'meat');
  }

  private cook(dt: number) {
    const g = this.game;
    const kitchen = g.kitchen;
    if (kitchen) kitchen.cook = true;
    const out = g.port('kitchen_out');
    const diner = g.port('diner');
    if (!out || !diner) { this.idleAt(this.home.x, this.home.z, dt); return; }
    if (this.state === 'start' || this.state === 'wait') {
      if (this.stack.size) this.state = 'deliver';
      else if (out.store.count > 0 && diner.store.space() > 0) this.state = 'load';
      else this.idleAt(this.home.x, this.home.z, dt);
    }
    if (this.state === 'load' && this.loadAt(out, dt, Math.min(this.stack.cap, diner.store.space()))) this.state = this.stack.size ? 'deliver' : 'wait';
    if (this.state === 'deliver' && (this.unloadAt(diner, dt) || (diner.store.space() === 0 && this.arrived))) this.state = this.stack.size ? 'deliver' : 'wait';
  }

  private cashier(dt: number) {
    const g = this.game;
    g.counter.cashier = true;
    this.idleAt(SLOTS.counterServe.x + 1.3, SLOTS.counterServe.z - 0.4, dt);
    if (!this.moving) this.face(g.counter.def.x, g.counter.def.z + 3, dt);
  }

  private miner(dt: number) {
    const g = this.game;
    const station = g.port('minestation');
    if (this.stack.full || this.state === 'deliver') {
      this.state = 'deliver';
      if (this.unloadAt(station, dt)) this.state = 'mine';
      return;
    }
    const spot = { x: MINE.rock.x - 1.6, z: MINE.rock.z + 2.6 };
    if (this.distTo(spot.x, spot.z) > 0.6) { this.goTo(spot.x, spot.z); this.walk(dt); return; }
    this.stop();
    this.strike(MINE.rock, dt);
    if (this.t <= 0) {
      this.t = W.minerInterval;
      this.swing = 0.001;
      g.fx.burst(MINE.rock.x - 0.8, 1.4, MINE.rock.z + 1.6, COLORS.gold, 4, 3, 0.12);
      if (++this.rockHits >= BALANCE.goldRock.hits) {
        this.rockHits = 0;
        g.giveItemTo(this.stack, 'ore', new THREE.Vector3(MINE.rock.x, 2, MINE.rock.z + 1.5));
      }
    }
  }

  private guard(dt: number) {
    const g = this.game;
    const H = BALANCE.palisade.halfSize;
    if (!this.prey || !this.prey.alive || this.distTo(this.prey.x, this.prey.z) > W.guardAggroRadius * 1.5) {
      this.prey = g.nearestEnemy(this.x, this.z, W.guardAggroRadius, (e) => Math.abs(e.x) < H + 6 && Math.abs(e.z) < H + 6);
    }
    if (this.prey) {
      const d = this.distTo(this.prey.x, this.prey.z);
      if (d > W.hunterRange) {
        if (this.t <= 0 || this.arrived) { this.t = 0.5; this.goTo(this.prey.x, this.prey.z); }
        this.walk(dt);
      } else {
        this.stop();
        this.strike(this.prey, dt);
        if (this.t <= 0) {
          this.t = W.guardInterval;
          this.swing = 0.001;
          this.prey.hit(W.guardDamage * g.up.guardMult, this.x, this.z, 'worker', this);
        }
      }
      return;
    }
    // patrol the inner side of the wall
    const pts = [[H - 2.5, H - 2.5], [H - 2.5, -H + 2.5], [-H + 2.5, -H + 2.5], [-H + 2.5, H - 2.5]];
    const p = pts[this.patrolI % 4];
    if (this.distTo(p[0], p[1]) < 0.8) this.patrolI++;
    else { this.goTo(p[0], p[1]); this.walk(dt); }
  }
}
