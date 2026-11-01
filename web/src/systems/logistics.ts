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
  private warnT = 0;

  constructor(private game: Game) {}

  // ------------------------------------------------------------------ furnace numbers
  /** logs the furnace burns per minute at the current upgrades */
  get furnaceLogsPerMin() { return (BALANCE.furnace.decayPerSec * 60) / this.game.up.heatPerLog; }
  /** logs that must sit in the furnace box */
  get furnaceTarget() {
    const f = this.game.furnace;
    return Math.min(f?.fuel.cap ?? 0, Math.ceil(this.reserves.furnaceMinutes * this.furnaceLogsPerMin));
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
  counterShort() { const p = this.port('counter'); return !!p && p.store.count + p.store.incoming < this.reserves.counterLogs && p.store.space() > 0; }
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
      let best: Port | undefined, bd = Infinity;
      for (const p of this.game.ports) {
        if (!this.isIndustryLogPort(p) || p.store.space() <= 0) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) return best;
    }
    for (const p of [hut, counter, furnace]) if (p && p.store.space() > 0) return p;
    return hut;
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
    if (counter && counter.store.space() > 0) out.push(counter);
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

  serialize() { return { reserves: this.reserves, emergency: this.emergency }; }
  restore(d: { reserves?: Partial<Reserves>; emergency?: boolean } | undefined) {
    if (!d) return;
    this.reserves = { ...this.reserves, ...d.reserves };
    this.emergency = !!d.emergency;
  }
}
