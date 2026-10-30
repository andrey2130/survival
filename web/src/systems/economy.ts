import { BALANCE } from '../config/balance';
import type { Currency } from '../config/layout';
import { events, type ResourceId } from '../core/events';

/** EconomyManager — currencies, income multipliers, derived stock counters for the HUD. */
export class Economy {
  money = BALANCE.start.money;
  gold = BALANCE.start.gold;
  wood = 0; // derived: logs in camp (stack + storages)
  meat = 0; // derived: raw + cooked meat in camp
  doubleIncomeLeft = 0; // seconds of rewarded x2 boost
  incomeMult = 1; // permanent multipliers (upgrades, monument)
  totalEarned = 0;

  get(c: Currency) { return c === 'money' ? this.money : this.gold; }

  /** Income from customers/meals/smelter — boosted by multipliers. */
  earn(c: Currency, base: number): number {
    const mult = (c === 'money' ? this.incomeMult : 1) * (this.doubleIncomeLeft > 0 ? 2 : 1);
    return Math.max(1, Math.round(base * mult));
  }

  add(c: Currency, amount: number) {
    if (amount === 0) return;
    if (c === 'money') { this.money += amount; this.totalEarned += Math.max(0, amount); }
    else this.gold += amount;
    events.emit('res:changed', { id: c, value: this.get(c), delta: amount });
  }

  spend(c: Currency, amount: number): boolean {
    if (this.get(c) < amount) return false;
    this.add(c, -amount);
    return true;
  }

  setDerived(id: Extract<ResourceId, 'wood' | 'meat'>, v: number) {
    if (this[id] === v) return;
    const d = v - this[id];
    this[id] = v;
    events.emit('res:changed', { id, value: v, delta: d });
  }

  update(dt: number) {
    if (this.doubleIncomeLeft > 0) this.doubleIncomeLeft = Math.max(0, this.doubleIncomeLeft - dt);
  }
}
