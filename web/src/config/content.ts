// Typed access to the JSON content (resources, biomes, producers, recipes) + a validator that
// catches broken references when new content is added. Errors show in the console and the debug panel.
import resourcesData from '../data/resources.json';
import regionsData from '../data/regions.json';
import producersData from '../data/producers.json';
import upgradesData from '../data/upgrades.json';
import { BALANCE } from './balance';
import { ZONES, CHUNK_RANGE, regionDef, type ResId, type BuildingKind } from './layout';

export interface ResourceDef {
  id: ResId;
  name: string;
  kind: 'currency' | 'item' | 'derived';
  icon: string;
  /** key of a hand-drawn SVG in ui/icons.ts */
  svg?: string;
  biome: string;
  color?: string;
  accent?: string;
  shape?: string;
  /** stack spacing when carried */
  height?: number;
  bankable?: boolean;
  value?: number;
  /** derived: items summed for the HUD counter */
  items?: ResId[];
}

export interface BiomeDef {
  id: string;
  order: number;
  name: string;
  color: string;
  available: boolean;
  story: string;
  unlockZone?: string;
  resources: ResId[];
  hud: ResId[];
  enemies: string[];
  boss: string | null;
}

export interface StoreSpec { cap: number; port: [number, number, number]; pile: [number, number, number]; layout: [number, number, number, number, number]; bank?: boolean }
export interface ProducerDef {
  name: string;
  /** food = base priority; industry (default) waits for base reserves and pauses in emergency mode */
  class?: 'food' | 'industry';
  model: string;
  footprint: [number, number];
  recipe: string;
  speedUpgrade?: string;
  tend?: string;
  inputs: Record<ResId, StoreSpec>;
  output: Partial<StoreSpec> & { currencyPile?: [number, number]; unit?: number; visualCap?: number; bank?: boolean; dispatch?: boolean };
  /** optional fuel: seconds of burn per unit for each accepted fuel */
  fuel?: { burn: Record<ResId, number>; cap: number; port: [number, number, number]; pile: [number, number, number]; bankFuel?: Record<ResId, number> };
  upgradeCostMult?: number;
}

export interface RecipeDef { in: Record<ResId, number>; out: Record<ResId, number>; seconds: number; incomeBoost?: string }

export const RESOURCES = resourcesData.resources as ResourceDef[];
export const BIOMES = (regionsData.biomes as BiomeDef[]).sort((a, b) => a.order - b.order);
export const PRODUCERS = producersData.producers as unknown as Record<string, ProducerDef>;
export const RECIPES = BALANCE.recipes as Record<string, RecipeDef>;

const resMap = new Map(RESOURCES.map((r) => [r.id, r]));
export const res = (id: ResId): ResourceDef => resMap.get(id) ?? { id, name: id, kind: 'item', icon: '📦', biome: 'forest' };
export const isCurrency = (id: ResId) => res(id).kind === 'currency';
export const biome = (id: string) => BIOMES.find((b) => b.id === id) ?? BIOMES[0];
export const biomeOfChunk = (chunkId: string) => {
  for (const c of Object.values(regionsData.chunks)) if (c.id === chunkId) return biome(c.biome);
  return BIOMES[0];
};

const KINDS: BuildingKind[] = ['furnace', 'stall', 'tent', 'tower', 'cannon', 'firetrap', 'diner', 'lumberhut', 'house', 'expansion', 'worker', 'perk',
  'minestation', 'rail', 'cart', 'stonewall', 'monument', 'campwall', 'wagon', 'producer', 'warehouse', 'trader', 'lumbercrew', 'minelevel', 'lantern', 'campside', 'market', 'tradepost'];

/** Cross-checks every reference in the content files. Returns human-readable problems. */
export function validateContent(): string[] {
  const errs: string[] = [];
  const zoneIds = new Set(ZONES.map((z) => z.id));
  const chunkIds = new Set(Object.values(regionsData.chunks).map((c) => c.id));
  const known = (id: string) => resMap.has(id);
  const chunkOk = (id: string) => chunkIds.has(id) || /^c-?\d+_-?\d+$/.test(id);
  const seen = new Set<string>();
  for (const z of ZONES) {
    if (seen.has(z.id)) errs.push(`zone ${z.id}: duplicate id`);
    seen.add(z.id);
    if (!KINDS.includes(z.kind)) errs.push(`zone ${z.id}: unknown kind "${z.kind}"`);
    for (const r of z.requires ?? []) if (!zoneIds.has(r)) errs.push(`zone ${z.id}: requires unknown zone "${r}"`);
    if (!chunkOk(z.region)) errs.push(`zone ${z.id}: unknown region "${z.region}"`);
    if (!known(z.currency)) errs.push(`zone ${z.id}: unknown currency "${z.currency}"`);
    for (const r of Object.keys(z.items ?? {})) if (!known(r)) errs.push(`zone ${z.id}: unknown item "${r}"`);
    if (z.kind === 'producer' && !PRODUCERS[z.params?.producer ?? '']) errs.push(`zone ${z.id}: unknown producer "${z.params?.producer}"`);
    if (z.params?.opens && !chunkOk(z.params.opens)) errs.push(`zone ${z.id}: opens unknown region "${z.params.opens}"`);
  }
  for (const [id, p] of Object.entries(PRODUCERS)) {
    const r = RECIPES[p.recipe];
    if (!r) { errs.push(`producer ${id}: unknown recipe "${p.recipe}"`); continue; }
    for (const k of Object.keys(r.in)) if (!p.inputs[k]) errs.push(`producer ${id}: recipe input "${k}" has no input store`);
    for (const k of Object.keys(p.fuel?.burn ?? {})) if (!known(k)) errs.push(`producer ${id}: unknown fuel "${k}"`);
  }
  for (const [id, r] of Object.entries(RECIPES)) for (const k of [...Object.keys(r.in), ...Object.keys(r.out)]) if (!known(k)) errs.push(`recipe ${id}: unknown resource "${k}"`);
  for (const b of BIOMES) for (const k of [...b.resources, ...b.hud]) if (!known(k)) errs.push(`biome ${b.id}: unknown resource "${k}"`);
  for (const c of Object.values(regionsData.chunks)) if (!BIOMES.some((b) => b.id === c.biome)) errs.push(`chunk ${c.id}: unknown biome "${c.biome}"`);
  for (const u of upgradesData.upgrades) {
    if (u.requires && !zoneIds.has(u.requires)) errs.push(`upgrade ${u.id}: requires unknown zone "${u.requires}"`);
    if (!known(u.currency)) errs.push(`upgrade ${u.id}: unknown currency "${u.currency}"`);
  }
  for (const k of Object.keys(regionsData.chunks)) {
    const [cx, cz] = k.split(',').map(Number);
    if (Math.abs(cx) > CHUNK_RANGE || Math.abs(cz) > CHUNK_RANGE) errs.push(`chunk ${k}: outside the world`);
    else if (regionDef(cx, cz).id !== (regionsData.chunks as Record<string, { id: string }>)[k].id) errs.push(`chunk ${k}: lookup mismatch`);
  }
  for (const e of errs) console.warn('[content]', e);
  return errs;
}
