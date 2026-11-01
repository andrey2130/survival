import { BALANCE } from '../config/balance';
import { events } from '../core/events';
import type { Game } from '../game';
import type { Port } from './storage';

const LG = BALANCE.logistics;

export interface Reserves {
  /** minutes of burning kept in the furnace box */
  furnaceMinutes: number;
  /** logs kept on the wood stall */
  counterLogs: number;
  /** logs kept in the camp lumber hut */
  hutLogs: number;
}

/**
 * Who gets a resource first. Life-critical needs are served before income, income before defence,
 * defence before industry:
 *   1) furnace (heat)  2) kitchens & canteen (food)  3) wood stall (sales)  4) wall repair  5) industry.
 * Industry only receives logs once every base reserve is full; "emergency mode" stops industry
 * outright until the base stores are full again.
 */
export class Logistics {
  reserves: Reserves = { ...LG.reserves };
  emergency = false;
  /** share of all logs produced that may go to the wood stall (the rest feeds industry) */
  counterShare: number = LG.counterShare;
  /** logs the stall may still receive (earned as a share of production) */
  counterBudget = 10;
  /** Warehouse goods workshops must leave alone (planks for building, etc.) */
  bankReserves: Record<string, number> = { ...LG.bankReserves };
  private warnT = 0;

  constructor(private game: Game) {
    game.flows.onProduce = (res, n) => { if (res === 'log') this.counterBudget = Math.min(LG.counterBudgetCap, this.counterBudget + n * this.counterShare); };
  }

  bankReserve(res: string) { return this.bankReserves[res] ?? 0; }

  /** A log was delivered to the stall (by anyone). */
  counterFed() { this.counterBudget = Math.max(0, this.counterBudget - 1); }
  /** The stall may take logs now: its share of production isn't used up and its shelf has room. */
  counterOpen() { const p = this.port('counter'); return !!p && p.store.space() > 0 && this.counterBudget >= 1; }

  // ------------------------------------------------------------------ furnace numbers
  /** logs the furnace burns per minute at the current upgrades */
  get furnaceLogsPerMin() { return (BALANCE.furnace.decayPerSec * 60) / this.game.up.heatPerLog; }
  /** logs that must sit in the furnace box (charcoal in the Warehouse counts towards the reserve) */
  get furnaceTarget() {
    const f = this.game.furnace;
    const coalLogs = this.game.eco.get('coal') * BALANCE.goods.coalHeat;
    return Math.max(0, Math.min(f?.fuel.cap ?? 0, Math.ceil(this.reserves.furnaceMinutes * this.furnaceLogsPerMin) - coalLogs));
  }
  /** minutes the fire keeps going with what's in the box (+ current heat) */
  get furnaceMinutesLeft() {
    const f = this.game.furnace;
    if (!f) return 0;
    return (f.fuel.count * this.game.up.heatPerLog + f.heat) / BALANCE.furnace.decayPerSec / 60;
  }
  /** minutes of fuel in the box only (heat excluded) */
  get fuelMinutes() { return (this.game.furnace?.fuel.count ?? 0) / Math.max(0.01, this.furnaceLogsPerMin); }

  // ------------------------------------------------------------------ needs
  private port(id: string) { return this.game.port(id); }
  furnaceShort() { const p = this.port('furnace'); return !!p && p.store.count + p.store.incoming < this.furnaceTarget && p.store.space() > 0; }
  counterShort() { const p = this.port('counter'); return !!p && this.counterOpen() && p.store.count + p.store.incoming < this.reserves.counterLogs; }
  hutShort() { const p = this.port('lumber_in'); return !!p && p.store.count + p.store.incoming < this.reserves.hutLogs && p.store.space() > 0; }

  /** All base wood reserves full → industry may take logs. */
  get baseWoodOk() { return !this.furnaceShort() && !this.counterShort() && !this.hutShort(); }

  /** Can industry (sawmill, smokehouse fire box...) receive this resource from workers right now? */
  industryAllowed(res: string) {
    if (this.emergency) return false;
    return res !== 'log' || this.baseWoodOk;
  }

  /**
   * Where a worker should drop logs: furnace below reserve > stall below reserve > lumber hut below
   * reserve > industry (only if allowed, nearest) > lumber hut > stall > furnace.
   */
  logDrop(x: number, z: number): Port | undefined {
    const furnace = this.port('furnace'), counter = this.port('counter'), hut = this.port('lumber_in');
    if (furnace && this.furnaceShort()) return furnace;
    // emergency: refill the hut (the base's buffer) before feeding the always-hungry stall
    if (this.emergency && hut && this.hutShort()) return hut;
    if (counter && this.counterShort()) return counter;
    if (hut && this.hutShort()) return hut;
    if (this.industryAllowed('log')) {
      const best = this.industryTarget(x, z);
      if (best) return best;
    }
    if (hut && hut.store.space() > 0) return hut;
    if (counter && this.counterOpen()) return counter;
    if (furnace && furnace.store.space() > 0) return furnace;
    return hut;
  }

  /** Logs piling up in the lumber hut above its reserve -> nearest industry log store with room. */
  surplusTarget(x: number, z: number): Port | undefined {
    const hut = this.port('lumber_out');
    if (!hut || hut.store.count <= this.reserves.hutLogs || !this.industryAllowed('log')) return undefined;
    return this.industryTarget(x, z);
  }

  /** Which industry gets logs first: planks > fire boxes > charcoal (lower = earlier). */
  private industryRank(p: Port) {
    if (p.id.startsWith('sawmill')) return 0;
    if (p.id.includes('_fuel_')) return 1;
    if (p.id.startsWith('kiln')) return 3;
    return 2;
  }

  /** Best industry log store with room: by rank, then distance. */
  private industryTarget(x: number, z: number): Port | undefined {
    let best: Port | undefined, bs = Infinity;
    for (const p of this.game.ports) {
      if (!this.isIndustryLogPort(p) || p.store.space() <= 0) continue;
      const score = this.industryRank(p) * 1000 + Math.hypot(p.x - x, p.z - z);
      if (score < bs) { bs = score; best = p; }
    }
    return best;
  }

  /** Log stores of production buildings (inputs and fire boxes), i.e. not the base. */
  isIndustryLogPort(p: Port) {
    return p.mode === 'in' && !p.bank && p.workers && p.store.type === 'log' && !['furnace', 'counter', 'lumber_in'].includes(p.id);
  }

  /** Base targets for carriers / the wood wagon, most urgent first (only ones with room). */
  baseLogTargets(): Port[] {
    const furnace = this.port('furnace'), counter = this.port('counter');
    const out: Port[] = [];
    if (furnace && this.furnaceShort()) out.push(furnace);
    if (counter && this.counterOpen()) out.push(counter);
    if (furnace && furnace.store.space() > 0 && !out.includes(furnace)) out.push(furnace);
    return out;
  }

  /** Producers that count as industry (not food). Paused in emergency mode. */
  isIndustry(kind: string | undefined) { return (kind ?? 'industry') === 'industry'; }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    const g = this.game;
    // emergency ends by itself once the fire box and the lumber hut are stocked again
    // (the stall sells as fast as it's filled, so it can't be the condition)
    if (this.emergency && !this.furnaceShort() && !this.hutShort()) {
      this.emergency = false;
      events.emit('toast', { text: 'Base stores are full — industry restarted ✅', color: '#b8f5a8' });
    }
    // warning: the fire is about to die while industry is still eating logs
    this.warnT -= dt;
    if (this.warnT <= 0 && g.furnace && this.furnaceMinutesLeft < LG.warnMinutes) {
      this.warnT = LG.warnEverySeconds;
      const rates = g.flows.rates().get('log');
      let industry = 0;
      for (const [who, v] of rates ?? []) if (v < 0 && who !== 'furnace' && who !== 'counter' && who !== 'wall repair') industry -= v;
      const text = industry > 0
        ? `🔥 Furnace is dying: ${Math.round(industry)} logs/min go to industry — raise the furnace reserve or hire lumberjacks`
        : '🔥 Furnace is dying — bring logs or hire a carrier / lumberjacks';
      events.emit('logistics:alert', { text });
    }
  }

  serialize() { return { reserves: this.reserves, emergency: this.emergency, counterShare: this.counterShare, bankReserves: this.bankReserves }; }
  restore(d: { reserves?: Partial<Reserves>; emergency?: boolean; counterShare?: number; bankReserves?: Record<string, number> } | undefined) {
    if (!d) return;
    this.reserves = { ...this.reserves, ...d.reserves };
    this.emergency = !!d.emergency;
    if (typeof d.counterShare === 'number') this.counterShare = d.counterShare;
    this.bankReserves = { ...this.bankReserves, ...d.bankReserves };
  }
}
