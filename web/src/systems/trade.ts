import { BALANCE } from '../config/balance';
import { res } from '../config/content';
import { events } from '../core/events';
import { rand } from '../core/math';
import type { Game } from '../game';

const MK = BALANCE.market;
const TP = BALANCE.tradepost as unknown as { refreshSeconds: number; offers: number; uses: number; priceJitter: number; templates: { give: Record<string, number>; get: Record<string, number> }[] };

export interface Offer { give: Record<string, number>; get: Record<string, number>; uses: number }
export type GoodSetting = { sell: boolean; reserve: number };

/**
 * Trade: which Warehouse goods the Market may sell (and how many to keep), and the Trading Post's
 * rotating barter deals.
 */
export class Trade {
  goods: Record<string, GoodSetting> = JSON.parse(JSON.stringify(MK.goods));
  offers: Offer[] = [];
  refreshT = 0;

  constructor(private game: Game) {}

  /** Best good the market can sell right now (highest value above its reserve), or null. */
  nextSale(): string | null {
    let best: string | null = null, bv = -1;
    for (const [id, s] of Object.entries(this.goods)) {
      if (!s.sell || this.game.eco.get(id) <= s.reserve) continue;
      const v = res(id).value ?? 0;
      if (v > bv) { bv = v; best = id; }
    }
    return best;
  }

  /**
   * Market price. Wood products never sell for less than the logs in them at the stall's log price
   * x a processing factor (balance.json market.processed), so turning logs into planks / furniture /
   * charcoal always pays better than selling the logs raw.
   */
  base(id: string) {
    const r = res(id), k = (MK.processed as unknown as Record<string, number>)[id];
    return Math.max((r.value ?? 1) * this.game.up.mult('marketPrice'), r.logs && k ? r.logs * this.game.up.logPrice * k : 0);
  }
  price(id: string) {
    const g = this.game;
    return Math.max(1, Math.round(this.base(id) * g.eco.incomeMult * (g.eco.doubleIncomeLeft > 0 ? 2 : 1)));
  }

  private roll() {
    const pool = [...TP.templates];
    this.offers = [];
    for (let i = 0; i < TP.offers && pool.length; i++) {
      const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const k = 1 + rand(-TP.priceJitter, TP.priceJitter);
      const get: Record<string, number> = {};
      for (const [r, n] of Object.entries(t.get)) get[r] = Math.max(1, Math.round(n * k));
      this.offers.push({ give: { ...t.give }, get, uses: TP.uses });
    }
  }

  accept(i: number): boolean {
    const o = this.offers[i];
    const g = this.game;
    if (!o || o.uses <= 0 || !g.affordable(o.give) || !g.payCost(o.give)) return false;
    for (const [r, n] of Object.entries(o.get)) g.eco.add(r, n);
    o.uses--;
    g.flows.add('trade', 1, 'deals');
    events.emit('toast', { text: `Deal! +${Object.entries(o.get).map(([r, n]) => `${n} ${res(r).icon}`).join(' ')}`, color: '#ffe27a' });
    g.saver.save();
    return true;
  }

  update(dt: number) {
    if (!this.game.zones.built.has('tradepost')) return;
    this.refreshT -= dt;
    if (this.refreshT <= 0 || !this.offers.length) {
      this.refreshT = TP.refreshSeconds;
      this.roll();
      if (this.offers.length && !this.game.loading) events.emit('toast', { text: '🐴 New deals at the Trading Post', color: '#ffe27a' });
    }
  }

  serialize() { return { goods: this.goods, offers: this.offers, refreshT: this.refreshT }; }
  restore(d: { goods?: Record<string, GoodSetting>; offers?: Offer[]; refreshT?: number } | undefined) {
    if (!d) return;
    for (const [k, v] of Object.entries(d.goods ?? {})) if (this.goods[k]) this.goods[k] = v;
    this.offers = d.offers ?? [];
    this.refreshT = d.refreshT ?? 0;
  }
}
