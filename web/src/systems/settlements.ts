import { CAMP_LEVELS, TIERS, campZoneId, type SettlementTier } from '../config/settlements';
import { regionById } from '../config/layout';
import { events } from '../core/events';
import type { Game } from '../game';
import type { CampFire, CampDepot } from '../buildings/camps';
import type { Port } from './storage';

/** One camp in an opened location (chunk). Its buildings are ordinary zones: camp:<chunk>:<part>. */
export interface Camp {
  tier: 'camp';
  chunk: string;
  name: string;
  level: number;
  fire: CampFire;
}

/**
 * Settlements: the base, region outposts (tier only for now) and location camps in one system.
 * Levels are capped by the parent: a camp by its region's outpost if there is one, else by the base,
 * whose level is the Furnace Level (1-30).
 */
export class Settlements {
  readonly camps = new Map<string, Camp>();
  private saved: Record<string, { level?: number }> = {};

  constructor(private game: Game) {}

  /** Furnace Level 1..30 */
  get baseLevel() { return 1 + (this.game.up.levels.furnace ?? 0); }

  /** Highest level a settlement of this tier may have right now. */
  maxLevel(tier: SettlementTier) {
    if (tier === 'base') return TIERS.base.maxLevel;
    if (tier === 'outpost') return Math.min(TIERS.outpost.maxLevel, this.baseLevel);
    // camps: the highest level whose base requirement is met (outposts will cap this too)
    let l = 1;
    CAMP_LEVELS.forEach((d, i) => { if (this.baseLevel >= d.baseLevel) l = i + 1; });
    return Math.min(TIERS.camp.maxLevel, l);
  }

  camp(chunk: string) { return this.camps.get(chunk); }
  levelDef(c: Camp) { return CAMP_LEVELS[c.level - 1]; }

  /** Called by the camp fire when the camp is founded (or rebuilt from a save). */
  found(chunk: string, fire: CampFire) {
    const name = regionById(chunk)?.name ?? chunk;
    const level = Math.min(this.saved[chunk]?.level ?? 1, this.maxLevel('camp'));
    this.camps.set(chunk, { tier: 'camp', chunk, name, level, fire });
    if (!this.game.loading) events.emit('toast', { text: `🏕️ Camp founded in ${name}! Build a Forest Depot next`, color: '#ffe27a' });
  }

  depot(chunk: string): CampDepot | undefined { return this.game.building<CampDepot>(campZoneId(chunk, 'depot')); }
  depotPort(chunk: string): Port | undefined { return this.game.port(campZoneId(chunk, 'depot')); }
  firePort(chunk: string): Port | undefined { return this.game.port(campZoneId(chunk, 'fire')); }

  /** Where a camp worker drops logs: the fire if it runs low, else the depot, else the fire's box. */
  logDrop(chunk: string): Port | undefined {
    const c = this.camps.get(chunk);
    const fire = this.firePort(chunk), depot = this.depotPort(chunk);
    if (c && fire && c.fire.short) return fire;
    if (depot && depot.store.space() > 0) return depot;
    if (fire && fire.store.space() > 0) return fire;
    return depot ?? fire;
  }

  workers(chunk: string) { return this.game.workers.filter((w) => w.camp === chunk); }

  serialize() {
    const camps: Record<string, { level: number }> = {};
    for (const [k, c] of this.camps) camps[k] = { level: c.level };
    return { camps };
  }
  /** Before zones are rebuilt, so founded camps get their saved level. */
  restore(d: { camps?: Record<string, { level?: number }> } | undefined) {
    this.saved = d?.camps ?? {};
  }
}
