import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { WorkerKind } from '../config/layout';
import { Walker } from './walker';
import { ResourceStack } from './stack';
import { COLORS } from '../world/models';
import { res } from '../config/content';
import { regionById } from '../config/layout';
import { itemGeo } from '../world/models';
import { Bubble } from '../ui/bubbles';
import type { Game } from '../game';
import type { Damageable, Enemy } from './enemy';
import type { Stall } from '../buildings/camp';
import type { Tree } from '../world/trees';
import type { Port } from '../systems/storage';
import type { Hole } from '../systems/lake';
import type { Segment } from '../world/palisade';
import type { Resident } from '../systems/residents';

const W = BALANCE.workers;

const LOOK: Record<WorkerKind, { shirt: number; hat: number; tool: 'axe' | 'spear' | 'pickaxe' | null }> = {
  lumberjack: { shirt: 0xb03a2e, hat: 0x2c3e50, tool: 'axe' },
  carrier: { shirt: 0x8d6e63, hat: 0xd35400, tool: null },
  hunter: { shirt: 0x4e7d3a, hat: 0x6d4c41, tool: 'spear' },
  cook: { shirt: 0xf5f5f5, hat: 0xffffff, tool: null },
  cashier: { shirt: 0xe6b422, hat: 0x27ae60, tool: null },
  miner: { shirt: 0xe67e22, hat: 0xf1c40f, tool: 'pickaxe' },
  guard: { shirt: 0x546e8a, hat: 0x95a5a6, tool: 'spear' },
  fisher: { shirt: 0x2a8c9c, hat: 0xf2b134, tool: 'axe' },
  builder: { shirt: 0xc97a2c, hat: 0xffd23f, tool: 'axe' },
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
  private patrolI = 0;
  private hole: Hole | null = null;
  private dropAt: Port | undefined | null = null;
  private bubble: Bubble;
  /** watchdog: last checkpoint (position / stack / state) and seconds without any progress */
  private wd = { x: 0, z: 0, size: 0, state: '' };
  private noProgress = 0;
  /** how many times the watchdog had to reset this worker (debug overlay) */
  resets = 0;

  /** resident record: name, needs, special trait */
  res?: Resident;
  /** chunk id of the camp this worker belongs to: works only in that location, delivers to its depot */
  camp?: string;
  /** average metres walked per delivered load (lumberjacks; 0 = no trip yet) */
  tripAvg = 0;
  private tripStart = 0;

  /** Move to another settlement (camp chunk id, or undefined = the base): new home, fresh start. */
  relocate(camp: string | undefined, home: { x: number; z: number }) {
    if (this.tree) { this.tree.reservedBy = null; this.tree = null; }
    this.camp = camp;
    this.home = home;
    this.prey = null;
    this.stop();
    this.state = 'start';
    this.tripAvg = 0;
    this.tripStart = this.walked;
  }

  private tripDone() {
    const d = this.walked - this.tripStart;
    this.tripStart = this.walked;
    if (d > 1) this.tripAvg = this.tripAvg ? this.tripAvg * 0.7 + d * 0.3 : d;
  }

  constructor(game: Game, readonly kind: WorkerKind, public home: { x: number; z: number }) {
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
      this.game.dropStack(this.stack, this.x, this.z);
      this.stop();
      if (this.tree) { this.tree.reservedBy = null; this.tree = null; }
    }
  }

  update(dt: number) {
    const g = this.game;
    this.speed = g.up.workerSpeed * g.residents.workMult(this.res);
    // lumberjacks walk far for their trees: a bigger load keeps wood flowing to the base
    this.stack.cap = g.up.workerCap + (this.kind === 'lumberjack' ? W.lumberjackExtraCapacity : 0);
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
    // a wave is near and we're outside the wall: get behind it and wait
    // (camp workers have their own watchtower and don't run to the base)
    if ((this.kind === 'hunter' || this.kind === 'lumberjack') && !this.camp && this.shelter(dt)) { this.sync(dt); return; }
    // sick (to the infirmary) or tired (a short nap) — the job waits
    if (this.res && (this.res.sick || this.res.healing > 0 || this.res.napT > 0)) {
      if (this.care(this.res, this.home, dt, (k) => this.bubble.set(k))) { this.noProgress = 0; this.sync(dt); return; }
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
      case 'fisher': this.fisher(dt); break;
      case 'builder': this.builder(dt); break;
    }
    if ((this.kind === 'guard' || this.kind === 'hunter') && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 2);
    this.watchdog(dt);
    this.stack.update(dt, this.moving ? this.speed : 0, 0);
    this.sync(dt);
  }

  private sheltering = false;
  /**
   * Outside the wall when a wave's enemies come within 25 m: walk in through the nearest gate and
   * wait there until the wave is over, then go back to work.
   */
  private shelterT = 0;
  private shelter(dt: number): boolean {
    const g = this.game;
    const near = g.waves.state === 'active' && !!g.nearestEnemy(this.x, this.z, this.sheltering ? 25 : 15, (e) => !e.wild);
    if (!this.sheltering) {
      if (!near || g.palisade.inside(this.x, this.z, 1)) return false;
      this.sheltering = true;
      if (this.tree) { this.tree.reservedBy = null; this.tree = null; }
      this.prey = null;
    }
    // safe again for 5 s (or inside the wall with no wave near): back to work
    this.shelterT = near ? 5 : this.shelterT - dt;
    if (this.shelterT <= 0) { this.sheltering = false; this.state = 'start'; this.bubble.set(null); return false; }
    const B = g.palisade.bounds;
    const gates = [[0, B.z0 + 3], [0, B.z1 - 3], [B.x0 + 3, 0], [B.x1 - 3, 0]];
    const gp = gates.reduce((best, q) => (Math.hypot(q[0] - this.x, q[1] - this.z) < Math.hypot(best[0] - this.x, best[1] - this.z) ? q : best));
    this.bubble.set('cold');
    this.working();
    if (!g.palisade.inside(this.x, this.z, 1) && this.distTo(gp[0], gp[1]) > 1) { this.goTo(gp[0], gp[1]); this.walk(dt); } else this.stop();
    return true;
  }

  /** Leave the job (back to idle life): drop reservations, remove the body. */
  retire() {
    const g = this.game;
    if (this.tree) { this.tree.reservedBy = null; this.tree = null; }
    g.lake.release(this);
    this.stack.clear();
    this.bubble.set(null);
    const i = g.workers.indexOf(this);
    if (i >= 0) g.workers.splice(i, 1);
    this.dispose();
  }

  // ---------------------------------------------------------------- watchdog
  /** Mark legitimate work that doesn't move/carry anything (fishing, waiting at a busy stall...). */
  private working() { this.noProgress = 0; }

  /**
   * Any state machine can dead-end (target vanished, store full, no path, blocked by a new building).
   * If nothing changes for `workers.stuckTimeout` seconds the worker drops its task and decides again.
   * Standing idle at home with empty hands is fine and never counts.
   */
  private watchdog(dt: number) {
    const p = this.wd;
    if (Math.hypot(this.x - p.x, this.z - p.z) > 0.4 || this.stack.size !== p.size || this.state !== p.state || this.swing > 0) {
      p.x = this.x; p.z = this.z; p.size = this.stack.size; p.state = this.state;
      this.noProgress = 0;
      return;
    }
    const idleHome = !this.stack.size && this.arrived && this.distTo(this.home.x, this.home.z) < 1;
    if (idleHome || this.kind === 'cashier') { this.noProgress = 0; return; }
    this.noProgress += dt;
    if (this.noProgress < W.stuckTimeout) return;
    this.noProgress = 0;
    this.resets++;
    if (this.tree) { this.tree.reservedBy = null; this.tree = null; }
    this.prey = null;
    this.hole = null;
    this.game.lake.release(this);
    this.stop();
    this.state = 'start';
    this.unstick();
  }

  /** Step out of a building/rock that was placed on top of us. */
  private unstick() {
    const nav = this.game.nav;
    if (nav.walkable(this.x, this.z)) return;
    for (let ring = 1; ring <= 32; ring++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, d = ring * 0.3;
        const x = this.x + Math.cos(a) * d, z = this.z + Math.sin(a) * d;
        if (nav.walkableR(x, z, 0.3)) { this.x = x; this.z = z; return; }
      }
    }
  }

  /** One line for the debug overlay: role, state, target, carried items. */
  debugInfo() {
    const items: Record<string, number> = {};
    for (const s of this.stack.slots) items[s.type] = (items[s.type] ?? 0) + 1;
    const carry = Object.entries(items).map(([k, n]) => `${res(k).icon}${n}`).join('') || '∅';
    const tgt = this.prey ? `→${this.prey.kind}` : this.tree ? '→tree' : this.hole ? `→hole${this.hole.i}${this.hole.frozen ? '🧊' : ''}` : this.dest ? `→${this.dest.x.toFixed(0)},${this.dest.z.toFixed(0)}` : '';
    const stuck = this.noProgress > 3 ? ` ⏳${this.noProgress.toFixed(0)}s` : '';
    return `${this.kind}:${this.alive ? this.state : 'down'} ${tgt} ${carry}${stuck}${this.resets ? ` ↺${this.resets}` : ''}`;
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
      const camp = this.camp;
      this.tree = camp ? g.trees.nearestGrown(this.x, this.z, 70, (r) => r === camp, false, this) : g.trees.nearestGrown(this.x, this.z, 70, (r) => g.world.isOpen(r), false, this);
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
        this.t = W.chopInterval / g.up.mult('lumberTools');
        this.swing = 0.001;
        let logs = g.trees.hit(t, W.lumberjackDamage, this.x, this.z);
        g.fx.burst(t.x, 1.1, t.z, COLORS.woodLight, 4, 3, 0.12);
        if (logs > 0 && this.camp) {
          // camp lumberjacks: specialisation / distance bonus, and the location's goods (bark, charcoal)
          logs = Math.max(1, g.settlements.roll(logs * g.settlements.campLogMult(g.settlements.camp(this.camp)!)));
          g.settlements.onFell(this.camp);
        }
        if (logs > 0) {
          g.spawnLogsFromTree(t.x, t.z, logs, this);
          this.tree = null;
          this.state = this.stack.space() <= 0 ? 'deliver' : 'find';
        }
      }
    }
    if (this.state === 'deliver') {
      // re-evaluated every frame: priorities change as stores fill up
      this.dropAt = this.logTarget();
      const port = this.dropAt;
      if (this.unloadAt(port, dt)) { this.state = 'find'; this.dropAt = null; this.tripDone(); }
      else if (port?.store.space() === 0 && this.arrived) { this.bubble.set('zzz'); this.working(); }
      else this.bubble.set(null);
    }
  }

  /** Where a lumberjack takes logs: base reserves first, industry only when the base is stocked. */
  private logTarget(): Port | undefined {
    return this.camp ? this.game.settlements.logDrop(this.camp) : this.game.logistics.logDrop(this.x, this.z);
  }

  /**
   * Carrier = the camp's stoker and hauler. From the lumber hut, by priority (see Logistics):
   * furnace up to its reserve -> wood stall (its share of the log flow) -> the hut's surplus to the
   * nearest industry log store (sawmills, kiln...). Wall repair is the builders' job.
   */
  private carrier(dt: number) {
    const g = this.game, L = g.logistics;
    const hut = g.port('lumber_out');
    if (!hut) return;
    const target = () => L.baseLogTargets()[0] ?? L.surplusTarget(this.x, this.z);
    if (this.state === 'start' || this.state === 'decide') {
      if (this.stack.size) { this.state = 'deliver'; return; }
      if (hut.store.count > 0 && target()) this.state = 'load';
      else this.idleAt(this.home.x, this.home.z, dt);
    }
    if (this.state === 'load') {
      if (this.loadAt(hut, dt, this.stack.cap)) this.state = this.stack.size ? 'deliver' : 'decide';
    }
    if (this.state === 'deliver') {
      if (!this.stack.size) { this.state = 'decide'; return; }
      const t = target();
      if (!t) { this.idleAt(this.home.x, this.home.z, dt); if (this.arrived) this.state = 'decide'; return; }
      if (this.unloadAt(t, dt) || (t.store.space() === 0 && this.arrived)) { if (!this.stack.size) this.state = 'decide'; }
    }
  }

  /** Builder: takes logs from the lumber hut and repairs damaged wall segments (base priority 4). */
  private builder(dt: number) {
    const g = this.game, L = g.logistics;
    const hut = g.port('lumber_out');
    const seg = g.palisade.segments.reduce<Segment | null>((b, s) => (s.hp < s.maxHp && (!b || Math.hypot(s.cx - this.x, s.cz - this.z) < Math.hypot(b.cx - this.x, b.cz - this.z)) ? s : b), null);
    if (!seg) { this.idleAt(this.home.x, this.home.z, dt); this.state = 'start'; return; }
    if (!this.stack.has('log')) {
      // the fire comes first: no logs for walls while the furnace is short
      if (!hut || hut.store.count <= 0 || L.furnaceShort()) { this.idleAt(this.home.x, this.home.z, dt); return; }
      this.state = 'load';
      this.loadAt(hut, dt, Math.min(this.stack.cap, 12));
      return;
    }
    this.state = 'repair';
    if (this.distTo(seg.cx, seg.cz) > BALANCE.palisade.repairRadius * 0.8) { this.goTo(seg.cx, seg.cz); this.walk(dt); return; }
    this.stop();
    this.working();
    this.strike({ x: seg.cx, z: seg.cz }, dt);
    if (this.t > 0) return;
    this.t = 0.35;
    if (this.stack.remove('log')) {
      g.flows.add('log', -1, 'wall repair');
      g.palisade.repair(seg, BALANCE.palisade.repairPerLog);
      g.fx.burst(seg.cx, 1.2, seg.cz, 0xd08a4a, 5, 3, 0.12);
    }
  }

  private hunter(dt: number) {
    if (this.camp) { this.campHunter(dt, this.camp); return; }
    const g = this.game;
    // badly hurt: walk back to the kitchen (dropping the meat) and heal there instead of dying with it
    const hurt = this.hp < this.maxHp * 0.4 || (this.state === 'deliver' && this.hp < this.maxHp * 0.8 && !this.stack.has('meat'));
    // hides go to the Warehouse (bank) for the tailor
    const wh = g.port('warehouse');
    if (!this.stack.has('meat') && this.stack.has('hide') && wh && (this.stack.full || this.state === 'deliver')) {
      this.state = 'deliver';
      if (this.distTo(wh.x, wh.z) > wh.r * 0.8) { this.goTo(wh.x, wh.z); this.walk(dt); return; }
      this.stop();
      if (this.t <= 0) { this.t = 0.12; if (this.stack.has('hide')) g.bankItem(this.stack, 'hide', wh); }
      if (!this.stack.has('hide')) this.state = 'hunt';
      return;
    }
    // herbs picked up on the way go to the Warehouse (the infirmary draws them from there)
    if (!this.stack.has('meat') && this.stack.has('herb') && wh && (this.stack.full || this.state === 'deliver')) {
      this.state = 'deliver';
      if (this.distTo(wh.x, wh.z) > wh.r * 0.8) { this.goTo(wh.x, wh.z); this.walk(dt); return; }
      this.stop();
      if (this.t <= 0) { this.t = 0.12; if (this.stack.has('herb')) g.bankItem(this.stack, 'herb', wh); }
      if (!this.stack.has('herb')) this.state = 'hunt';
      return;
    }
    if (this.stack.full || hurt || (this.state === 'deliver' && this.stack.has('meat'))) {
      this.state = 'deliver';
      // the kitchen with the most free room for raw meat
      const ports = g.ports.filter((p) => p.mode === 'in' && p.workers && p.store.type === 'meat' && !p.settlement);
      // the least-filled meat store (by share, so a small stew house isn't starved by big kitchens)
      const target = ports.sort((a, b) => b.store.space() / b.store.cap - a.store.space() / a.store.cap)[0];
      if (this.unloadAt(target, dt)) this.state = 'hunt';
      else if (target && target.store.space() <= 0 && this.arrived) {
        // every kitchen is full: keep hunting while there's room in the basket, otherwise wait
        if (!this.stack.full) this.state = 'hunt';
        else { this.bubble.set('zzz'); this.working(); }
      }
      return;
    }
    this.state = 'hunt';
    this.bubble.set(null);
    if (!this.prey || !this.prey.alive) this.prey = g.nearestEnemy(this.x, this.z, 45, (e) => !g.palisade.inside(e.x, e.z));
    const meat = g.pickups.nearest(this.x, this.z, 14, 'meat');
    // pick up meat lying around before chasing the next animal (unless something is biting us)
    if (meat && !this.stack.full && (!this.prey || this.distTo(this.prey.x, this.prey.z) > W.hunterRange * 2)) {
      if (this.distTo(meat.x, meat.z) > 0.8) { this.goTo(meat.x, meat.z); this.walk(dt); }
      g.pickups.collect(this.x, this.z, this.stack, 'meat');
    if (g.port('warehouse')) g.pickups.collect(this.x, this.z, this.stack, 'herb');
    if (g.port('warehouse')) g.pickups.collect(this.x, this.z, this.stack, 'hide');
      return;
    }
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
    else {
      // no game around: collect the meat the towers' kills left by the walls
      const cm = this.campMeat();
      if (cm) { if (this.distTo(cm.x, cm.z) > 0.8) { this.goTo(cm.x, cm.z); this.walk(dt); } }
      else this.idleAt(this.home.x, this.home.z, dt);
    }
    g.pickups.collect(this.x, this.z, this.stack, 'meat');
  }

  /**
   * Hunter of a camp's Hunting Lodge: hunts wild animals in its location only and takes meat, hides
   * and herbs to the camp depot (the route hauls them on). Hunting grounds and the hunting
   * specialisation give extra meat & hides per delivery.
   */
  private campHunter(dt: number, chunk: string) {
    const g = this.game, S = g.settlements, c = S.camp(chunk), depot = S.depotPort(chunk);
    const def = regionById(chunk);
    if (!c || !depot || !def) { this.idleAt(this.home.x, this.home.z, dt); return; }
    const [x0, z0, x1, z1] = def.rect;
    const inChunk = (x: number, z: number) => x > x0 - 4 && x < x1 + 4 && z > z0 - 4 && z < z1 + 4;
    const hurt = this.hp < this.maxHp * 0.4;
    if (this.stack.full || this.state === 'deliver' || (hurt && this.stack.size)) {
      this.state = 'deliver';
      if (!this.stack.size) { this.state = 'hunt'; return; }
      if (this.distTo(depot.x, depot.z) > depot.r * 0.8) { this.goTo(depot.x, depot.z); this.walk(dt); return; }
      this.stop();
      this.working();
      if (this.t > 0) return;
      this.t = 0.12;
      const type = this.stack.slots[this.stack.size - 1].type;
      const from = this.stack.remove(type);
      if (!from) return;
      const bonus = type === 'meat' || type === 'hide' ? S.roll(Math.max(0, (c.trait?.huntMult ?? 1) * S.productionMult(c, 'hunt') - 1)) : 0;
      if (bonus) g.flows.add(type, bonus, 'camp hunters');
      S.add(c, type, 1 + bonus);
      g.fx.fly(itemGeo(type), from, new THREE.Vector3(depot.x, 1, depot.z), { dur: 0.3, arc: 1.2 });
      if (!this.stack.size) this.state = 'hunt';
      return;
    }
    this.state = 'hunt';
    if (!this.prey || !this.prey.alive || !inChunk(this.prey.x, this.prey.z)) this.prey = g.nearestEnemy(this.x, this.z, 60, (e) => e.wild && inChunk(e.x, e.z));
    const loot = (['meat', 'hide', 'herb'] as const).map((k) => g.pickups.nearest(this.x, this.z, 14, k)).find((p) => p && inChunk(p.x, p.z));
    if (loot && (!this.prey || this.distTo(this.prey.x, this.prey.z) > W.hunterRange * 2)) {
      if (this.distTo(loot.x, loot.z) > 0.8) { this.goTo(loot.x, loot.z); this.walk(dt); }
      for (const k of ['meat', 'hide', 'herb']) g.pickups.collect(this.x, this.z, this.stack, k);
      return;
    }
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
      return;
    }
    if (this.stack.size) { this.state = 'deliver'; return; }
    this.idleAt(this.home.x, this.home.z, dt);
  }

  /**
   * Cook: tends one kitchen and stays there (cook i -> kitchen i, extra cooks help the last one).
   * Kitchens send cooked food to the canteen / meat stall themselves; raw meat is brought by hunters,
   * farms and carriers — so cooks no longer run around half the time with empty hands.
   */
  private cook(dt: number) {
    const g = this.game;
    const ks = g.kitchens;
    const i = g.workers.filter((w) => w.kind === 'cook').indexOf(this);
    const kitchen = ks[Math.min(i, ks.length - 1)];
    if (!kitchen) { this.idleAt(this.home.x, this.home.z, dt); return; }
    kitchen.staffed = true;
    this.state = 'cook';
    const sx = kitchen.def.x - 1.4 + (i % 2) * 0.6, sz = kitchen.def.z + 1.8;
    if (this.distTo(sx, sz) > 1.6) { this.goTo(sx, sz); if (this.walk(dt)) return; }
    this.stop();
    this.moving = false;
    this.face(kitchen.def.x, kitchen.def.z, dt);
    this.working();
    if (kitchen.jobs.length && this.swing === 0 && Math.random() < dt * 1.5) this.swing = 0.001;
  }

  /** Raw meat lying in or just outside the camp (dropped by bears the towers killed). */
  private campMeat() {
    const g = this.game;
    const m = g.pickups.nearest(this.x, this.z, 60, 'meat');
    return m && g.palisade.inside(m.x, m.z, -10) ? m : null;
  }

  private cashier(dt: number) {
    const g = this.game;
    // serve the stall closest to where this cashier was hired
    const st = g.stalls.reduce<Stall | null>((b, s) => (!b || Math.hypot(s.px - this.home.x, s.pz - this.home.z) < Math.hypot(b.px - this.home.x, b.pz - this.home.z) ? s : b), null);
    if (!st) return;
    st.cashier = true;
    this.idleAt(st.serve.x + st.side * 1.3, st.serve.z - 0.4, dt);
    if (!this.moving) this.face(st.px, st.pz + 3, dt);
  }

  private miner(dt: number) {
    const g = this.game;
    // the smelter's fire box: miners fetch their own wood from the cliffs' trees (never the base's)
    const fuel = g.port('smelter_fuel_log');
    if (this.state === 'wood' || (fuel && fuel.store.count < 3 && !this.stack.size && g.trees.nearestGrown(this.x, this.z, 45, (r) => r === 'north', false, this))) {
      this.state = 'wood';
      if (this.fetchWood(dt, 'north', fuel)) this.state = 'mine';
      return;
    }
    const station = g.port('minestation');
    if (this.stack.full || this.state === 'deliver') {
      this.state = 'deliver';
      if (this.unloadAt(station, dt)) this.state = 'mine';
      return;
    }
    // each miner works the deepest open level (richest ore), spread over its veins
    const i = g.workers.filter((w) => w.kind === 'miner').indexOf(this);
    const vein = g.mine.veinFor(i);
    if (!vein) { this.idleAt(this.home.x, this.home.z, dt); return; }
    const d = Math.hypot(vein.x - this.x, vein.z - this.z) || 1;
    const sx = vein.x + ((this.x - vein.x) / d) * (vein.r + 0.9), sz = vein.z + ((this.z - vein.z) / d) * (vein.r + 0.9);
    if (d > vein.r + 1.4) { this.goTo(sx, sz); this.walk(dt); return; }
    this.stop();
    this.strike(vein, dt);
    this.working();
    if (this.t <= 0) {
      this.t = W.minerInterval;
      this.swing = 0.001;
      g.mine.hitVein(vein, this, this.stack);
    }
  }

  /**
   * Fisher (Frozen Lake): keeps the smokehouse running on its own.
   * Priority: deliver what's carried -> fetch logs when the smokehouse is out of fuel ->
   * haul smoked fish to the trader -> fish (breaking frozen holes first).
   */
  private fisher(dt: number) {
    const g = this.game;
    const fishIn = g.port('smokehouse'), fuelIn = g.port('smokehouse_fuel_log'), out = g.port('smokehouse_out'), trader = g.port('fishtrader');
    if (this.state === 'start' || this.state === 'decide') {
      this.bubble.set(null);
      if (this.stack.size) { this.state = 'deliver'; return; }
      const fuelLow = fuelIn && fuelIn.store.count < 3;
      if (fuelLow && g.trees.nearestGrown(this.x, this.z, 40, (r) => r === 'lake', false, this)) this.state = 'wood';
      else if (out && trader && out.store.count >= 4 && trader.store.space() > 0) this.state = 'haul';
      else this.state = 'fish';
    }
    if (this.state === 'deliver') {
      if (!this.stack.size) { if (this.stack.incoming) this.working(); else this.state = 'decide'; return; }
      const type = this.stack.slots[this.stack.size - 1].type;
      const port = type === 'fish' ? fishIn : type === 'log' ? fuelIn : type === 'smokedFish' ? trader : undefined;
      if (!port) { this.stack.clear(); this.state = 'decide'; return; }
      // part of the catch goes to the Warehouse for the stew house (sent from the smokehouse)
      if (type === 'fish' && g.zones.built.has('stewhouse') && g.eco.get('fish') < g.logistics.bankReserve('fish') + 10 && this.distTo(port.x, port.z) <= port.r * 0.8) {
        if (this.t <= 0) { this.t = 0.12; g.bankItem(this.stack, 'fish', port); }
        return;
      }
      if (this.unloadAt(port, dt)) { if (!this.stack.size) this.state = 'decide'; }
      else if (port.store.space() <= 0 && this.arrived) { this.bubble.set('zzz'); this.working(); }
      return;
    }
    if (this.state === 'haul') {
      if (!out || !trader) { this.state = 'decide'; return; }
      if (this.loadAt(out, dt, Math.min(this.stack.cap, trader.store.space()))) this.state = this.stack.size ? 'deliver' : 'decide';
      return;
    }
    if (this.state === 'wood') {
      if (!this.tree || !this.tree.grown) {
        if (this.stack.size >= 2) { this.state = 'deliver'; return; }
        this.tree = g.trees.nearestGrown(this.x, this.z, 40, (r) => r === 'lake', false, this);
        if (!this.tree) { this.state = this.stack.size ? 'deliver' : 'fish'; return; }
        this.tree.reservedBy = this;
      }
      const t = this.tree;
      const d = Math.hypot(t.x - this.x, t.z - this.z) || 1;
      if (d > 1.6) { this.goTo(t.x + ((this.x - t.x) / d) * 1.3, t.z + ((this.z - t.z) / d) * 1.3); this.walk(dt); return; }
      this.stop();
      this.strike(t, dt);
      if (this.t <= 0) {
        this.t = W.chopInterval / g.up.mult('lumberTools');
        this.swing = 0.001;
        const logs = g.trees.hit(t, W.lumberjackDamage, this.x, this.z);
        if (logs > 0) { g.spawnLogsFromTree(t.x, t.z, logs, this); this.tree = null; this.state = 'deliver'; }
      }
      return;
    }
    // fish (deliver every ~8 fish so the smokehouse never waits for a huge basket to fill)
    if (this.stack.full || this.stack.count('fish') >= 8) { g.lake.release(this); this.hole = null; this.state = 'deliver'; return; }
    if (!this.hole || this.hole.claimedBy !== this) this.hole = g.lake.claimHole(this, this.x, this.z, true);
    const h = this.hole;
    if (!h) { if (this.stack.size) this.state = 'deliver'; else this.idleAt(this.home.x, this.home.z, dt); return; }
    // stand on the shore side of the hole
    const d = Math.hypot(h.x - this.x, h.z - this.z) || 1;
    if (d > 1.5) { this.goTo(h.x + ((this.x - h.x) / d) * 1.2, h.z + ((this.z - h.z) / d) * 1.2); this.walk(dt); return; }
    this.stop();
    this.face(h.x, h.z, dt);
    this.working();
    if (h.frozen) {
      this.strike(h, dt);
      if (this.t <= 0) { this.t = W.chopInterval * 1.4; this.swing = 0.001; g.lake.hitIce(h); }
    } else if (g.lake.fishAt(h, dt * 0.8)) {
      g.giveItemTo(this.stack, 'fish', new THREE.Vector3(h.x, 0.6, h.z));
      if (this.stack.size + 1 >= Math.min(this.stack.cap, 8)) { g.lake.release(this); this.hole = null; this.state = 'deliver'; }
    }
  }

  /**
   * Chop a tree in `region` and carry the logs to `port` (a fire box). Returns true when done
   * (logs delivered, or nothing left to chop).
   */
  private fetchWood(dt: number, region: string, port: Port | undefined): boolean {
    const g = this.game;
    if (!port) return true;
    if (this.stack.has('log') && (!this.tree || this.stack.count('log') >= 3)) {
      if (this.tree) { this.tree.reservedBy = null; this.tree = null; }
      if (this.unloadAt(port, dt)) return !this.stack.incoming;
      if (port.store.space() <= 0 && this.arrived) { this.stack.clear(); return true; }
      return false;
    }
    if (!this.tree || !this.tree.grown) {
      this.tree = g.trees.nearestGrown(this.x, this.z, 45, (r) => r === region, false, this);
      if (!this.tree) return !this.stack.has('log');
      this.tree.reservedBy = this;
    }
    const t = this.tree;
    const d = Math.hypot(t.x - this.x, t.z - this.z) || 1;
    if (d > 1.6) { this.goTo(t.x + ((this.x - t.x) / d) * 1.3, t.z + ((this.z - t.z) / d) * 1.3); this.walk(dt); return false; }
    this.stop();
    this.strike(t, dt);
    if (this.t <= 0) {
      this.t = W.chopInterval / g.up.mult('lumberTools');
      this.swing = 0.001;
      const logs = g.trees.hit(t, W.lumberjackDamage, this.x, this.z);
      if (logs > 0) { g.spawnLogsFromTree(t.x, t.z, logs, this); this.tree.reservedBy = null; this.tree = null; }
    }
    return false;
  }

  private guard(dt: number) {
    const g = this.game;
    const B = g.palisade.bounds;
    if (!this.prey || !this.prey.alive || this.distTo(this.prey.x, this.prey.z) > W.guardAggroRadius * 1.5) {
      this.prey = g.nearestEnemy(this.x, this.z, W.guardAggroRadius, (e) => g.palisade.inside(e.x, e.z, -6));
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
    // patrol the inner side of the wall: 8 points (corners + mid-edges), skipping any that a tower or
    // building now stands on (the old corner points were exactly where the corner towers go)
    const x0 = B.x0 + 3.5, x1 = B.x1 - 3.5, z0 = B.z0 + 3.5, z1 = B.z1 - 3.5;
    const pts = [[x1, z1], [x1, 0], [x1, z0], [0, z0], [x0, z0], [x0, 0], [x0, z1], [0, z1]];
    const p = pts[this.patrolI % pts.length];
    const free = g.nav.walkableR(p[0], p[1], 0.6);
    if (!free || this.distTo(p[0], p[1]) < 0.8 || (this.arrived && this.distTo(p[0], p[1]) < 2.5)) this.patrolI++;
    else { this.goTo(p[0], p[1]); this.walk(dt); }
  }
}
