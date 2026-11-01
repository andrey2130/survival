import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { res } from '../config/content';
import type { ZoneDef } from '../config/layout';
import { Building } from './building';
import { Geo, buildingGeo, itemGeo } from '../world/models';
import { CurrencyPile } from '../systems/storage';
import type { Game } from '../game';

/** Market square: sells Warehouse goods to visiting merchants; coins pile up for the hero to scoop. */
export class Market extends Building {
  readonly cash: CurrencyPile;
  private t = 1;
  private last: string | null = null;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, buildingGeo('market'), [4.6, 2.2]);
    this.cash = new CurrencyPile(game.scene, 'money', def.x + 3.4, def.z + 1.8, 5, 60);
    game.addCashPile(this.cash);
  }

  update(dt: number) {
    const g = this.game;
    const good = g.trade.nextSale();
    g.flows.track(this.def.id, !!good, dt);
    this.t -= dt * g.up.mult('marketSpeed');
    if (this.t > 0 || !good) return;
    this.t = BALANCE.market.sellSeconds;
    this.last = good;
    g.eco.add(good, -1);
    const amount = g.trade.price(good);
    g.flows.add(good, -1, 'market');
    const from = this.at(0, 0.6, 1.4);
    g.fx.fly(itemGeo(good), from, from.clone().setY(3.5), { dur: 0.4, arc: 0.4, scaleTo: 0.3 });
    g.fx.fly(Geo.cash(), from.clone().setY(1.6), () => this.cash.top().setY(0.4), { dur: 0.45, arc: 1, done: () => this.cash.add(amount) });
  }

  status() { const g = this.game.trade.nextSale(); return g ? `💰 Selling ${res(g).icon} $${this.game.trade.price(g)}` : '🏪 Nothing to sell'; }
  statusTone() { return this.game.trade.nextSale() ? 'ok' as const : 'warn' as const; }
  serialize() { return { cash: this.cash.amount }; }
  restore(d: Record<string, number>) { this.cash.add(d.cash ?? 0); }
  statusAnchor() { return new THREE.Vector3(this.def.x, 3.4, this.def.z); }
  get lastSold() { return this.last; }
}

/** Trading post: barter deals (see systems/trade.ts); the deals live in the Trade screen. */
export class TradePost extends Building {
  constructor(game: Game, def: ZoneDef) {
    super(game, def, buildingGeo('tradepost'), [3, 2.4]);
  }
  status() {
    const t = this.game.trade;
    const left = t.offers.filter((o) => o.uses > 0).length;
    return `🐴 ${left} deals · new in ${Math.ceil(t.refreshT / 60)}m`;
  }
  statusTone() { return 'ok' as const; }
}

/** Laboratory: runs the research tree (Research screen). */
export class Lab extends Building {
  constructor(game: Game, def: ZoneDef) { super(game, def, buildingGeo('lab'), [4, 3]); }
  status() {
    const r = this.game.research, c = r.current, n = c && r.node(c.id);
    return n ? `🔬 ${n.name} ${Math.floor((c!.t / n.seconds) * 100)}%` : '🔬 Idle — pick a project';
  }
  statusTone() { return this.game.research.current ? 'ok' as const : 'warn' as const; }
}

/** Expedition camp: where trips leave from (Residents screen). */
export class ExpeditionCamp extends Building {
  constructor(game: Game, def: ZoneDef) { super(game, def, buildingGeo('expeditionCamp'), [3.4, 2.6]); }
  status() {
    const e = this.game.expeditions;
    if (!e.trips.length) return '🧭 Ready to send people';
    const next = Math.min(...e.trips.map((t) => t.endsAt)) - Date.now();
    return `🧭 ${e.away} away · back in ${Math.max(0, Math.ceil(next / 60000))}m`;
  }
  statusTone() { return 'ok' as const; }
}
