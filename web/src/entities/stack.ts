import * as THREE from 'three';
import type { ItemType } from '../config/layout';
import { ITEM_GEO, mesh } from '../world/models';
import { Pool } from '../core/pool';

const HEIGHT: Record<ItemType, number> = { log: 0.34, meat: 0.24, cooked: 0.24, ore: 0.3 };

const pools = new Map<ItemType, Pool<THREE.Mesh>>();
const poolFor = (t: ItemType) => {
  let p = pools.get(t);
  if (p === undefined) {
    p = new Pool<THREE.Mesh>(() => mesh(ITEM_GEO[t]()), undefined, (m) => m.removeFromParent());
    pools.set(t, p);
  }
  return p as Pool<THREE.Mesh>;
};

interface Slot { type: ItemType; m: THREE.Mesh; y: number; pop: number }

/**
 * ResourceStack — items carried on a character's back. Grows visibly, sways with movement.
 */
export class ResourceStack {
  slots: Slot[] = [];
  readonly group = new THREE.Group();
  private leanZ = 0;
  private leanX = 0;
  private velZ = 0;
  private velX = 0;

  constructor(parent: THREE.Object3D, public cap: number, backZ = -0.5, baseY = 0.75) {
    this.group.position.set(0, baseY, backZ);
    parent.add(this.group);
  }

  /** items currently flying towards this stack */
  incoming = 0;

  get size() { return this.slots.length; }
  get full() { return this.slots.length + this.incoming >= this.cap; }
  space() { return Math.max(0, this.cap - this.slots.length - this.incoming); }
  count(t?: ItemType) { return t ? this.slots.reduce((n, s) => n + (s.type === t ? 1 : 0), 0) : this.slots.length; }
  has(t: ItemType) { return this.slots.some((s) => s.type === t); }
  firstOf(types: readonly ItemType[]): ItemType | null {
    for (let i = this.slots.length - 1; i >= 0; i--) if (types.includes(this.slots[i].type)) return this.slots[i].type;
    return null;
  }

  /** World position where the next item will sit (target for incoming flyers). */
  topWorld(out = new THREE.Vector3()) {
    const y = this.slots.length ? this.slots[this.slots.length - 1].y + 0.3 : 0;
    out.set(0, y, 0);
    return this.group.localToWorld(out);
  }

  push(type: ItemType) {
    const m = poolFor(type).get();
    m.rotation.set(0, type === 'log' ? 0 : Math.random() * 0.4, 0);
    m.scale.setScalar(1);
    const prev = this.slots[this.slots.length - 1];
    const y = prev ? prev.y + (HEIGHT[prev.type] + HEIGHT[type]) / 2 : HEIGHT[type] / 2;
    m.position.set(0, y, 0);
    this.group.add(m);
    this.slots.push({ type, m, y, pop: 0.25 });
  }

  /** Remove the top-most item of a type. Returns its world position (flyer start) or null. */
  remove(type: ItemType, out = new THREE.Vector3()): THREE.Vector3 | null {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i].type !== type) continue;
      const s = this.slots[i];
      s.m.getWorldPosition(out);
      poolFor(type).release(s.m);
      this.slots.splice(i, 1);
      this.relayout();
      return out;
    }
    return null;
  }

  clear() {
    for (const s of this.slots) poolFor(s.type).release(s.m);
    this.slots = [];
    this.incoming = 0;
  }

  private relayout() {
    let y = 0;
    let prevH = 0;
    this.slots.forEach((s, i) => {
      const h = HEIGHT[s.type];
      y = i === 0 ? h / 2 : y + (prevH + h) / 2;
      s.y = y;
      prevH = h;
    });
  }

  /** localSpeed: forward/sideways speed in the character's local frame. */
  update(dt: number, fwdSpeed: number, sideSpeed: number) {
    // spring-damped lean
    const k = 60, d = 9;
    const targetZ = -fwdSpeed * 0.035, targetX = -sideSpeed * 0.035;
    this.velZ += ((targetZ - this.leanZ) * k - this.velZ * d) * dt;
    this.velX += ((targetX - this.leanX) * k - this.velX * d) * dt;
    this.leanZ += this.velZ * dt;
    this.leanX += this.velX * dt;
    for (const s of this.slots) {
      const h = s.y;
      s.m.position.y += (s.y - s.m.position.y) * Math.min(1, dt * 14);
      s.m.position.z = this.leanZ * h * h * 0.6;
      s.m.position.x = this.leanX * h * h * 0.6;
      if (s.pop > 0) {
        s.pop = Math.max(0, s.pop - dt);
        const t = 1 - s.pop / 0.25;
        s.m.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.35);
      }
    }
  }
}
