import { BALANCE } from '../config/balance';
import type { ResId } from '../config/layout';
import { events } from '../core/events';

export type Cost = Record<ResId, number>;

/**
 * EconomyManager — the resource bank (money, gold and every banked item), income multipliers,
 * derived stock counters for the HUD.
 */
export class Economy {
  /** banked amounts by resource id (data/resources.json) */
  bank: Record<ResId, number> = { money: BALANCE.start.money, gold: BALANCE.start.gold };
  /** HUD-only counters (wood in camp, meat in camp, carried + stored items) */
  derived: Record<string, number> = {};
  doubleIncomeLeft = 0; // seconds of rewarded x2 boost
  incomeMult = 1; // permanent multipliers (upgrades, monument)
  totalEarned = 0;

  get money() { return this.bank.money ?? 0; }
  set money(v: number) { this.bank.money = v; }
  get gold() { return this.bank.gold ?? 0; }
  set gold(v: number) { this.bank.gold = v; }

  get(id: ResId) { return this.bank[id] ?? 0; }

  /** Income from customers/meals/smelter — boosted by multipliers. */
  earn(c: ResId, base: number): number {
    const mult = (c === 'money' ? this.incomeMult : 1) * (this.doubleIncomeLeft > 0 ? 2 : 1);
    return Math.max(1, Math.round(base * mult));
  }

  add(id: ResId, amount: number) {
    if (amount === 0) return;
    this.bank[id] = this.get(id) + amount;
    if (id === 'money') this.totalEarned += Math.max(0, amount);
    events.emit('res:changed', { id, value: this.get(id), delta: amount });
  }

  spend(id: ResId, amount: number): boolean {
    if (this.get(id) < amount) return false;
    this.add(id, -amount);
    return true;
  }

  canAfford(cost: Cost) { return Object.entries(cost).every(([id, n]) => this.get(id) >= n); }

  /** Pay a multi-resource cost atomically. */
  pay(cost: Cost): boolean {
    if (!this.canAfford(cost)) return false;
    for (const [id, n] of Object.entries(cost)) this.add(id, -n);
    return true;
  }

  setDerived(id: string, v: number) {
    const old = this.derived[id] ?? 0;
    if (old === v) return;
    this.derived[id] = v;
    events.emit('res:changed', { id, value: v, delta: v - old });
  }

  update(dt: number) {
    if (this.doubleIncomeLeft > 0) this.doubleIncomeLeft = Math.max(0, this.doubleIncomeLeft - dt);
  }
}
