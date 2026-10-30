import { BALANCE } from '../config/balance';
import { UPGRADES, type UpgradeDef } from '../config/upgrades';
import { events } from '../core/events';
import type { Economy } from './economy';

const P = BALANCE.player;

/** UpgradeSystem — levels + derived stats. cost = base * growth^level. */
export class Upgrades {
  levels: Record<string, number> = {};
  /** free levels granted by perk zones (not counted in price growth) */
  bonus: Record<string, number> = {};

  constructor(private eco: Economy) {}

  def(id: string) { return UPGRADES.find((u) => u.id === id)!; }
  lvl(id: string) { return (this.levels[id] ?? 0) + (this.bonus[id] ?? 0); }
  private per(id: string) { return this.lvl(id) * this.def(id).perLevel; }

  cost(u: UpgradeDef) { return Math.round(u.baseCost * Math.pow(BALANCE.upgradeGrowth, this.levels[u.id] ?? 0)); }
  maxed(u: UpgradeDef) { return (this.levels[u.id] ?? 0) >= u.maxLevel; }

  buy(id: string): boolean {
    const u = this.def(id);
    if (this.maxed(u)) return false;
    if (!this.eco.spend(u.currency, this.cost(u))) return false;
    this.levels[id] = (this.levels[id] ?? 0) + 1;
    events.emit('upgrade:bought', { id, level: this.levels[id] });
    return true;
  }

  grant(id: string, levels: number) {
    this.bonus[id] = (this.bonus[id] ?? 0) + levels;
    events.emit('upgrade:bought', { id, level: this.lvl(id) });
  }

  // ---- derived stats ----
  get stackCap() { return P.stackCap + this.per('stackCap'); }
  get damageMult() { return (1 + this.per('axeDamage')) * (1 + this.per('steelAxe')); }
  get attackInterval() { return P.attackInterval / (1 + this.per('attackSpeed')); }
  get attackSpeedMult() { return 1 + this.per('attackSpeed'); }
  get moveSpeed() { return P.speed * (1 + this.per('moveSpeed')); }
  get maxHp() { return P.hp + this.per('maxHp'); }
  get heatPerLog() { return BALANCE.furnace.heatPerLog * (1 + this.per('furnaceEff')); }
  get logPrice() { return BALANCE.economy.logPrice + this.per('logPrice'); }
  get mealPrice() { return BALANCE.economy.mealPrice + this.per('mealPrice'); }
  get queueSlots() { return BALANCE.counter.queueSlots + this.per('queueSlots'); }
  get cookSeconds() { return BALANCE.kitchen.cookSeconds / (1 + this.per('kitchenSpeed')); }
  get towerDamageMult() { return 1 + this.per('towerDamage'); }
  get towerRateMult() { return 1 + this.per('towerRate'); }
  get towerRangeMult() { return 1 + this.per('towerRange'); }
  get wallHpMult() { return 1 + this.per('wallHp'); }
  get goldIncomeMult() { return 1 + this.per('goldLedger'); }
  get workerSpeed() { return BALANCE.workers.speed * (1 + this.per('workerSpeed')); }
  get workerCap() { return BALANCE.workers.capacity + this.per('workerCap'); }
  get guardMult() { return 1 + this.per('guardPower'); }
}
