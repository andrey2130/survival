import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { Geo, shadowProxy, itemGeo, COLORS } from '../world/models';
import { Batcher, BATCH } from '../world/batcher';
import { events } from '../core/events';
import { angleLerp, rand } from '../core/math';
import type { Game } from '../game';
import type { Segment } from '../world/palisade';

export type EnemyKind = 'bear' | 'mother' | 'cub' | 'alpha' | 'wolf' | 'walrus' | 'seal' | 'orca' | 'bat' | 'troll' | 'golem';
/** Model / pool an enemy kind uses (bears of every size share one mesh). */
export type EnemyModel = 'bear' | 'wolf' | 'walrus' | 'seal' | 'orca' | 'bat' | 'troll' | 'golem';
export const modelOf = (k: EnemyKind): EnemyModel => (k === 'mother' || k === 'cub' || k === 'alpha' ? 'bear' : k);
interface EnemyStats { hide?: number; hp: number; damage: number; speed: number; attackInterval: number; radius: number; meat: number; gold: number; scale: number; drop?: string; wallMult?: number }
const E = BALANCE.enemies as unknown as Record<EnemyKind, EnemyStats> & { alphaCharge: typeof BALANCE.enemies.alphaCharge; aggroPlayerRadius: number };

/** Anything enemies can hurt (player, survivors, guards, hunters). */
export interface Damageable {
  x: number;
  z: number;
  alive: boolean;
  hit(dmg: number, fromX?: number, fromZ?: number): void;
}

type State = 'walk' | 'attack' | 'telegraph' | 'dash' | 'dying';

/** EnemyAI — bears/wolves. Priority: palisade → survivors → player (player only when adjacent). */
export class Enemy {
  readonly root = new THREE.Group();
  private model = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  /** per-instance colour of every body part (coat tint, red hit flash) */
  private tint = new THREE.Color(1, 1, 1);
  private coat = new THREE.Color(1, 1, 1);
  kind: EnemyKind = 'bear';
  x = 0;
  z = 0;
  rot = 0;
  hp = 1;
  maxHp = 1;
  dmg = 1;
  speed = 1;
  radius = 0.8;
  wild = false; // roaming hunting-ground animal (not part of a wave)
  /** orca under the ice: invisible and can't be hit */
  submerged = false;
  /** seal thief: fish carried away from the smokehouse */
  carrying = 0;
  /** orca: height of the body (negative = under the ice) */
  rise = 0;
  /** golem: colour of the glowing cracks (driven by the mine system) */
  readonly glow = new THREE.Color(0.3, 0.15, 0.05);
  private wings: THREE.Object3D | null = null;
  /** seconds left on fire (flame towers) / slowed (ice towers) */
  burnT = 0;
  slowT = 0;
  private burnTick = 0;
  /** ice bats fly: no walls, no nav grid */
  get flying() { return this.kind === 'bat'; }
  home = { x: 0, z: 0 };
  aggro: Damageable | null = null;
  aggroT = 0;
  private state: State = 'walk';
  private atkCd = 0;
  private stateT = 0;
  private wall: Segment | null = null;
  private victim: Damageable | null = null;
  private retarget = 0;
  private goal = { x: 0, z: 0 };
  private phase = Math.random() * 6;
  private flash = 0;
  private lunge = 0;
  private stuck = 0;
  private dashDir = { x: 0, z: 0 };
  private chargeCd = 2;
  private telegraph: THREE.Mesh | null = null;
  private dashHitDone = false;
  private pendingHit: (() => void) | null = null;
  private pendingT = 0;
  readonly hpAnchor = new THREE.Vector3();
  showBar = 0;

  constructor(private game: Game, readonly modelKind: EnemyModel) {
    const wolfModel = modelKind === 'wolf';
    const geo = { bear: Geo.bear(true), wolf: Geo.wolf(), walrus: Geo.walrus(), seal: Geo.seal(), orca: Geo.orca(), bat: Geo.bat(), troll: Geo.troll(), golem: Geo.golem() }[modelKind];
    this.model.add(Batcher.proxy(geo, this.tint, undefined, true));
    if (modelKind === 'bat') { this.wings = Batcher.proxy(Geo.batWing(), this.tint, undefined, true); this.wings.position.y = 0.05; this.model.add(this.wings); }
    if (modelKind === 'golem') this.model.add(Batcher.proxy(Geo.golemCracks(), this.glow));
    if (modelKind === 'bear' || wolfModel || modelKind === 'troll') {
      const legGeo = wolfModel ? Geo.wolfLeg() : modelKind === 'troll' ? Geo.trollLeg() : Geo.bearLeg(true);
      const lp = wolfModel ? [[0.2, 0.55, 0.45], [-0.2, 0.55, 0.45], [0.2, 0.55, -0.45], [-0.2, 0.55, -0.45]]
        : modelKind === 'troll' ? [[0.4, 0.85, 0], [-0.4, 0.85, 0]]
        : [[0.35, 0.62, 0.55], [-0.35, 0.62, 0.55], [0.35, 0.62, -0.55], [-0.35, 0.62, -0.55]];
      for (const [x, y, z] of lp) {
        const l = Batcher.proxy(legGeo, this.tint, undefined, true);
        l.position.set(x, y, z);
        this.legs.push(l);
        this.model.add(l);
      }
    }
    this.root.add(this.model);
    BATCH.register(this.root);
    this.root.add(shadowProxy({ bear: 2.2, wolf: 1.6, walrus: 2.6, seal: 1.6, orca: 4.5, bat: 0.7, troll: 2.6, golem: 4.2 }[modelKind]));
  }

  get alive() { return this.state !== 'dying'; }

  /** Remove quietly (no loot) — e.g. the orca giving up when the hero leaves the ice. */
  despawn() {
    this.clearTelegraph();
    this.state = 'dying';
    this.stateT = 1.5;
    this.root.visible = false;
  }

  spawn(kind: EnemyKind, x: number, z: number, hpScale: number, wild = false) {
    const d = E[kind];
    this.kind = kind;
    this.x = x; this.z = z;
    this.maxHp = this.hp = Math.round(d.hp * hpScale);
    this.dmg = d.damage * (wild ? 1 : Math.sqrt(hpScale));
    this.speed = d.speed * rand(0.92, 1.08);
    this.radius = d.radius;
    this.wild = wild;
    this.home = { x, z };
    this.aggro = null;
    this.state = 'walk';
    this.atkCd = rand(0, 0.5);
    this.stateT = 0;
    this.wall = null;
    this.victim = null;
    this.retarget = 0;
    this.goal = { x, z };
    this.flash = 0;
    this.showBar = 0;
    this.chargeCd = 2;
    this.pendingHit = null;
    this.submerged = false;
    this.burnT = 0;
    this.slowT = 0;
    this.carrying = 0;
    this.root.visible = true;
    this.model.scale.setScalar(d.scale);
    this.model.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    this.root.position.set(x, 0, z);
    this.root.scale.setScalar(1);
    this.rot = Math.atan2(-x, -z);
    // tint: alpha gets a bluish-grey coat via emissive trick-free approach (scale/colour)
    this.coat.setHex(kind === 'alpha' ? 0xc9d3e6 : 0xffffff);
    this.tint.copy(this.coat);
    if (!wild) events.emit('enemy:spawn', { kind, x, z });
  }

  hit(dmg: number, fromX: number, fromZ: number, by: 'player' | 'tower' | 'worker', attacker?: Damageable) {
    if (!this.alive || this.submerged) return;
    if (this.kind === 'golem') {
      const k = this.game.mine.golemDamageMult();
      if (k < 1 && Math.random() < 0.25) this.game.labels.float(this.x, 4.2, this.z, '🛡', '#cfd8e6', 0.6);
      dmg *= k;
    }
    this.hp -= dmg;
    this.flash = 0.12;
    this.showBar = 3;
    events.emit('enemy:hit', { x: this.x, z: this.z, dmg, byPlayer: by === 'player' });
    this.game.fx.burst(this.x, 1.2, this.z, COLORS.snow, 5, 3, 0.15);
    this.game.labels.damage(this.x, 2.2 * this.model.scale.y, this.z, Math.round(dmg));
    // small knockback (not for bosses)
    if (this.kind !== 'alpha' && this.kind !== 'orca' && this.kind !== 'golem') {
      const dx = this.x - fromX, dz = this.z - fromZ, d = Math.hypot(dx, dz) || 1;
      this.tryMove((dx / d) * 0.25, (dz / d) * 0.25);
    }
    if (by === 'player') this.game.haptic('light');
    if ((this.wild || by !== 'tower') && this.kind !== 'seal') {
      this.aggro = attacker ?? (by === 'player' ? this.game.player : null);
      this.aggroT = 6;
    }
    if (this.kind === 'seal') this.fleeT = 3; // thieves run away when hit
    if (this.hp <= 0) this.die();
  }

  private die() {
    this.state = 'dying';
    this.stateT = 0;
    this.clearTelegraph();
    const d = E[this.kind];
    events.emit('enemy:died', { kind: this.kind, x: this.x, z: this.z });
    this.game.dropItems(d.drop ?? 'meat', this.x, this.z, d.meat + this.carrying);
    // hides for the tailor (fraction = chance of one more)
    if (d.hide) {
      const n = Math.floor(d.hide) + (Math.random() < d.hide % 1 ? 1 : 0);
      // with a Warehouse the hides are skinned and stored right away (they used to rot on the ground)
      if (n && this.game.zones.built.has('warehouse')) { this.game.eco.add('hide', n); this.game.flows.add('hide', n, 'animals'); }
      else if (n) this.game.dropItems('hide', this.x, this.z, n);
    }
    this.carrying = 0;
    if (d.gold > 0) this.game.dropGold(this.x, this.z, d.gold);
    this.game.fx.burst(this.x, 1, this.z, COLORS.snow, 14, 5, 0.2);
    if (this.kind === 'alpha' || this.kind === 'orca' || this.kind === 'golem') this.game.shake(0.6);
    if (this.kind === 'orca') this.game.lake.onOrcaDied(this);
    if (this.kind === 'golem') this.game.mine.onGolemDied();
  }

  /** Returns false when finished dying (ready to release to the pool). */
  update(dt: number): boolean {
    this.phase += dt * this.speed * 3;
    if (this.flash > 0) {
      this.flash -= dt;
      // hit flash: red tint (instanced colour), visible even on white fur
      if (this.flash > 0) this.tint.setRGB(1, 0.42, 0.38); else this.tint.copy(this.coat);
    }
    if (this.showBar > 0) this.showBar -= dt;

    if (this.state === 'dying') {
      this.stateT += dt;
      this.model.rotation.z = Math.min(Math.PI / 2, this.stateT * 5);
      if (this.stateT > 0.8) this.root.position.y = -(this.stateT - 0.8) * 2;
      return this.stateT < 1.5;
    }

    this.atkCd -= dt;
    this.chargeCd -= dt;
    // status effects from towers
    if (this.slowT > 0) this.slowT -= dt;
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.5;
        this.hit(BALANCE.towers.burnDps * 0.5 * this.game.up.towerDamageMult, this.x, this.z, 'tower');
        this.game.fx.rise(this.x + rand(-0.4, 0.4), 1.2, this.z + rand(-0.4, 0.4), COLORS.orange, 0.6, 0.18);
        if (!this.alive) return true;
      }
    }
    if (this.pendingHit) {
      this.pendingT -= dt;
      if (this.pendingT <= 0) { const f = this.pendingHit; this.pendingHit = null; f(); }
    }
    if (this.aggroT > 0) { this.aggroT -= dt; if (this.aggroT <= 0) this.aggro = null; }

    if (this.kind === 'orca') this.game.lake.driveOrca(this, dt);
    else if (this.kind === 'golem') this.game.mine.driveGolem(this, dt);
    else if (this.state === 'telegraph') this.updateTelegraph(dt);
    else if (this.state === 'dash') this.updateDash(dt);
    else if (this.kind === 'seal') this.sealThink(dt);
    else this.think(dt);

    // animation
    const walking = this.state === 'walk' ? 1 : 0;
    if (walking && this.kind !== 'orca' && !this.flying) this.game.world.footprints.step(this, this.x, this.z, 0.75 * this.model.scale.x, 0.3 * this.model.scale.x, 6);
    const sw = Math.sin(this.phase * 2.2) * 0.5 * walking;
    if (this.legs.length === 2) {
      this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
      this.model.position.y = Math.abs(Math.sin(this.phase * 2.2)) * 0.08 * walking;
    } else if (this.legs.length) {
      this.legs[0].rotation.x = sw; this.legs[3].rotation.x = sw;
      this.legs[1].rotation.x = -sw; this.legs[2].rotation.x = -sw;
      this.model.position.y = Math.abs(Math.sin(this.phase * 2.2)) * 0.06 * walking;
    } else if (this.wings) {
      // flap + bob in the air
      this.wings.scale.x = 0.45 + 0.55 * Math.abs(Math.sin(this.phase * 9));
      this.model.position.y = 1.7 + Math.sin(this.phase * 2) * 0.25;
    } else if (this.kind !== 'orca' && this.kind !== 'golem') {
      // flipper animals hump along
      this.model.position.y = Math.abs(Math.sin(this.phase * 1.6)) * 0.14 * walking;
      this.model.rotation.x = Math.sin(this.phase * 1.6) * 0.08 * walking;
    }
    if (this.lunge > 0) { this.lunge -= dt; }
    this.model.position.z = this.lunge > 0 ? Math.sin((this.lunge / 0.25) * Math.PI) * 0.5 : 0;
    if (this.legs.length) this.model.rotation.x = this.state === 'telegraph' ? -0.3 : 0;
    this.root.position.set(this.x, this.kind === 'orca' ? this.rise : 0, this.z);
    this.root.rotation.y = this.rot;
    this.hpAnchor.set(this.x, 2.4 * this.model.scale.y + 0.3, this.z);
    return true;
  }

  private think(dt: number) {
    const g = this.game;
    this.retarget -= dt;
    if (this.retarget <= 0) { this.retarget = 0.4; this.pickGoal(); }

    // attack current victim / wall in reach
    if (this.victim && this.victim.alive) {
      const d = Math.hypot(this.victim.x - this.x, this.victim.z - this.z);
      if (this.kind === 'alpha' && this.chargeCd <= 0 && d < E.alphaCharge.range && d > 2.5) { this.startTelegraph(this.victim.x, this.victim.z); return; }
      if (d < this.radius + 1.0) { this.face(this.victim.x, this.victim.z, dt); this.doAttack(() => this.victim?.hit(this.dmg, this.x, this.z)); return; }
    }
    if (this.wall && this.wall.hp > 0) {
      const p = g.palisade.closestPoint(this.wall, this.x, this.z);
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (this.kind === 'alpha' && this.chargeCd <= 0 && d < E.alphaCharge.range && d > 2.5) { this.startTelegraph(p.x, p.z); return; }
      if (d < this.radius + 0.9) {
        this.face(p.x, p.z, dt);
        const w = this.wall;
        this.doAttack(() => g.palisade.damage(w, this.dmg * (E[this.kind].wallMult ?? 1)));
        return;
      }
    }
    this.state = 'walk';
    // move towards goal
    const dx = this.goal.x - this.x, dz = this.goal.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.3) {
      const sp = this.speed * (this.wild && !this.aggro ? 0.45 : 1) * (this.slowT > 0 ? BALANCE.towers.slowMult : 1);
      const mx = (dx / d) * sp * dt, mz = (dz / d) * sp * dt;
      const moved = this.tryMove(mx, mz);
      this.face(this.x + dx, this.z + dz, dt);
      if (!moved) {
        // bumped into a wall cell? -> that segment becomes the target
        const seg = g.palisade.segmentAtCell(this.x + (dx / d) * (this.radius + 0.5), this.z + (dz / d) * (this.radius + 0.5));
        if (seg && seg.hp > 0) { this.wall = seg; this.victim = null; }
        this.stuck += dt;
        if (this.stuck > 1.2) { this.stuck = 0; this.goal.x = this.x + rand(-4, 4); this.goal.z = this.z + rand(-4, 4); this.retarget = 1; }
      } else this.stuck = 0;
    }
    // separation from other enemies
    for (const o of g.enemies) {
      if (o === this || !o.alive) continue;
      const ox = this.x - o.x, oz = this.z - o.z;
      const min = this.radius + o.radius;
      const d2 = ox * ox + oz * oz;
      if (d2 < min * min && d2 > 1e-4) {
        const dd = Math.sqrt(d2);
        this.tryMove((ox / dd) * (min - dd) * 0.5, (oz / dd) * (min - dd) * 0.5);
      }
    }
  }

  private fleeT = 0;
  private stealT = 0;

  /**
   * Seal thief: sneaks to the smokehouse, grabs fish from its stores and waddles back to the ice.
   * Never attacks; runs when hit. Killing it gives the fish back.
   */
  private sealThink(dt: number) {
    const g = this.game;
    this.state = 'walk';
    this.fleeT -= dt;
    this.stealT -= dt;
    const S = BALANCE.lake.seal;
    const store = this.carrying < S.carry ? g.lake.stealTarget(this.x, this.z) : null;
    if (this.fleeT > 0 || !store) {
      // back to the hole it came from (roam a little once there)
      if (Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 0.5 || this.retarget <= 0) {
        this.retarget = 2;
        this.goal.x = this.home.x + rand(-3, 3); this.goal.z = this.home.z + rand(-3, 3);
      }
    } else {
      this.goal.x = store.x; this.goal.z = store.z;
      if (Math.hypot(store.x - this.x, store.z - this.z) < store.r && this.stealT <= 0) {
        this.stealT = S.stealInterval;
        if (store.store.take()) {
          this.carrying++;
          g.fx.fly(itemGeo(store.store.type), store.store.source().clone(), new THREE.Vector3(this.x, 1, this.z), { dur: 0.3, arc: 1 });
          events.emit('lake:stolen', { x: this.x, z: this.z });
          if (this.carrying >= S.carry) this.fleeT = 6;
        }
      }
    }
    this.retarget -= dt;
    const dx = this.goal.x - this.x, dz = this.goal.z - this.z, d = Math.hypot(dx, dz);
    if (d > 0.3) {
      const sp = this.speed * (this.fleeT > 0 ? 1.3 : 1);
      if (!this.tryMove((dx / d) * sp * dt, (dz / d) * sp * dt)) { this.stuck += dt; if (this.stuck > 1) { this.stuck = 0; this.goal.x = this.x + rand(-4, 4); this.goal.z = this.z + rand(-4, 4); } }
      this.face(this.x + dx, this.z + dz, dt);
    }
  }

  private pickGoal() {
    const g = this.game;
    const pl = g.player;
    // defend itself: aggro target or any combatant right next to it
    if (this.aggro && this.aggro.alive) { this.setVictim(this.aggro); return; }
    if (pl.alive && (pl.x - this.x) ** 2 + (pl.z - this.z) ** 2 < E.aggroPlayerRadius ** 2 * (this.wild ? 1 : 1.6)) { this.setVictim(pl); return; }
    for (const c of g.combatants()) {
      if (c.alive && (c.x - this.x) ** 2 + (c.z - this.z) ** 2 < E.aggroPlayerRadius ** 2) { this.setVictim(c); return; }
    }
    if (this.wild) {
      // roam around home
      this.victim = null;
      if (Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 0.5 || Math.random() < 0.01) {
        const R = BALANCE.wildBears.roamRadius;
        const gx = this.home.x + rand(-R, R), gz = this.home.z + rand(-R, R);
        if (g.nav.walkable(gx, gz, false)) this.goal.x = gx; this.goal.z = gz;
      }
      return;
    }
    const inside = g.palisade.inside(this.x, this.z) || this.flying;
    if (!inside) {
      // 1) palisade — head for the nearest breach if one exists, else the wall towards the centre
      let breach: Segment | null = null, bd2 = 22 * 22;
      for (const sg of g.palisade.segments) {
        if (sg.hp > 0) continue;
        const d2 = (sg.cx - this.x) ** 2 + (sg.cz - this.z) ** 2;
        if (d2 < bd2) { bd2 = d2; breach = sg; }
      }
      if (breach) {
        this.goal.x = breach.cx * 0.6; this.goal.z = breach.cz * 0.6;
        this.wall = null;
        this.victim = null;
        return;
      }
      if (!this.wall || this.wall.hp <= 0) {
        this.wall = null;
        let best: Segment | null = null, bd = Infinity;
        for (const s of g.palisade.segments) {
          if (s.hp <= 0) continue;
          const d = g.palisade.distToSegment(s, this.x, this.z);
          if (d < bd) { bd = d; best = s; }
        }
        if (best) {
          const p = g.palisade.closestPoint(best, this.x, this.z);
          this.goal.x = p.x; this.goal.z = p.z;
          if (bd < 2.5) this.wall = best;
        } else this.goal.x = 0; this.goal.z = 0;
      }
      this.victim = null;
      return;
    }
    // 2) inside: survivors, then 3) the player
    this.wall = null;
    const s = g.survivors.nearest(this.x, this.z);
    if (s) { this.setVictim(s); return; }
    if (pl.alive) this.setVictim(pl);
    else this.goal.x = 0; this.goal.z = 0;
  }

  private setVictim(v: Damageable) {
    this.victim = v;
    this.wall = null;
    this.goal.x = v.x; this.goal.z = v.z;
  }

  private doAttack(apply: () => void) {
    this.state = 'attack';
    if (this.atkCd > 0) return;
    this.atkCd = E[this.kind].attackInterval;
    this.lunge = 0.25;
    this.pendingHit = apply;
    this.pendingT = 0.12;
  }

  private face(tx: number, tz: number, dt: number) {
    this.rot = angleLerp(this.rot, Math.atan2(tx - this.x, tz - this.z), Math.min(1, dt * 8));
  }

  private tryMove(dx: number, dz: number): boolean {
    if (this.flying) { this.x += dx; this.z += dz; return true; } // over walls and rooftops
    const nav = this.game.nav;
    const r = this.radius * 0.6;
    let moved = false;
    if (nav.walkableR(this.x + dx, this.z, r, false)) { this.x += dx; moved = true; }
    if (nav.walkableR(this.x, this.z + dz, r, false)) { this.z += dz; moved = true; }
    return moved;
  }

  // ---- alpha boss charge ----
  private startTelegraph(tx: number, tz: number) {
    this.state = 'telegraph';
    this.stateT = 0;
    this.dashHitDone = false;
    const d = Math.hypot(tx - this.x, tz - this.z) || 1;
    this.dashDir = { x: (tx - this.x) / d, z: (tz - this.z) / d };
    this.goal.x = tx; this.goal.z = tz;
    this.telegraph = this.game.telegraphCircle(tx, tz, E.alphaCharge.radius);
    events.emit('enemy:telegraph', { x: tx, z: tz });
  }

  private updateTelegraph(dt: number) {
    this.stateT += dt;
    this.face(this.goal.x, this.goal.z, dt * 2);
    if (this.telegraph) {
      const k = this.stateT / E.alphaCharge.telegraph;
      (this.telegraph.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * Math.abs(Math.sin(k * Math.PI * 4));
    }
    if (this.stateT >= E.alphaCharge.telegraph) { this.state = 'dash'; this.stateT = 0; }
  }

  private updateDash(dt: number) {
    this.stateT += dt;
    const C = E.alphaCharge;
    const remaining = Math.hypot(this.goal.x - this.x, this.goal.z - this.z);
    const step = Math.min(remaining, C.dashSpeed * dt);
    this.tryMove(this.dashDir.x * step, this.dashDir.z * step);
    const g = this.game;
    if (!this.dashHitDone && (remaining < 0.6 || this.stateT >= C.dashTime)) {
      this.dashHitDone = true;
      const gx = this.goal.x, gz = this.goal.z;
      const R2 = C.radius ** 2;
      const victims: Damageable[] = [g.player, ...g.survivors.list, ...g.combatants()];
      for (const v of victims) if (v.alive && (v.x - gx) ** 2 + (v.z - gz) ** 2 < R2) v.hit(this.dmg, this.x, this.z);
      for (const s of g.palisade.segments) if (s.hp > 0 && g.palisade.distToSegment(s, gx, gz) < C.radius) g.palisade.damage(s, this.dmg * 1.5);
      g.fx.burst(gx, 0.3, gz, COLORS.snow, 20, 6, 0.22);
      g.fx.ring(gx, gz, 0xffffff, C.radius, 0.4);
      g.shake(0.5);
      this.clearTelegraph();
    }
    if (this.stateT >= C.dashTime + 0.3) { this.state = 'walk'; this.chargeCd = C.cooldown; }
  }

  private clearTelegraph() {
    if (this.telegraph) { this.game.releaseTelegraph(this.telegraph); this.telegraph = null; }
  }
}
