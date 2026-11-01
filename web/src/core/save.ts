import { BALANCE } from '../config/balance';
import { regionDef, type ItemType } from '../config/layout';
import { Platform } from './platform';
import type { QualitySetting } from './quality';

/** Bump when the save layout changes, and add a migration from the previous version below. */
export const SAVE_VERSION = 2;

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
  logistics?: { reserves?: Partial<{ furnaceMinutes: number; counterLogs: number; hutLogs: number }>; emergency?: boolean };
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
    try { localStorage.setItem(`${BALANCE.save.backupKey}-${tag}`, raw); } catch { /* quota */ }
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
