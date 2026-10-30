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
}

// cost = baseCost * BALANCE.upgradeGrowth ^ level
export const UPGRADES: UpgradeDef[] = [
  { id: 'stackCap', tab: 'player', name: 'Backpack', desc: '+2 stack capacity', baseCost: 60, currency: 'money', maxLevel: 25, perLevel: 2 },
  { id: 'axeDamage', tab: 'player', name: 'Sharp Axe', desc: '+20% axe damage', baseCost: 80, currency: 'money', maxLevel: 25, perLevel: 0.2 },
  { id: 'attackSpeed', tab: 'player', name: 'Quick Swing', desc: '+8% attack speed', baseCost: 100, currency: 'money', maxLevel: 15, perLevel: 0.08 },
  { id: 'moveSpeed', tab: 'player', name: 'Snow Boots', desc: '+5% move speed', baseCost: 90, currency: 'money', maxLevel: 12, perLevel: 0.05 },
  { id: 'maxHp', tab: 'player', name: 'Fur Coat', desc: '+20 max HP', baseCost: 70, currency: 'money', maxLevel: 20, perLevel: 20 },
  { id: 'steelAxe', tab: 'player', name: 'Gilded Axe', desc: '+50% damage (gold)', baseCost: 5, currency: 'gold', maxLevel: 10, perLevel: 0.5, requires: 'smelter' },

  { id: 'furnaceEff', tab: 'buildings', name: 'Furnace Bellows', desc: '+15% heat per log', baseCost: 120, currency: 'money', maxLevel: 15, perLevel: 0.15 },
  { id: 'logPrice', tab: 'buildings', name: 'Better Logs', desc: '+$1 per log sold', baseCost: 200, currency: 'money', maxLevel: 20, perLevel: 1 },
  { id: 'queueSlots', tab: 'buildings', name: 'Bigger Queue', desc: '+1 queue spot', baseCost: 150, currency: 'money', maxLevel: 4, perLevel: 1 },
  { id: 'kitchenSpeed', tab: 'buildings', name: 'Hot Grill', desc: '+12% cooking speed', baseCost: 150, currency: 'money', maxLevel: 15, perLevel: 0.12, requires: 'kitchen' },
  { id: 'mealPrice', tab: 'buildings', name: 'Spiced Stew', desc: '+$2 per meal', baseCost: 220, currency: 'money', maxLevel: 15, perLevel: 2, requires: 'diner' },
  { id: 'towerDamage', tab: 'buildings', name: 'Heavy Bolts', desc: '+20% tower damage', baseCost: 100, currency: 'money', maxLevel: 20, perLevel: 0.2, requires: 'tower1' },
  { id: 'towerRate', tab: 'buildings', name: 'Fast Winch', desc: '+10% tower fire rate', baseCost: 120, currency: 'money', maxLevel: 15, perLevel: 0.1, requires: 'tower1' },
  { id: 'towerRange', tab: 'buildings', name: 'Long Scope', desc: '+8% tower range', baseCost: 120, currency: 'money', maxLevel: 10, perLevel: 0.08, requires: 'tower1' },
  { id: 'wallHp', tab: 'buildings', name: 'Thick Logs', desc: '+20% wall HP', baseCost: 140, currency: 'money', maxLevel: 15, perLevel: 0.2 },
  { id: 'goldLedger', tab: 'buildings', name: 'Golden Ledger', desc: '+25% all income (gold)', baseCost: 8, currency: 'gold', maxLevel: 10, perLevel: 0.25, requires: 'smelter' },

  { id: 'workerSpeed', tab: 'workers', name: 'Warm Rations', desc: '+10% worker speed', baseCost: 200, currency: 'money', maxLevel: 12, perLevel: 0.1, requires: 'lumberhut' },
  { id: 'workerCap', tab: 'workers', name: 'Big Baskets', desc: '+2 worker capacity', baseCost: 220, currency: 'money', maxLevel: 10, perLevel: 2, requires: 'lumberhut' },
  { id: 'guardPower', tab: 'workers', name: 'Guard Training', desc: '+25% guard damage & HP', baseCost: 250, currency: 'money', maxLevel: 12, perLevel: 0.25, requires: 'guard1' },
];
