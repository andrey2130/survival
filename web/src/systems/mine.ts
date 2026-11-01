import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { MINE } from '../config/layout';
import { Geo, mesh } from '../world/models';
import { Cell } from '../world/nav';
import { events } from '../core/events';
import { rand, randInt } from '../core/math';
import type { Game } from '../game';
import type { Enemy } from '../entities/enemy';
import type { ResourceStack } from '../entities/stack';

const M = BALANCE.mine;
const G = M.golem;

export interface Vein {
  i: number;
  x: number;
  z: number;
  level: number;
  hits: number;
  ore: number;
  rich: boolean;
  /** size used for reach / nav */
  r: number;
}

interface Level {
  level: number;
  name: string;
  cx: number;
  cz: number;
  radius: number;
  door: { x: number; z: number };
  unlocked: boolean;
  lanterns: number;
  overlay?: THREE.Mesh;
  blocker?: THREE.Mesh;
}

/**
 * Gold mine depths: galleries behind rock walls (bought with zones), richer ore veins the deeper you go,
 * darkness that slows mining and draws ice bats until lanterns are hung, and the Stone Golem boss that
 * guards the Gold Vein (armoured except while its cracks glow after a ground slam).
 */
export class MineSystem {
  readonly veins: Vein[] = [];
  readonly levels: Level[];
  private built = false;
  /** hits landed per (miner, vein) */
  private hitsBy = new WeakMap<object, Map<Vein, number>>();
  private batT = 0;
  // golem
  golemCooldown = 0;
  private golem: Enemy | null = null;
  private gState: 'sleep' | 'walk' | 'tele' | 'stun' = 'sleep';
  private gT = 0;
  private gAway = 0;
  private tele: THREE.Mesh | null = null;
  private teleAt = { x: 0, z: 0 };

  constructor(private game: Game) {
    // the surface rock is "vein 0" (level 1, always open once the mine region is)
    this.veins.push({ i: 0, x: MINE.rock.x, z: MINE.rock.z, level: 1, hits: BALANCE.goldRock.hits, ore: 1, rich: false, r: 2.2 });
    M.veins.forEach((v, i) => this.veins.push({ i: i + 1, x: v.x, z: v.z, level: v.level, hits: v.hits, ore: v.ore, rich: !!(v as { rich?: boolean }).rich, r: 1.4 }));
    this.levels = M.levels.map((l) => ({ level: l.level, name: l.name, cx: l.center[0], cz: l.center[1], radius: l.radius, door: { x: l.door[0], z: l.door[1] }, unlocked: false, lanterns: 0 }));
  }

  get open() { return this.game.world.isOpen('north'); }
  level(n: number) { return this.levels.find((l) => l.level === n); }
  isOpen(level: number) { return level <= 1 ? this.open : !!this.level(level)?.unlocked; }

  /** 0 (lit) .. 1 (pitch dark) */
  darkness(level: number) {
    if (level <= 1) return 0;
    const l = this.level(level);
    return l ? Math.max(0, 1 - l.lanterns * M.lanternLight) : 0;
  }

  /** Level whose gallery contains (x, z), or 0. */
  levelAt(x: number, z: number) {
    for (const l of this.levels) if (Math.hypot(x - l.cx, z - l.cz) < l.radius) return l.level;
    return 0;
  }

  // ------------------------------------------------------------------ zones
  unlock(level: number) {
    const l = this.level(level);
    if (!l || l.unlocked) return;
    l.unlocked = true;
    if (this.built) this.openDoor(l);
  }

  addLantern(level: number, x: number, z: number) {
    const l = this.level(level);
    if (!l) return;
    l.lanterns++;
    this.refreshDark(l);
    this.game.world.addGlow(x + 0.6, 2.1, z, 0xffc46b, 3.2);
  }

  // ------------------------------------------------------------------ visuals (built when the mine region opens)
  private build() {
    this.built = true;
    const g = this.game, sc = g.scene;
    for (const v of this.veins) {
      if (v.level <= 1) continue;
      const m = mesh(Geo.oreVein(v.rich));
      m.position.set(v.x, 0, v.z);
      m.rotation.y = v.i * 1.7;
      sc.add(m);
      g.nav.setCircle(v.x, v.z, 1.2, Cell.Solid);
    }
    const floorGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x5b6070, roughness: 0.9, metalness: 0 });
    for (const l of this.levels) {
      // cave floor + a ring of boulders with one opening (the door)
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.scale.setScalar(l.radius);
      floor.position.set(l.cx, 0.03, l.cz);
      floor.receiveShadow = true;
      sc.add(floor);
      const doorA = Math.atan2(l.door.z - l.cz, l.door.x - l.cx);
      const n = Math.round(l.radius * 1.6);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        let da = Math.abs(a - doorA) % (Math.PI * 2);
        if (da > Math.PI) da = Math.PI * 2 - da;
        if (da < 0.32) continue; // opening
        const x = l.cx + Math.cos(a) * (l.radius + 0.6), z = l.cz + Math.sin(a) * (l.radius + 0.6);
        const r = mesh(Geo.rock(k % 3));
        const s = 1.5 + ((k * 37) % 7) / 10;
        r.scale.set(s, s * 1.4, s);
        r.rotation.y = k;
        r.position.set(x, 0, z);
        sc.add(r);
        g.nav.setCircle(x, z, 1.4, Cell.Solid);
      }
      // entrance arch at the door, blocked by a boulder until the zone is bought
      const arch = mesh(Geo.mineEntrance());
      arch.position.set(l.door.x, 0, l.door.z);
      arch.rotation.y = Math.atan2(l.door.x - l.cx, l.door.z - l.cz);
      arch.scale.setScalar(0.75);
      sc.add(arch);
      const blocker = mesh(Geo.rock(1));
      blocker.scale.set(1.6, 1.6, 1.6);
      blocker.position.set(l.door.x, 0, l.door.z);
      sc.add(blocker);
      l.blocker = blocker;
      g.nav.setCircle(l.door.x, l.door.z, 1.6, Cell.Solid);
      // darkness over the gallery floor
      const dark = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ color: 0x05070d, transparent: true, opacity: 0.6, depthWrite: false }));
      dark.scale.setScalar(l.radius + 1.2);
      dark.position.set(l.cx, 0.08, l.cz);
      dark.renderOrder = 2;
      sc.add(dark);
      l.overlay = dark;
      if (l.unlocked) this.openDoor(l);
      this.refreshDark(l);
    }
  }

  private openDoor(l: Level) {
    if (l.blocker) { this.game.scene.remove(l.blocker); l.blocker = undefined; }
    this.game.nav.setCircle(l.door.x, l.door.z, 1.6, Cell.Free);
    this.game.fx.burst(l.door.x, 1, l.door.z, 0x7f8ea3, 14, 5, 0.2);
  }

  private refreshDark(l: Level) {
    if (l.overlay) (l.overlay.material as THREE.MeshBasicMaterial).opacity = 0.62 * this.darkness(l.level) + (l.unlocked ? 0 : 0.15);
  }

  // ------------------------------------------------------------------ mining (hero + miners)
  /** Nearest open vein within `r` (edge distance). */
  veinNear(x: number, z: number, r: number): Vein | null {
    let best: Vein | null = null, bd = Infinity;
    for (const v of this.veins) {
      if (!this.isOpen(v.level)) continue;
      const d = Math.hypot(v.x - x, v.z - z) - v.r;
      if (d < r && d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Vein for a miner: deepest open level, spread across miners. */
  veinFor(minerIndex: number): Vein | null {
    const open = this.veins.filter((v) => this.isOpen(v.level));
    if (!open.length) return null;
    const deepest = Math.max(...open.map((v) => v.level));
    const pool = open.filter((v) => v.level === deepest);
    return pool[minerIndex % pool.length];
  }

  /** One pick hit. Ore flies into the stack after `hits` hits (slower in the dark). */
  hitVein(v: Vein, who: object, stack: ResourceStack) {
    const g = this.game;
    let m = this.hitsBy.get(who);
    if (!m) { m = new Map(); this.hitsBy.set(who, m); }
    const k = (m.get(v) ?? 0) + (1 - M.darkMiningMult * this.darkness(v.level));
    events.emit('rock:hit', { x: v.x, z: v.z });
    g.fx.burst(v.x, 1.4, v.z + 0.8, v.rich ? 0xffd23f : 0xc9a54a, 5, 3.5, 0.13);
    if (k < v.hits) { m.set(v, k); return; }
    m.set(v, 0);
    // Iron Ivan: extra ore now and then
    const extra = v.ore * g.residents.bonus('ore');
    const ore = v.ore + Math.floor(extra) + (Math.random() < extra % 1 ? 1 : 0);
    for (let i = 0; i < ore; i++) g.giveItemTo(stack, 'ore', new THREE.Vector3(v.x, 2, v.z + 1), 0.35 + i * 0.08);
    g.flows.add('ore', ore, who === g.player ? 'hero' : 'miner');
    if (v.rich && Math.random() < M.nuggetChance) g.dropGold(v.x, v.z, 1);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (!this.open) return;
    if (!this.built) this.build();
    const g = this.game, p = g.player;
    const here = p.alive ? this.levelAt(p.x, p.z) : 0;
    // ice bats swarm out of the dark galleries
    if (here && this.darkness(here) > 0.01) {
      this.batT -= dt * this.darkness(here);
      const bats = g.enemies.filter((e) => e.kind === 'bat' && e.alive && e.wild).length;
      if (this.batT <= 0 && bats < M.maxBats) {
        this.batT = M.batSwarmSeconds;
        const l = this.level(here)!;
        const n = randInt(3, 5);
        for (let i = 0; i < n; i++) g.spawnEnemy('bat', l.cx + rand(-3, 3), l.cz + rand(-3, 3), 1, true);
        events.emit('toast', { text: 'Ice bats! Hang lanterns to keep them away 🦇', color: '#9fe8ff' });
      }
    } else this.batT = Math.min(this.batT, 4);
    // the golem wakes when the hero walks into the Gold Vein
    this.golemCooldown -= dt;
    const l3 = this.level(3);
    if (!this.golem && l3?.unlocked && here === 3 && this.golemCooldown <= 0) {
      const e = g.spawnEnemy('golem', l3.cx + 2, l3.cz - 4, 1, true);
      this.golem = e;
      this.gState = 'walk';
      this.gT = 2.5;
      g.hud.showBanner('⚠ STONE GOLEM ⚠', 'danger');
      events.emit('toast', { text: 'Hit the golem while its cracks glow! 🔥', color: '#ffd23f' });
    }
  }

  /** Damage multiplier on the golem: armoured unless its cracks glow. */
  golemDamageMult() { return this.gState === 'stun' ? 1 : G.armor; }

  /** Called from Enemy.update for the golem. */
  driveGolem(e: Enemy, dt: number) {
    const g = this.game, p = g.player;
    const l = this.level(3)!;
    this.gT -= dt;
    const inside = p.alive && Math.hypot(p.x - l.cx, p.z - l.cz) < l.radius + 3;
    this.gAway = inside ? 0 : this.gAway + dt;
    // the hero ran away: the golem goes back to sleep (keeps its wounds)
    if (this.gAway > G.leashSeconds) { this.clearTele(); this.golem = null; this.golemCooldown = 30; e.despawn(); return; }
    // glow of the cracks: bright while vulnerable, a faint pulse otherwise
    const glow = this.gState === 'stun' ? 1.6 + Math.sin(g.time * 12) * 0.3 : 0.25 + 0.1 * Math.sin(g.time * 3);
    e.glow.setRGB(1.6 * glow, 0.75 * glow, 0.15 * glow);
    if (this.gState === 'walk') {
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
      if (d > 2.2) {
        const step = G.speed * dt;
        let nx = e.x + (dx / d) * step, nz = e.z + (dz / d) * step;
        // stays inside its cavern
        const cd = Math.hypot(nx - l.cx, nz - l.cz);
        if (cd > l.radius - 1.5) { nx = l.cx + ((nx - l.cx) / cd) * (l.radius - 1.5); nz = l.cz + ((nz - l.cz) / cd) * (l.radius - 1.5); }
        e.x = nx; e.z = nz;
      }
      e.rot = Math.atan2(dx, dz);
      if (this.gT <= 0 && inside) {
        this.gState = 'tele';
        this.gT = G.telegraph;
        this.teleAt = { x: p.x, z: p.z };
        this.tele = g.telegraphCircle(p.x, p.z, G.slamRadius);
        events.emit('enemy:telegraph', this.teleAt);
      }
    } else if (this.gState === 'tele') {
      if (this.tele) (this.tele.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * Math.abs(Math.sin((1 - this.gT / G.telegraph) * Math.PI * 4));
      if (this.gT <= 0) {
        // ground slam
        const { x, z } = this.teleAt;
        for (const v of [g.player, ...g.workers]) if (v.alive && Math.hypot(v.x - x, v.z - z) < G.slamRadius) v.hit(G.slamDamage);
        g.fx.burst(x, 0.4, z, 0x7f8ea3, 22, 7, 0.24);
        g.fx.ring(x, z, 0xffd23f, G.slamRadius, 0.45);
        g.shake(0.6);
        this.clearTele();
        this.gState = 'stun';
        this.gT = G.crackSeconds;
      }
    } else if (this.gState === 'stun') {
      if (this.gT <= 0) { this.gState = 'walk'; this.gT = G.slamEvery; }
    }
  }

  private clearTele() { if (this.tele) { this.game.releaseTelegraph(this.tele); this.tele = null; } }

  onGolemDied() {
    this.clearTele();
    this.golem = null;
    this.gState = 'sleep';
    this.golemCooldown = G.cooldown;
    this.game.hud.showBanner('The Stone Golem crumbles!', 'good');
  }

  serialize() { return { golem: Math.max(0, this.golemCooldown) }; }
  restore(d: { golem?: number } | undefined) { this.golemCooldown = d?.golem ?? 0; }
}
