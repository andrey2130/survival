import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { ItemType } from '../config/layout';
import { ITEM_GEO, MAT, makeShadow } from '../world/models';
import { Pool } from '../core/pool';
import { events } from '../core/events';
import type { Game } from '../game';
import type { ResourceStack } from '../entities/stack';

interface Pickup { type: ItemType; x: number; z: number; g: THREE.Group; m: THREE.Mesh; life: number; land: number; claimed: boolean }

/** Items lying on the ground (overflow logs, bear meat) — auto-collected when walking past. */
export class Pickups {
  list: Pickup[] = [];
  private pools = new Map<ItemType, Pool<Pickup>>();

  constructor(private game: Game) {}

  private pool(type: ItemType) {
    let p = this.pools.get(type);
    if (!p) {
      p = new Pool<Pickup>(() => {
        const g = new THREE.Group();
        const m = new THREE.Mesh(ITEM_GEO[type](), MAT.base);
        g.add(m, makeShadow(0.9));
        return { type, x: 0, z: 0, g, m, life: 0, land: 0, claimed: false };
      }, (pk) => this.game.scene.add(pk.g), (pk) => this.game.scene.remove(pk.g));
      this.pools.set(type, p);
    }
    return p;
  }

  spawn(type: ItemType, x: number, z: number, from?: THREE.Vector3) {
    const pk = this.pool(type).get();
    pk.x = x; pk.z = z;
    pk.life = BALANCE.enemies.meatDespawn;
    pk.claimed = false;
    pk.g.position.set(x, 0, z);
    pk.g.visible = !from;
    pk.land = from ? 0.35 : 0;
    if (from) this.game.fx.fly(ITEM_GEO[type](), from, new THREE.Vector3(x, 0.25, z), { dur: 0.35, arc: 1.8, done: () => { pk.g.visible = true; } });
    this.list.push(pk);
  }

  nearest(x: number, z: number, r: number, type?: ItemType) {
    let best: Pickup | null = null, bd = r * r;
    for (const p of this.list) {
      if (p.claimed || (type && p.type !== type)) continue;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Collect items within the pickup radius into a stack. */
  collect(x: number, z: number, stack: ResourceStack, type?: ItemType) {
    const r2 = BALANCE.player.pickupRadius ** 2;
    for (const p of this.list) {
      if (p.claimed || p.land > 0 || (type && p.type !== type)) continue;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 > r2) continue;
      if (stack.space() <= 0) return;
      p.claimed = true;
      p.life = 0;
      this.game.giveItemTo(stack, p.type, new THREE.Vector3(p.x, 0.3, p.z));
      events.emit('item:pickup', { item: p.type });
    }
  }

  update(dt: number, time: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.land > 0) p.land -= dt;
      p.life -= dt;
      if (p.life <= 0) { this.pool(p.type).release(p); this.list.splice(i, 1); continue; }
      p.m.position.y = 0.3 + Math.sin(time * 3 + p.x) * 0.08;
      p.m.rotation.y += dt * 1.5;
    }
  }

  serialize() { return this.list.filter((p) => !p.claimed).map((p) => ({ t: p.type, x: +p.x.toFixed(2), z: +p.z.toFixed(2) })); }
}
