import { BALANCE } from '../config/balance';
import type { ItemType } from '../config/layout';
import { Platform } from './platform';

export interface SaveData {
  version: 1;
  savedAt: number; // epoch ms
  playTime: number;
  money: number;
  gold: number;
  totalEarned: number;
  heat: number;
  built: string[];
  paid: Record<string, number>;
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
  settings: { music: boolean; sfx: boolean; haptics: boolean };
}

/** SaveSystem — JSON snapshot, autosaved every N seconds and when the app goes to background. */
export class SaveSystem {
  private t = 0;
  private disabled = false;

  constructor(private snapshot: () => SaveData) {
    const flush = () => this.save();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
    (window as any).__frostwoodSave = flush; // called by the iOS host on background
  }

  load(): SaveData | null {
    const raw = Platform.readSave(BALANCE.save.key);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw) as SaveData;
      return d.version === 1 ? d : null;
    } catch { return null; }
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
}
