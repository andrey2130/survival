import { BALANCE } from '../config/balance';
import type { WorkerKind } from '../config/layout';
import { biomeOfChunk } from '../config/content';
import { events } from '../core/events';
import { rand, pick } from '../core/math';
import type { Game } from '../game';
import type { Worker } from '../entities/worker';
import type { Survivor } from '../entities/survivor';

const R = BALANCE.residents;
export type Profession = WorkerKind | 'smith' | 'idle';
export type SpecialEffect = 'meat' | 'meals' | 'ore' | 'speed' | 'heat' | 'heal';

/** One person living in the camp — the same record whether idle (Survivor) or working (Worker). */
export interface Resident {
  id: number;
  name: string;
  special: string | null;
  /** hired through a purchase zone (doesn't count against housing) */
  hired: boolean;
  zone?: string;
  warmth: number;
  food: number;
  rest: number;
  health: number;
  mood: number;
  sick: boolean;
  /** seconds of treatment left at the infirmary */
  healing: number;
  /** seconds of nap left (tired workers) */
  napT: number;
  /** load bookkeeping */
  restored?: boolean;
  /** seconds of "had a good stew" mood bonus left */
  stewT?: number;
}

const NAMES = ['Anya', 'Bohdan', 'Dara', 'Eryk', 'Fedir', 'Halyna', 'Ihor', 'Kira', 'Lev', 'Marta', 'Nazar', 'Oksana', 'Petro', 'Roksi', 'Stas',
  'Tamara', 'Vira', 'Yarema', 'Zoya', 'Arne', 'Brit', 'Eli', 'Ingrid', 'Jonas', 'Kai', 'Liv', 'Nils', 'Oda', 'Sven', 'Tove', 'Ulla', 'Mykola', 'Solomiia', 'Taras', 'Ivanka'];

/** Building that hosts a profession (assigned workers start there). */
const WORKPLACE: Record<string, string> = {
  lumberjack: 'lumberhut', carrier: 'lumberhut', cook: 'kitchen', cashier: 'counter', hunter: 'kitchen',
  fisher: 'smokehouse', miner: 'minestation', guard: 'tower1', smith: 'forge',
};

interface SavedPerson { id: number; name: string; special: string | null; prof: Profession | string; hired: boolean; zone?: string }

/**
 * Residents: needs (warmth, food, rest, health) -> mood -> work speed & income; sickness and the
 * infirmary; professions (idle residents can be assigned to jobs that have a workplace); named
 * special residents with camp-wide bonuses; wild herbs for medicine.
 */
export class Residents {
  private nextId = 1;
  private tickT = 0;
  private warmT = 0;
  private herbT = 5;
  private warmSpots: { x: number; z: number; r: number }[] = [];
  /** bonuses from special residents present in the camp */
  private bonuses = new Map<SpecialEffect, number>();

  constructor(private game: Game) {}

  // ------------------------------------------------------------------ people
  create(hired = false, zone?: string): Resident {
    const taken = new Set(this.people().map((r) => r.name));
    const free = NAMES.filter((n) => !taken.has(n));
    return {
      id: this.nextId++, name: free.length ? pick(free) : `${pick(NAMES)} ${this.nextId}`, special: null, hired, zone,
      warmth: 1, food: 1, rest: 1, health: 1, mood: 1, sick: false, healing: 0, napT: 0,
    };
  }

  /** Bodies that are residents (idle survivors + every worker). */
  bodies(): (Survivor | Worker)[] {
    const g = this.game;
    const out: (Survivor | Worker)[] = [];
    for (const s of g.survivors.list) if (s.res && s.state !== 'leave') out.push(s);
    for (const w of g.workers) if (w.res) out.push(w);
    return out;
  }
  people(): Resident[] { return this.bodies().map((b) => b.res!); }
  professionOf(b: Survivor | Worker): Profession { return 'kind' in b ? (b as Worker).kind : 'idle'; }

  /** A newcomer may be someone special (one of each). */
  maybeSpecial(r: Resident, force = false) {
    const present = new Set(this.people().map((p) => p.special).filter(Boolean));
    const left = R.specials.filter((s) => !present.has(s.id));
    if (!left.length || (!force && Math.random() > R.specialChance)) return;
    const s = pick(left);
    r.special = s.id;
    r.name = s.name;
    events.emit('toast', { text: `⭐ ${s.name} joined the camp: ${s.trait}`, color: '#ffe27a' });
  }

  special(id: string | null) { return id ? R.specials.find((s) => s.id === id) : undefined; }
  bonus(e: SpecialEffect) { return this.bonuses.get(e) ?? 0; }
  /** work speed from mood (and Swift Lina) */
  workMult(r: Resident | undefined) {
    if (!r) return 1;
    return (R.workSpeedMin + (R.workSpeedMax - R.workSpeedMin) * r.mood) * (1 + this.bonus('speed'));
  }
  get healMult() { return (1 + this.bonus('heal')) * (1 + this.game.research.value('heal')); }
  get avgMood() { const p = this.people(); return p.length ? p.reduce((n, r) => n + r.mood, 0) / p.length : 1; }
  avg(k: 'warmth' | 'food' | 'rest' | 'health') { const p = this.people(); return p.length ? p.reduce((n, r) => n + r[k], 0) / p.length : 1; }
  get sickCount() { return this.people().filter((r) => r.sick).length; }

  // ------------------------------------------------------------------ professions
  workplace(kind: Profession): { x: number; z: number } | null {
    const id = WORKPLACE[kind];
    const b = id && (this.game.buildings.get(id) ?? [...this.game.buildings.values()].find((q) => q.def.params?.producer === id));
    return b ? { x: b.def.x + rand(-1.5, 1.5), z: b.def.z + 2.6 } : null;
  }

  /** count / max / unlocked for a profession */
  professionInfo(kind: Profession) {
    const P = (R.professions as Record<string, { needs: string; extra: number; base?: boolean }>)[kind];
    const workers = this.game.workers.filter((w) => w.kind === kind);
    const hired = workers.filter((w) => w.res?.hired).length;
    const unlocked = !!P && !!this.workplace(kind);
    return { count: workers.length, max: hired + (unlocked ? P.extra : 0), unlocked, needs: P?.needs ?? '', base: !!P?.base };
  }

  idleSurvivors() { return this.game.survivors.list.filter((s) => s.res && s.state === 'idle' && !s.res.sick && !s.visitor); }

  /** Turn an idle resident into a worker of `kind` (if there's a free place). */
  assign(kind: WorkerKind, quiet = false): boolean {
    const g = this.game;
    const info = this.professionInfo(kind);
    if (!info.unlocked || info.count >= info.max) return false;
    const s = this.idleSurvivors()[0];
    const at = this.workplace(kind);
    if (!s || !at) return false;
    const res = s.res!;
    g.survivors.remove(s);
    const w = g.hireWorker(kind, at.x, at.z, res);
    w.x = s.x; w.z = s.z;
    if (!quiet) events.emit('toast', { text: `${res.name} is now a ${kind}`, color: '#b8f5a8' });
    return true;
  }

  /** Send a worker back to idle life (zone-hired workers can't be dismissed — their job is their reason to be here). */
  unassign(w: Worker): boolean {
    const g = this.game;
    if (!w.res || w.res.hired) return false;
    const res = w.res;
    w.retire();
    g.survivors.addResident(res, w.x, w.z);
    return true;
  }

  /** Fill professions in priority order (base roles first) with idle residents. */
  autoAssign() {
    let n = 0;
    for (const kind of R.autoOrder as WorkerKind[]) {
      while (this.assign(kind, true)) n++;
    }
    events.emit('toast', { text: n ? `${n} residents got a job` : 'No free jobs or idle residents', color: '#b8f5a8' });
    return n;
  }

  // ------------------------------------------------------------------ needs
  private refreshWarmSpots() {
    const g = this.game, spots: { x: number; z: number; r: number }[] = [];
    for (const p of g.producers) if (p.spec.fuel && (p.burn > 0 || p.fuelLeftPublic > 0)) spots.push({ x: p.def.x, z: p.def.z, r: R.warmRadius });
    for (const b of g.buildings.values()) if (b.def.kind === 'lantern' || b.def.kind === 'minestation' || b.def.kind === 'trader') spots.push({ x: b.def.x, z: b.def.z, r: R.warmRadius });
    this.warmSpots = spots;
  }

  private isWarm(x: number, z: number) {
    const g = this.game;
    if (g.heat > 0 && g.palisade.inside(x, z)) return true;
    for (const s of this.warmSpots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < s.r * s.r) return true;
    return false;
  }

  // ------------------------------------------------------------------ goods from the Warehouse
  /** share of residents that have a warm coat (0..1) */
  get coatCover() { const n = Math.max(1, this.people().length); return Math.min(1, this.game.eco.get('coat') / n); }
  /** share of homes that are furnished (0..1) */
  get furnitureCover() { const h = Math.max(1, this.game.survivors.homes.length); return Math.min(1, this.game.eco.get('furniture') / h); }
  private coatWear = 0;

  /** Workers eat rations from the canteen / meat stall / a kitchen pass without walking there. */
  private ration(r?: Resident): boolean {
    const g = this.game;
    // fish stew from the Warehouse first: fills better and cheers people up
    if (g.eco.get('stew') >= 1) {
      g.eco.add('stew', -1);
      g.flows.add('stew', -1, 'rations');
      if (r) r.stewT = BALANCE.goods.stewMoodSeconds;
      return true;
    }
    for (const id of ['diner', 'meatstall', ...g.kitchens.map((k) => `${k.def.id}_out`)]) {
      const p = g.port(id);
      if (p && p.store.take()) { g.flows.add('cooked', -1, 'rations'); return true; }
    }
    return false;
  }

  private tick(dt: number) {
    const g = this.game;
    const night = g.world.night01;
    const foodOn = g.kitchens.length > 0;
    const GD = BALANCE.goods;
    const coatK = (1 - GD.coatWarmth * this.coatCover) * Math.max(0.2, 1 - g.research.value('warmth')), restK = 1 + GD.furnitureRest * this.furnitureCover;
    // coats wear out with use
    const wearers = this.people().length * this.coatCover;
    this.coatWear += (wearers * dt) / GD.coatLifeSeconds;
    if (this.coatWear >= 1) { const n = Math.floor(this.coatWear); this.coatWear -= n; g.eco.add('coat', -Math.min(n, g.eco.get('coat'))); g.flows.add('coat', -n, 'worn out'); }
    for (const b of this.bodies()) {
      const r = b.res!;
      const worker = 'kind' in b;
      // warmth
      if (this.isWarm(b.x, b.z)) r.warmth = Math.min(1, r.warmth + R.warmthGain * dt);
      else r.warmth = Math.max(0, r.warmth - (R.warmthLoss + R.warmthLossNight * night) * coatK * dt);
      // food
      if (foodOn) {
        r.food = Math.max(0, r.food - R.foodLoss * dt * (1 - g.research.value('food')));
        if (r.food < R.rationAt && (worker || !g.diner || g.eco.get('stew') >= 1) && this.ration(r)) r.food = 1;
      } else r.food = 1;
      // rest: workers tire, idle people recover (faster at night)
      if (worker && r.napT <= 0) r.rest = Math.max(0, r.rest - R.restLossWork * dt);
      else r.rest = Math.min(1, r.rest + R.restGainIdle * dt * (worker ? 2.5 : 1 + night) * restK);
      if (worker && r.rest < R.napBelow && r.napT <= 0 && !r.sick) r.napT = R.napSeconds;
      // health
      const cold = r.warmth < 0.25, hungry = r.food < 0.15;
      if (cold) r.health -= R.healthLossCold * dt;
      if (hungry) r.health -= R.healthLossHungry * dt;
      if (!cold && !hungry) r.health += R.healthRegen * dt * (r.sick ? 0.5 : 1);
      r.health = Math.max(0, Math.min(1, r.health));
      if (!r.sick && r.health < R.sickBelow) { r.sick = true; events.emit('toast', { text: `🤒 ${r.name} fell ill${g.port('infirmary_out') ? '' : ' — build an Infirmary'}`, color: '#ffd0a8' }); }
      if (r.sick && r.health >= 0.9) r.sick = false;
      // mood from needs
      const W = R.weights;
      r.mood = W.warmth * r.warmth + W.food * r.food + W.rest * r.rest + W.health * r.health;
      if (r.stewT && r.stewT > 0) { r.stewT -= dt; r.mood = Math.min(1, r.mood + GD.stewMood); }
    }
    // camp-wide bonuses of special residents
    this.bonuses.clear();
    for (const p of this.people()) {
      const s = this.special(p.special);
      if (s) this.bonuses.set(s.effect as SpecialEffect, (this.bonuses.get(s.effect as SpecialEffect) ?? 0) + s.value);
    }
    g.up.heatBonus = this.bonus('heat');
  }

  update(dt: number) {
    const g = this.game;
    this.warmT -= dt;
    if (this.warmT <= 0) { this.warmT = 2; this.refreshWarmSpots(); }
    this.tickT += dt;
    if (this.tickT >= 0.25) { this.tick(this.tickT); this.tickT = 0; }
    // wild frost herbs grow back in open forest chunks (medicine for the infirmary)
    this.herbT -= dt;
    if (this.herbT <= 0) {
      this.herbT = R.herbRespawn;
      for (const r of g.world.openRegions()) {
        if (r.id === 'camp' || biomeOfChunk(r.id).id !== 'forest') continue;
        const [x0, z0, x1, z1] = r.rect;
        const have = g.pickups.list.filter((p) => p.type === 'herb' && p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1).length;
        if (have >= R.herbsPerChunk) continue;
        for (let k = 0; k < 20; k++) {
          const x = rand(x0 + 4, x1 - 4), z = rand(z0 + 4, z1 - 4);
          if (g.nav.walkable(x, z)) { g.pickups.spawn('herb', x, z, undefined, 900); break; }
        }
      }
    }
  }

  // ------------------------------------------------------------------ save
  serialize() {
    const g = this.game;
    const people: SavedPerson[] = this.bodies().map((b) => ({ id: b.res!.id, name: b.res!.name, special: b.res!.special, prof: this.professionOf(b), hired: b.res!.hired, zone: b.res!.zone }));
    return { next: this.nextId, people, idle: g.survivors.list.filter((s) => s.res).length };
  }

  /**
   * After zones (hired workers) and idle residents exist: give everyone their saved name / trait and
   * turn idle residents back into the workers they had been assigned as.
   */
  restore(d: { next?: number; people?: SavedPerson[] } | undefined) {
    if (!d?.people) return;
    const g = this.game;
    this.nextId = Math.max(this.nextId, d.next ?? 1);
    const apply = (r: Resident, p: SavedPerson) => { r.id = p.id; r.name = p.name; r.special = p.special; };
    for (const p of d.people.filter((q) => q.hired)) {
      const w = g.workers.find((q) => !!q.res && q.res.zone === p.zone && !q.res.restored);
      if (w?.res) { apply(w.res, p); w.res.restored = true; }
    }
    const assigned = d.people.filter((q) => !q.hired && q.prof !== 'idle');
    for (const p of assigned) {
      if (this.assign(p.prof as WorkerKind, true)) {
        const w = g.workers[g.workers.length - 1];
        if (w.res) apply(w.res, p);
      }
    }
    const idle = d.people.filter((q) => q.prof === 'idle');
    g.survivors.list.filter((s) => s.res && !s.visitor).forEach((s, i) => { if (idle[i]) apply(s.res!, idle[i]); });
  }
}
