import * as THREE from 'three';
import type { ItemType, Currency } from '../config/layout';
import { Geo, ITEM_GEO, MAT } from '../world/models';

export interface PileLayout { cols: number; rows: number; dx: number; dz: number; dy: number }

/** Visual pile of identical items — one InstancedMesh, one draw call. */
export class Pile {
  readonly inst: THREE.InstancedMesh;
  private shown = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private p = new THREE.Vector3();

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, readonly visualCap: number, readonly origin: THREE.Vector3, readonly layout: PileLayout, readonly rotY = 0) {
    this.inst = new THREE.InstancedMesh(geo, MAT.base, visualCap);
    this.inst.count = 0;
    this.inst.castShadow = true;
    this.inst.frustumCulled = false;
    scene.add(this.inst);
  }

  slotPos(i: number, out = new THREE.Vector3()) {
    const { cols, rows, dx, dz, dy } = this.layout;
    const per = cols * rows;
    const layer = Math.floor(i / per);
    const r = Math.floor((i % per) / cols);
    const c = i % cols;
    const lx = (c - (cols - 1) / 2) * dx;
    const lz = (r - (rows - 1) / 2) * dz;
    const cos = Math.cos(this.rotY), sin = Math.sin(this.rotY);
    out.set(this.origin.x + lx * cos + lz * sin, this.origin.y + layer * dy, this.origin.z - lx * sin + lz * cos);
    return out;
  }

  set(n: number) {
    n = Math.min(n, this.visualCap);
    if (n === this.shown) return;
    for (let i = Math.max(0, Math.min(n, this.shown)); i < n; i++) {
      this.slotPos(i, this.p);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.rotY + ((i * 37) % 7) * 0.02);
      this.m.compose(this.p, this.q, this.s);
      this.inst.setMatrixAt(i, this.m);
    }
    this.inst.count = n;
    this.inst.instanceMatrix.needsUpdate = true;
    this.shown = n;
  }

  remove(scene: THREE.Scene) { scene.remove(this.inst); }
}

/** A typed item container with optional visual pile. Capacity accounts for items still in flight. */
export class ItemStore {
  count = 0;
  incoming = 0;
  onReceive?: (s: ItemStore) => void;
  constructor(readonly type: ItemType, public cap: number, public pile?: Pile) {}
  space() { return Math.max(0, this.cap - this.count - this.incoming); }
  reserve() { this.incoming++; }
  receive() {
    this.incoming = Math.max(0, this.incoming - 1);
    this.count++;
    this.pile?.set(this.count);
    this.onReceive?.(this);
  }
  /** Direct add (no flight). */
  add(n = 1) { this.count = Math.min(this.cap, this.count + n); this.pile?.set(this.count); }
  take(): boolean {
    if (this.count <= 0) return false;
    this.count--;
    this.pile?.set(this.count);
    return true;
  }
  landing(out = new THREE.Vector3()) {
    if (this.pile) return this.pile.slotPos(Math.min(this.count + this.incoming, this.pile.visualCap - 1), out);
    return out.set(0, 0, 0);
  }
  source(out = new THREE.Vector3()) {
    if (this.pile) return this.pile.slotPos(Math.max(0, Math.min(this.count, this.pile.visualCap) - 1), out);
    return out.set(0, 0, 0);
  }
}

export interface Port {
  id: string;
  x: number;
  z: number;
  r: number;
  mode: 'in' | 'out';
  store: ItemStore;
  player: boolean;
  workers: boolean;
  /** custom landing point for stores without piles (furnace mouth, etc.) */
  anchor?: THREE.Vector3;
  active?: () => boolean;
}

/** Money / gold lying on the ground waiting for the player to scoop it up. */
export class CurrencyPile {
  amount = 0;
  pile: Pile;
  constructor(private scene: THREE.Scene, readonly currency: Currency, public x: number, public z: number, readonly unit: number, private visualCap = 40, private rotY = 0, private size = 2) {
    this.pile = this.makePile();
  }
  private makePile() {
    const geo = this.currency === 'money' ? Geo.cash() : Geo.goldBar();
    return new Pile(this.scene, geo, this.visualCap, new THREE.Vector3(this.x, 0.1, this.z), { cols: this.size, rows: this.size, dx: 0.68, dz: 0.4, dy: this.currency === 'money' ? 0.15 : 0.21 }, this.rotY);
  }
  moveTo(x: number, z: number) {
    this.pile.remove(this.scene);
    this.x = x; this.z = z;
    this.pile = this.makePile();
    this.refresh();
  }
  add(v: number) { this.amount += v; this.refresh(); }
  refresh() { this.pile.set(this.amount > 0 ? Math.max(1, Math.ceil(this.amount / this.unit)) : 0); }
  top(out = new THREE.Vector3()) { return this.pile.slotPos(Math.max(0, Math.min(this.pile.visualCap, Math.ceil(this.amount / this.unit)) - 1), out); }
}

export { ITEM_GEO };
