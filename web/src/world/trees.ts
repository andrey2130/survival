import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { Geo, MAT, mesh } from './models';
import { Pool } from '../core/pool';
import { easeOutBack, rand, randInt } from '../core/math';
import { events } from '../core/events';

export interface Tree {
  id: number;
  x: number;
  z: number;
  v: number;
  big: boolean;
  region: string;
  hp: number;
  grown: boolean;
  regrow: number;
  growAnim: number; // 0..1 regrowth pop
  shake: number;
  shakeDir: number;
  rotY: number;
  scale: number;
  reservedBy: object | null;
  inst: THREE.InstancedMesh;
  instIndex: number;
  stumpInst: THREE.InstancedMesh;
  stumpIndex: number;
}

interface Falling { m: THREE.Mesh; t: number; dir: number; x: number; z: number }

/**
 * Choppable trees rendered with InstancedMesh (a handful of draw calls for 200+ trees).
 * Only shaking/regrowing trees update their instance matrices each frame.
 */
export class Trees {
  list: Tree[] = [];
  private pending: { x: number; z: number; v: number; big: boolean; region: string }[] = [];
  private dirty = new Set<Tree>();
  private falling: Falling[] = [];
  private fallPools = new Map<string, Pool<THREE.Mesh>>();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {}

  add(x: number, z: number, v: number, big: boolean, region: string) {
    this.pending.push({ x, z, v, big, region });
  }

  /** Build instanced meshes after all trees are placed. */
  finalize() {
    const groups = new Map<string, typeof this.pending>();
    for (const p of this.pending) {
      const k = `${p.v}_${p.big}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    const stumpCounts = { small: this.pending.filter((p) => !p.big).length, big: this.pending.filter((p) => p.big).length };
    const stumpSmall = new THREE.InstancedMesh(Geo.stump(false), MAT.base, Math.max(1, stumpCounts.small));
    const stumpBig = new THREE.InstancedMesh(Geo.stump(true), MAT.base, Math.max(1, stumpCounts.big));
    let si = 0, bi = 0;
    for (const [k, arr] of groups) {
      const [v, big] = [Number(k.split('_')[0]), k.endsWith('true')];
      const inst = new THREE.InstancedMesh(Geo.tree(v, big), MAT.base, arr.length);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = true;
      inst.receiveShadow = true;
      this.scene.add(inst);
      arr.forEach((p, i) => {
        const stumpInst = p.big ? stumpBig : stumpSmall;
        const t: Tree = {
          id: this.list.length, x: p.x, z: p.z, v, big, region: p.region,
          hp: BALANCE.tree.hits * (big ? 2 : 1), grown: true, regrow: 0, growAnim: 1, shake: 0, shakeDir: 0,
          rotY: rand(0, Math.PI * 2), scale: rand(0.85, 1.15), reservedBy: null,
          inst, instIndex: i, stumpInst, stumpIndex: p.big ? bi++ : si++,
        };
        this.list.push(t);
        this.writeMatrix(t);
      });
      inst.computeBoundingSphere();
    }
    for (const s of [stumpSmall, stumpBig]) { s.castShadow = true; s.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(s); s.computeBoundingSphere(); }
    // Trees spread over the whole map: disable per-instance culling issues by using the full bounds.
    for (const t of this.list) { t.inst.frustumCulled = false; t.stumpInst.frustumCulled = false; }
    this.pending = [];
  }

  private writeMatrix(t: Tree) {
    // tree
    const growS = t.grown ? easeOutBack(Math.min(1, t.growAnim)) : 0;
    const sh = t.shake > 0 ? Math.sin(t.shake * 40) * t.shake * 0.5 : 0;
    this.tmpE.set(Math.cos(t.shakeDir) * sh, t.rotY, Math.sin(t.shakeDir) * sh);
    this.tmpQ.setFromEuler(this.tmpE);
    this.tmpP.set(t.x, 0, t.z);
    const s = t.scale * Math.max(0.0001, growS);
    this.tmpS.set(s, s, s);
    this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
    t.inst.setMatrixAt(t.instIndex, this.tmpM);
    t.inst.instanceMatrix.needsUpdate = true;
    // stump (visible when chopped or while regrowing)
    const stumpVisible = !t.grown || t.growAnim < 0.3;
    this.tmpE.set(0, t.rotY, 0);
    this.tmpQ.setFromEuler(this.tmpE);
    this.tmpS.setScalar(stumpVisible ? t.scale : 0.0001);
    this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
    t.stumpInst.setMatrixAt(t.stumpIndex, this.tmpM);
    t.stumpInst.instanceMatrix.needsUpdate = true;
  }

  /** Apply damage; returns number of logs dropped if the tree fell, else 0. */
  hit(t: Tree, dmg: number, fromX: number, fromZ: number): number {
    if (!t.grown) return 0;
    t.hp -= dmg;
    t.shake = 0.35;
    t.shakeDir = Math.atan2(t.z - fromZ, t.x - fromX);
    this.dirty.add(t);
    events.emit('tree:hit', { x: t.x, z: t.z });
    if (t.hp > 0) return 0;
    t.grown = false;
    t.regrow = rand(BALANCE.tree.regrowMin, BALANCE.tree.regrowMax);
    t.reservedBy = null;
    t.shake = 0;
    this.writeMatrix(t);
    this.spawnFalling(t, t.shakeDir);
    events.emit('tree:fell', { x: t.x, z: t.z });
    const logs = randInt(BALANCE.tree.logsMin, BALANCE.tree.logsMax);
    return t.big ? logs * 2 : logs;
  }

  private spawnFalling(t: Tree, dir: number) {
    const key = `${t.v}_${t.big}`;
    let pool = this.fallPools.get(key);
    if (!pool) {
      pool = new Pool(() => { const m = mesh(Geo.tree(t.v, t.big)); return m; }, (m) => this.scene.add(m), (m) => this.scene.remove(m));
      this.fallPools.set(key, pool);
    }
    const m = pool.get();
    m.position.set(t.x, 0, t.z);
    m.scale.setScalar(t.scale);
    m.rotation.set(0, 0, 0);
    this.falling.push({ m, t: 0, dir, x: t.x, z: t.z });
    (m.userData as any).pool = pool;
  }

  update(dt: number) {
    for (const t of this.dirty) {
      if (t.shake > 0) t.shake = Math.max(0, t.shake - dt);
      if (t.grown && t.growAnim < 1) t.growAnim = Math.min(1, t.growAnim + dt * 1.6);
      this.writeMatrix(t);
      if (t.shake <= 0 && (!t.grown || t.growAnim >= 1)) this.dirty.delete(t);
    }
    for (const t of this.list) {
      if (t.grown) continue;
      t.regrow -= dt;
      if (t.regrow <= 0) {
        t.grown = true;
        t.hp = BALANCE.tree.hits * (t.big ? 2 : 1);
        t.growAnim = 0;
        this.dirty.add(t);
      }
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const k = Math.min(1, f.t / 0.55);
      const ang = (k * k) * (Math.PI / 2);
      // tilt around the axis perpendicular to fall direction
      f.m.rotation.set(0, 0, 0);
      f.m.rotateOnWorldAxis(new THREE.Vector3(Math.sin(f.dir), 0, -Math.cos(f.dir)), ang);
      if (f.t > 0.8) {
        const s = Math.max(0, 1 - (f.t - 0.8) / 0.35);
        f.m.scale.setScalar(s);
        f.m.position.y = -(1 - s) * 0.5;
      }
      if (f.t > 1.15) {
        (f.m.userData as any).pool.release(f.m);
        this.falling.splice(i, 1);
      }
    }
  }

  nearestGrown(x: number, z: number, maxDist: number, isOpen: (region: string) => boolean, ignoreReserved = false, self?: object): Tree | null {
    let best: Tree | null = null;
    let bd = maxDist * maxDist;
    for (const t of this.list) {
      if (!t.grown || t.growAnim < 0.9 || !isOpen(t.region)) continue;
      if (!ignoreReserved && t.reservedBy && t.reservedBy !== self) continue;
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
}
