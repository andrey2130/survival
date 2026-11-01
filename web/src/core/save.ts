import { BALANCE } from '../config/balance';
import { regionDef, type ItemType } from '../config/layout';
import { Platform } from './platform';
import type { QualitySetting } from './quality';

/** Bump when the save layout changes, and add a migration from the previous version below. */
export const SAVE_VERSION = 3;

export interface SaveData {
  version: number;
  savedAt: number; // epoch ms
  playTime: number;
  /** banked resources: money, gold, planks... */
  bank: Record<string, number>;
  totalEarned: number;
  heat: number;
  built: string[];
  paid: Record<string, number>;
  paidItems: Record<string, Record<string, number>>;
  upgrades: Record<string, number>;
  buildings: Record<string, Record<string, number>>;
  palisade: { stone: boolean; hp: number[] };
  waves: { wave: number; timer: number };
  player: { x: number; z: number; hp: number; stack: ItemType[] };
  population: number;
  mood: number;
  tutorial: number;
  pickups: { t: ItemType; x: number; z: number }[];
  doubleIncomeLeft: number;
  iap: { adsRemoved: boolean; starterPack: boolean };
  settings: GameSettings;
  /** Frozen Lake state (holes, orca timer) — optional, older saves don't have it */
  /** base reserves / emergency mode (Logistics screen) — optional for older saves */
  logistics?: { reserves?: Partial<{ furnaceMinutes: number; counterLogs: number; hutLogs: number }>; emergency?: boolean; counterShare?: number; bankReserves?: Record<string, number> };
  /** names, special traits and jobs of residents — optional */
  residents?: { v?: number; next?: number; people?: { id: number; name: string; special: string | null; prof: string; hired: boolean; zone?: string }[] };
  /** market sell list and trading post deals — optional */
  trade?: { goods?: Record<string, { sell: boolean; reserve: number }>; offers?: { give: Record<string, number>; get: Record<string, number>; uses: number }[]; refreshT?: number };
  /** research tree — optional */
  research?: { done?: string[]; current?: { id: string; t: number } | null };
  /** residents away on expeditions — optional */
  expeditions?: { list?: unknown[] };
  /** gold mine: golem respawn timer — optional */
  mine?: { golem?: number };
  /** camps in opened locations (their buildings are in `built`) — v3 */
  settlements?: { camps?: Record<string, { level?: number; stock?: Record<string, number>; route?: { tier?: number; level?: number; rules?: Record<string, { send: boolean; keep: number }> } }>; auto?: boolean };
  lake?: { orca: number; holes: { frozen: boolean; catches: number; ice: number }[] };
}

/** Older saves only have music/sfx/haptics; the rest falls back to the defaults in Game. */
export interface GameSettings {
  music: boolean;
  sfx: boolean;
  haptics: boolean;
  quality: QualitySetting;
  /** 30 FPS cap to save battery */
  battery: boolean;
  /** camera shake on big hits */
  shake: boolean;
}

type AnySave = Record<string, any>;

/**
 * Migrations: MIGRATIONS[n] turns a version-n save into version n+1. Old saves are walked up one
 * version at a time, so every save ever written keeps loading after updates.
 */
const MIGRATIONS: Record<number, (d: AnySave) => AnySave> = {
  // v1 -> v2: generic resource bank, data-driven producers, chunks reserved for future biomes
  1: (d) => {
    d.bank = { money: d.money ?? 0, gold: d.gold ?? 0 };
    delete d.money;
    delete d.gold;
    const b = (d.buildings ??= {});
    if (b.kitchen) b.kitchen = { in_meat: b.kitchen.input ?? 0, out: b.kitchen.output ?? 0 };
    if (b.smelter) b.smelter = { in_ore: b.smelter.ore ?? 0, cash: b.smelter.gold ?? 0 };
    d.paidItems = {};
    // generic land bought where a biome now lives: refund it (the biome opens later through its own zone)
    d.built = (d.built ?? []).filter((id: string) => {
      const m = /^exp_c(-?\d+)_(-?\d+)$/.exec(id);
      if (!m || regionDef(Number(m[1]), Number(m[2])).id.startsWith('c')) return true;
      d.bank.money += 2500;
      return false;
    });
    d.version = 2;
    return d;
  },
  // v2 -> v3: one Furnace Level (1-30) replaces Furnace Bellows (+15%/lv) and Great Furnace (+20%/lv):
  // the bought levels become the Furnace Level with the same heat per log (+25%/lv); settlements (camps)
  2: (d) => {
    const u = (d.upgrades ??= {});
    const mult = (1 + 0.15 * (u.furnaceEff ?? 0)) * (1 + 0.2 * (u.furnaceLevel ?? 0));
    const lv = Math.max(0, Math.min(29, Math.ceil((mult - 1) / 0.25 - 0.01))); // never less heat than before
    delete u.furnaceEff;
    delete u.furnaceLevel;
    if (lv > 0) u.furnace = lv;
    d.settlements ??= { camps: {} };
    d.version = 3;
    return d;
  },
};

/** Validate + upgrade any save object to the current version. Throws on garbage or saves from a newer game. */
export function migrate(input: unknown): SaveData {
  if (!input || typeof input !== 'object') throw new Error('not a save');
  let d = input as AnySave;
  if (typeof d.version !== 'number' || !Array.isArray(d.built)) throw new Error('not a Frostwood save');
  if (d.version > SAVE_VERSION) throw new Error(`save is from a newer game version (v${d.version})`);
  while (d.version < SAVE_VERSION) {
    const m = MIGRATIONS[d.version];
    if (!m) throw new Error(`no migration from v${d.version}`);
    d = m(d);
  }
  return d as SaveData;
}

const PREFIX = 'FWC:';
const toB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/** SaveSystem — JSON snapshot, autosaved every N seconds and when the app goes to background. */
export class SaveSystem {
  private t = 0;
  private disabled = false;
  /** problem found while loading (shown as a toast) */
  loadError = '';
  /** version the save had on disk before migrating */
  loadedVersion = 0;

  constructor(private snapshot: () => SaveData) {
    const flush = () => this.save();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
    (window as any).__frostwoodSave = flush; // called by the iOS host on background
  }

  load(): SaveData | null {
    const raw = Platform.readSave(BALANCE.save.key);
    if (!raw) return null;
    let parsed: AnySave;
    try { parsed = JSON.parse(raw); } catch {
      this.backup(raw, 'corrupt');
      this.loadError = 'Save file was damaged — a backup was kept, starting fresh';
      return null;
    }
    this.loadedVersion = parsed.version;
    if (parsed.version < SAVE_VERSION) this.backup(raw, `v${parsed.version}`);
    try { return migrate(parsed); } catch (e) {
      // never overwrite a save we can't read (e.g. from a newer build)
      this.disabled = true;
      this.loadError = `Can't load save: ${(e as Error).message}. Saving is paused.`;
      return null;
    }
  }

  private backup(raw: string, tag: string) {
    try {
      // never overwrite the first copy of an old version (that's the one "restore" brings back)
      const key = `${BALANCE.save.backupKey}-${tag}`;
      if (tag === 'corrupt' || !localStorage.getItem(key)) localStorage.setItem(key, raw);
    } catch { /* quota */ }
  }

  /** The save as it was before the last update that changed its layout (v2 before v3...). */
  preUpdateBackup(): { version: number; savedAt: number; raw: string } | null {
    for (let v = SAVE_VERSION - 1; v >= 1; v--) {
      let raw: string | null = null;
      try { raw = localStorage.getItem(`${BALANCE.save.backupKey}-v${v}`); } catch { /* ignore */ }
      if (!raw) continue;
      try { const d = JSON.parse(raw); return { version: v, savedAt: d.savedAt ?? 0, raw }; } catch { /* damaged */ }
    }
    return null;
  }

  /** Put the pre-update backup back as the current save (it's migrated again on the next load). */
  restorePreUpdate(): boolean {
    const b = this.preUpdateBackup();
    if (!b) return false;
    const d = JSON.parse(b.raw);
    d.savedAt = Date.now(); // newer than the iOS host's copy, so it wins on the next start
    this.disabled = true;
    Platform.writeSave(BALANCE.save.key, JSON.stringify(d));
    return true;
  }

  save() {
    if (this.disabled) return;
    try { Platform.writeSave(BALANCE.save.key, JSON.stringify(this.snapshot())); } catch (e) { console.warn('save failed', e); }
  }

  update(dt: number) {
    this.t += dt;
    if (this.t >= BALANCE.save.autosaveSeconds) { this.t = 0; this.save(); }
  }

  reset() {
    this.disabled = true;
    Platform.clearSave(BALANCE.save.key);
  }

  /** Compact text for the clipboard. */
  exportString() { return PREFIX + toB64(JSON.stringify(this.snapshot())); }

  /** Accepts an exported string (or raw JSON), validates/migrates it and writes it as the current save. */
  importString(text: string) {
    const t = text.trim();
    const json = t.startsWith(PREFIX) ? fromB64(t.slice(PREFIX.length)) : t;
    const d = migrate(JSON.parse(json));
    d.savedAt = Date.now();
    this.disabled = true; // stop the running game from overwriting it before the reload
    Platform.writeSave(BALANCE.save.key, JSON.stringify(d));
  }
}
