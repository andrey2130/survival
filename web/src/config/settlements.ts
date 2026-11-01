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

// ------------------------------------------------------------------ location character
export interface TraitDef { name: string; icon: string; desc: string; logMult?: number; hitMult?: number; fell?: Record<string, number>; gather: Record<string, number>; wildMult?: number; huntMult?: number }
export const TRAITS = data.camp.traits as unknown as Record<string, TraitDef>;
const TRAIT_IDS = Object.keys(TRAITS);

/** Trait id of a forest location (named ones from data, others from their position). */
export function traitId(def: RegionDef): string | null {
  if (!campAllowed(def)) return null;
  const a = (CAMP.assign as Record<string, string>)[def.id];
  if (a) return a;
  const h = Math.abs(Math.imul(def.cx * 73856093 ^ def.cz * 19349663, 2654435761)) % TRAIT_IDS.length;
  return TRAIT_IDS[h];
}
export const traitOf = (def: RegionDef): TraitDef | null => { const t = traitId(def); return t ? TRAITS[t] : null; };
/** Production bonus of a camp: further from the base = richer land. */
export const distanceMult = (def: RegionDef) => 1 + CAMP.distanceBonus * Math.max(0, Math.abs(def.cx) + Math.abs(def.cz) - 1);

// ------------------------------------------------------------------ workshops
export interface Recipe { in: Record<string, number>; out: Record<string, number>; seconds: number; until?: Record<string, number> }
export interface WorkshopDef { name: string; icon: string; model: string; desc: string; cost: Record<string, number>; recipes?: Recipe[]; regrow?: number; hires?: Record<string, number>; gather?: number }
export const WORKSHOPS = data.camp.workshops as unknown as Record<string, WorkshopDef>;
export const SLOTS = data.camp.slots as [number, number][];

/** camp:<chunk>:ws<slot>:<type> */
export const workshopZoneId = (chunk: string, slot: number, type: string) => `camp:${chunk}:ws${slot}:${type}`;
export function parseWorkshopId(id: string): { chunk: string; slot: number; type: string } | null {
  const m = /^camp:([^:]+):ws(\d+):([a-z]+)$/.exec(id);
  return m ? { chunk: m[1], slot: Number(m[2]), type: m[3] } : null;
}

/** Zone def of a workshop in a slot (built from the camp tab, never shown as a purchase tile). */
export function workshopZone(def: RegionDef, slot: number, type: string): ZoneDef {
  const w = WORKSHOPS[type];
  const c = campSite(def);
  const [dx, dz] = SLOTS[slot];
  return {
    id: workshopZoneId(def.id, slot, type), kind: 'campworkshop' as BuildingKind, x: c.x + dx, z: c.z + dz, cost: 0, currency: 'money',
    region: def.id, label: w.name, icon: 'camp', params: { producer: type, clear: 3.4 },
  };
}

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
  const ws = parseWorkshopId(id);
  if (ws) {
    const def = regionById(ws.chunk);
    return def && campAllowed(def) && WORKSHOPS[ws.type] && SLOTS[ws.slot] ? workshopZone(def, ws.slot, ws.type) : null;
  }
  const m = parseCampId(id);
  const def = m && regionById(m.chunk);
  if (!m || !def || !(m.part in PARTS) || !campAllowed(def)) return null;
  return campZone(def, m.part as CampPart);
}
