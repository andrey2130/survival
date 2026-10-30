import type { ItemType, Currency } from '../config/layout';

export type ResourceId = 'money' | 'wood' | 'meat' | 'gold';
export interface Vec2 { x: number; z: number }

/** All cross-module notifications. Modules talk through these instead of holding references. */
export interface GameEvents {
  'res:changed': { id: ResourceId; value: number; delta: number };
  'currency:collected': { currency: Currency; amount: number; x: number; z: number };
  'tree:hit': Vec2;
  'tree:fell': Vec2;
  'rock:hit': Vec2;
  'item:deposit': { item: ItemType; target: string };
  'item:pickup': { item: ItemType };
  'stack:full': Record<string, never>;
  'enemy:spawn': { kind: string; x: number; z: number };
  'enemy:hit': { x: number; z: number; dmg: number; byPlayer: boolean };
  'enemy:died': { kind: string; x: number; z: number };
  'enemy:telegraph': Vec2;
  'player:hit': { dmg: number };
  'player:ko': Record<string, never>;
  'player:attack': { target: 'tree' | 'enemy' | 'rock' };
  'tower:fire': Vec2;
  'cannon:explode': Vec2;
  'zone:pay': { id: string; remaining: number };
  'zone:built': { id: string; kind: string; x: number; z: number };
  'region:opened': { id: string };
  'wave:warning': { wave: number; dir: Vec2; boss: boolean };
  'wave:start': { wave: number; count: number; boss: boolean };
  'wave:end': { wave: number };
  'palisade:hit': Vec2;
  'palisade:broken': Vec2;
  'palisade:repaired': Vec2;
  'heat:empty': Record<string, never>;
  'heat:restored': Record<string, never>;
  'survivor:arrived': Record<string, never>;
  'survivor:left': { reason: 'cold' | 'hurt' };
  'customer:served': { amount: number };
  'meal:eaten': { amount: number };
  'cook:done': Vec2;
  'gold:smelted': Vec2;
  'upgrade:bought': { id: string; level: number };
  'stage:changed': { stage: number; name: string };
  'tutorial:step': { step: number };
  'toast': { text: string; color?: string };
  'save:request': Record<string, never>;
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private map = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.map.get(type);
    if (!set) { set = new Set(); this.map.set(type, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

export const events = new EventBus();
