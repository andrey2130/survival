// All gameplay numbers live in data/balance.json. No magic numbers in systems — tweak that file to rebalance.
import data from '../data/balance.json';

export const BALANCE = data;
export type Balance = typeof BALANCE;

/** cost = base * growth^level — one growth constant per system (see balance.json "growth"). */
export const growthCost = (base: number, system: keyof Balance['growth'], level: number) =>
  Math.round(base * Math.pow(BALANCE.growth[system], level));
