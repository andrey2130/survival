import * as THREE from 'three';

/**
 * Dynamic instancing for everything that moves and repeats: characters, animals, carried stacks,
 * blob shadows. Entities keep a normal Object3D hierarchy for animation, but their visible parts are
 * invisible "proxies" (plain Object3D tagged with a geometry). Once per frame `flush()` walks the
 * registered roots and writes every proxy's world matrix into one InstancedMesh per geometry —
 * so 40 survivors cost the same few draw calls as one.
 */
interface Batch { mesh: THREE.InstancedMesh; n: number; cap: number; colors: boolean }

export interface ProxyData { bgeo: THREE.BufferGeometry; bmat?: THREE.Material; tint?: THREE.Color; outline?: boolean }

/**
 * Cheap "inverted hull" outline: the same instanced geometry drawn again, back faces only, pushed out
 * along the normals in a dark colour. Makes the hero and animals readable on white snow.
 */
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1b2638, side: THREE.BackSide });
outlineMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * 0.045;');
};

const WHITE = new THREE.Color(1, 1, 1);

export class Batcher {
  private scene: THREE.Scene | null = null;
  private batches = new Map<THREE.BufferGeometry, Batch>();
  private outlineBatches = new Map<THREE.BufferGeometry, Batch>();
  /** draw outlines for proxies flagged with `outline` (quality preset) */
  outlines = true;
  private roots = new Set<THREE.Object3D>();
  private defaultMat: THREE.Material | null = null;
  /** stats for the debug panel */
  instances = 0;

  attach(scene: THREE.Scene, mat: THREE.Material) { this.scene = scene; this.defaultMat = mat; }

  register(root: THREE.Object3D) { this.roots.add(root); }
  unregister(root: THREE.Object3D) { this.roots.delete(root); }
  get count() { return this.roots.size; }
  get drawCalls() { let n = 0; for (const m of [this.batches, this.outlineBatches]) for (const b of m.values()) if (b.n) n++; return n; }

  /** An invisible stand-in that renders `geo` through the batcher. */
  static proxy(geo: THREE.BufferGeometry, tint?: THREE.Color | number, mat?: THREE.Material, outline = false) {
    const o = new THREE.Object3D();
    const d: ProxyData = { bgeo: geo, bmat: mat, outline, tint: tint === undefined ? undefined : tint instanceof THREE.Color ? tint : new THREE.Color(tint) };
    o.userData = d;
    return o;
  }

  private batch(geo: THREE.BufferGeometry, mat: THREE.Material, need: number, map = this.batches): Batch {
    let b = map.get(geo);
    if (b && b.cap >= need) return b;
    const cap = Math.max(32, need * 2);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false; // moving things get blob shadows instead (cheap on mobile)
    mesh.receiveShadow = mat === this.defaultMat;
    for (let i = 0; i < cap; i++) mesh.setColorAt(i, WHITE);
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    if (mat.transparent) mesh.renderOrder = 1;
    if (b) { // grow: keep the old data for this frame
      for (let i = 0; i < b.n; i++) {
        b.mesh.getMatrixAt(i, tmpM); mesh.setMatrixAt(i, tmpM);
        b.mesh.getColorAt(i, tmpC); mesh.setColorAt(i, tmpC);
      }
      this.scene!.remove(b.mesh);
      b.mesh.dispose();
      b = { mesh, n: b.n, cap, colors: b.colors };
    } else b = { mesh, n: 0, cap, colors: false };
    this.scene!.add(mesh);
    map.set(geo, b);
    return b;
  }

  private push(o: THREE.Object3D) {
    const d = o.userData as ProxyData;
    let b = this.batches.get(d.bgeo);
    if (!b || b.n >= b.cap) b = this.batch(d.bgeo, d.bmat ?? this.defaultMat!, (b?.n ?? 0) + 1);
    b.mesh.setMatrixAt(b.n, o.matrixWorld);
    b.mesh.setColorAt(b.n, d.tint ?? WHITE);
    b.n++;
    if (d.outline && this.outlines) {
      let ob = this.outlineBatches.get(d.bgeo);
      if (!ob || ob.n >= ob.cap) ob = this.batch(d.bgeo, outlineMat, (ob?.n ?? 0) + 1, this.outlineBatches);
      ob.mesh.setMatrixAt(ob.n, o.matrixWorld);
      ob.n++;
    }
  }

  /** Write all proxies of visible registered roots into their instanced meshes. Call once per frame. */
  flush() {
    for (const b of this.batches.values()) b.n = 0;
    for (const b of this.outlineBatches.values()) b.n = 0;
    for (const root of this.roots) {
      if (!root.visible || !root.parent) continue;
      root.updateMatrixWorld(true);
      root.traverseVisible(this.visit);
    }
    let total = 0;
    for (const b of this.batches.values()) {
      b.mesh.count = b.n;
      total += b.n;
      if (b.n) { b.mesh.instanceMatrix.needsUpdate = true; b.mesh.instanceColor!.needsUpdate = true; }
    }
    for (const b of this.outlineBatches.values()) {
      b.mesh.count = b.n;
      if (b.n) b.mesh.instanceMatrix.needsUpdate = true;
    }
    this.instances = total;
  }

  private visit = (o: THREE.Object3D) => { if ((o.userData as ProxyData).bgeo) this.push(o); };
}

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

/** Shared instance — attached to the scene by the Game. */
export const BATCH = new Batcher();
