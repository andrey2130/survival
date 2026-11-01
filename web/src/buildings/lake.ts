import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { res } from '../config/content';
import type { ZoneDef } from '../config/layout';
import { Building } from './building';
import { Geo } from '../world/models';
import { ItemStore, Pile, CurrencyPile } from '../systems/storage';
import { itemGeo } from '../world/models';
import type { Game } from '../game';

const T = BALANCE.trader;

/**
 * Trader at the Frozen Lake: buys one item kind (smoked fish) for money. Drop goods on the counter,
 * coins pile up next to it for the player to scoop.
 */
export class Trader extends Building {
  readonly store: ItemStore;
  readonly cash: CurrencyPile;
  readonly item: string;
  private t = 0;

  constructor(game: Game, def: ZoneDef) {
    super(game, def, Geo.counter(0x3a7bd5), [3.2, 1.4]);
    this.item = (def.params?.item as string | undefined) ?? 'smokedFish';
    this.store = new ItemStore(this.item, T.cap, new Pile(game.scene, itemGeo(this.item), T.cap, this.at(0, 0.3, 1.25).setY(1.15), { cols: 4, rows: 1, dx: 0.5, dz: 0.4, dy: 0.18 }));
    game.addPort({ id: def.id, x: def.x, z: def.z + 2.1, r: 1.9, mode: 'in', store: this.store, player: true, workers: true });
    this.cash = new CurrencyPile(game.scene, 'money', def.x + 2.7, def.z + 1.6, 5, 40);
    game.addCashPile(this.cash);
  }

  get price() {
    const g = this.game;
    return Math.round((res(this.item).value ?? 10) * g.up.mult('smokedPrice') * g.eco.incomeMult * (g.eco.doubleIncomeLeft > 0 ? 2 : 1));
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0 || this.store.count <= 0) return;
    this.t = T.sellInterval;
    const from = this.store.source().clone();
    this.store.take();
    const amount = this.price;
    this.game.fx.fly(Geo.cash(), from, () => this.cash.top().setY(0.4), { dur: 0.35, arc: 0.8, done: () => this.cash.add(amount) });
  }

  status() { return this.store.count ? `💰 Selling ${res(this.item).icon}${this.store.count}` : `Buys ${res(this.item).icon} $${this.price}`; }
  statusTone() { return this.store.count ? 'ok' as const : '' as const; }
  serialize() { return { stock: this.store.count, cash: this.cash.amount }; }
  restore(d: Record<string, number>) { this.store.add(d.stock ?? 0); this.cash.add(d.cash ?? 0); }
  statusAnchor() { return new THREE.Vector3(this.def.x, 3.2, this.def.z); }
}
