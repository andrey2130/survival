import upgradesData from '../data/upgrades.json';
import type { Currency } from './layout';

export type UpgradeTab = 'player' | 'buildings' | 'workers';

export interface UpgradeDef {
  id: string;
  tab: UpgradeTab;
  name: string;
  desc: string;
  baseCost: number;
  currency: Currency;
  maxLevel: number;
  /** effect per level (additive or multiplicative depending on the stat) */
  perLevel: number;
  requires?: string; // zone id that must be built for the upgrade to appear
  /** own price growth per level (default: BALANCE.growth.upgrades) */
  growth?: number;
  /** shown level = bought levels + offset (Furnace Level starts at 1) */
  levelOffset?: number;
  /** not in the Upgrades menu (levels only come from research / perks) */
  hidden?: boolean;
}

// cost = baseCost * BALANCE.growth.upgrades ^ level — data lives in data/upgrades.json
export const UPGRADES = upgradesData.upgrades as UpgradeDef[];
