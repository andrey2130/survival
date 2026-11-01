// Settlement tiers (base / outpost / camp) and camp layouts. The data lives in data/settlements.json.

import data from '../data/settlements.json';
import { CHUNK, regionById, type RegionDef, type ZoneDef, type BuildingKind, type IconId } from './layout';

export type SettlementTier = 'base' | 'outpost' | 'camp';
export type CampPart = keyof typeof data.camp.buildings;

export interface TierDef { name: string; maxLevel: number; scope: 'world' | 'biome' | 'chunk'; parent?: SettlementTier }
export interface CampLevelDef { slots: number; workers: number; baseLevel: number }
interface CampBuildingDef { label: string; kind: string; icon: string; at: number[]; cost: number; items?: Record<string, number>; requires?: string[]; cap?: number; hires?: number }

export const TIERS = data.tiers as Record<SettlementTier, TierDef>;
export const CAMP = data.camp;
export const CAMP_LEVELS = data.camp.levels as CampLevelDef[];
export const CAMP_PARTS = Object.keys(data.camp.buildings) as CampPart[];
const PARTS = data.camp.buildings as Record<CampPart, CampBuildingDef>;

/** Can this chunk hold a camp? (opened forest locations, not the base itself) */
export function campAllowed(def: RegionDef) {
  return def.id !== 'camp' && CAMP.biomes.includes(def.biome);
}

/** World position of a chunk's camp centre. */
export function campSite(def: RegionDef): { x: number; z: number } {
  const s = (CAMP.sites as Record<string, number[]>)[def.id];
  return s ? { x: s[0], z: s[1] } : { x: def.cx * CHUNK, z: def.cz * CHUNK };
}

export const campZoneId = (chunk: string, part: CampPart) => `camp:${chunk}:${part}`;
/** `camp:<chunk>:<part>` -> parts, or null for any other zone / port id */
export function parseCampId(id: string): { chunk: string; part: string } | null {
  const m = /^camp:([^:]+):([a-z]+)/.exec(id);
  return m ? { chunk: m[1], part: m[2] } : null;
}

export const partDef = (part: CampPart) => PARTS[part];

/** Purchase zone of one camp building in a chunk. */
export function campZone(def: RegionDef, part: CampPart): ZoneDef {
  const p = PARTS[part];
  const c = campSite(def);
  const k = 1 + CAMP.distanceCost * Math.max(0, Math.abs(def.cx) + Math.abs(def.cz) - 1);
  const items: Record<string, number> = {};
  for (const [r, n] of Object.entries(p.items ?? {})) items[r] = Math.ceil(n * k);
  return {
    id: campZoneId(def.id, part), kind: p.kind as BuildingKind, x: c.x + p.at[0], z: c.z + p.at[1],
    cost: Math.round((p.cost * k) / 50) * 50, currency: 'money', items,
    requires: (p.requires ?? []).map((r) => campZoneId(def.id, r as CampPart)),
    region: def.id, label: part === 'fire' ? `${p.label}: ${def.name}` : p.label, icon: p.icon as IconId,
    params: { clear: 3.4 },
  };
}

/** Zone def for a saved camp zone id (loading). */
export function campZoneById(id: string): ZoneDef | null {
  const m = parseCampId(id);
  const def = m && regionById(m.chunk);
  if (!m || !def || !(m.part in PARTS) || !campAllowed(def)) return null;
  return campZone(def, m.part as CampPart);
}
