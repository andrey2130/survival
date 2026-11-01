import * as THREE from 'three';

interface Print { x: number; z: number; rot: number; age: number; life: number; size: number }

/**
 * Footprints in the snow: a ring buffer of small flat ovals in ONE InstancedMesh. Prints shrink away
 * over their lifetime (no per-instance alpha needed). Walkers call `step()` with their position.
 */
export class Footprints {
  private inst: THREE.InstancedMesh;
  private prints: Print[] = [];
  private head = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  /** last print per walker (alternating left / right foot) */
  private last = new WeakMap<object, { x: number; z: number; left: boolean }>();
  enabled = true;
  /** prints only where there is snow (set by World: not on the camp's trodden earth) */
  onSnow: (x: number, z: number) => boolean = () => true;

  constructor(scene: THREE.Scene, private readonly max = 220) {
    const geo = new THREE.CircleGeometry(0.5, 7);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xb9cbe2, transparent: true, opacity: 0.75, depthWrite: false });
    this.inst = new THREE.InstancedMesh(geo, mat, max);
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inst.frustumCulled = false;
    this.inst.renderOrder = 1;
    this.inst.count = 0;
    scene.add(this.inst);
  }

  /** Leave a print every `stride` metres. */
  step(who: object, x: number, z: number, stride = 0.6, size = 0.22, life = 7) {
    if (!this.enabled) return;
    const l = this.last.get(who);
    if (!l) { this.last.set(who, { x, z, left: false }); return; }
    const dx = x - l.x, dz = z - l.z;
    if (dx * dx + dz * dz < stride * stride) return;
    if (!this.onSnow(x, z)) { l.x = x; l.z = z; return; }
    const rot = Math.atan2(dx, dz);
    const side = l.left ? 1 : -1;
    const ox = Math.cos(rot) * side * size * 0.7, oz = -Math.sin(rot) * side * size * 0.7;
    const pr: Print = { x: x + ox, z: z + oz, rot, age: 0, life, size };
    if (this.prints.length < this.max) this.prints.push(pr);
    else { this.prints[this.head] = pr; this.head = (this.head + 1) % this.max; }
    l.x = x; l.z = z; l.left = !l.left;
  }

  update(dt: number) {
    let n = 0;
    for (const pr of this.prints) {
      pr.age += dt;
      if (pr.age >= pr.life) continue;
      const k = 1 - pr.age / pr.life;
      const sc = pr.size * Math.min(1, k * 2.5);
      this.q.setFromAxisAngle(this.up, pr.rot);
      this.m.compose(this.p.set(pr.x, 0.045, pr.z), this.q, this.s.set(sc * 0.75, 1, sc * 1.25));
      this.inst.setMatrixAt(n++, this.m);
    }
    this.inst.count = this.enabled ? n : 0;
    this.inst.instanceMatrix.needsUpdate = true;
  }
}
