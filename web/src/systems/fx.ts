import * as THREE from 'three';
import { Pool } from '../core/pool';
import { MAT } from '../world/models';
import { easeOutCubic } from '../core/math';

interface Flyer {
  m: THREE.Mesh;
  from: THREE.Vector3;
  to: () => THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  spin: number;
  done?: () => void;
  pool: Pool<THREE.Mesh>;
  scaleTo: number;
}

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; color: THREE.Color; grav: number }

/**
 * Juice: items flying in arcs, particle bursts (chips, snow, sparks), scale "pops".
 * Particles are one InstancedMesh => one draw call for all of them.
 */
export class FX {
  private flyers: Flyer[] = [];
  private pools = new Map<THREE.BufferGeometry, Pool<THREE.Mesh>>();
  private particles: Particle[] = [];
  private pinst: THREE.InstancedMesh;
  private readonly maxParticles = 400;
  private pops: { o: THREE.Object3D; t: number; base: number }[] = [];
  private rings: { m: THREE.Mesh; t: number; dur: number; r: number }[] = [];
  private ringPool: Pool<THREE.Mesh>;
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pinst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.maxParticles);
    this.pinst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pinst.setColorAt(0, new THREE.Color());
    this.pinst.count = 0;
    this.pinst.frustumCulled = false;
    scene.add(this.pinst);

    const ringGeo = new THREE.RingGeometry(0.85, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringPool = new Pool<THREE.Mesh>(() => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.renderOrder = 3;
      return m;
    }, (m) => scene.add(m), (m) => scene.remove(m));
  }

  private pool(geo: THREE.BufferGeometry) {
    let p = this.pools.get(geo);
    if (p === undefined) {
      p = new Pool<THREE.Mesh>(() => new THREE.Mesh(geo, MAT.base), (m) => { m.visible = true; this.scene.add(m); }, (m) => this.scene.remove(m));
      p.prewarm(8);
      this.pools.set(geo, p);
    }
    return p as Pool<THREE.Mesh>;
  }

  /** Fly an item mesh along a parabola. `to` is re-evaluated each frame (targets can move). */
  fly(geo: THREE.BufferGeometry, from: THREE.Vector3, to: THREE.Vector3 | (() => THREE.Vector3), opts: { dur?: number; arc?: number; done?: () => void; scale?: number; scaleTo?: number } = {}) {
    const pool = this.pool(geo);
    const m = pool.get();
    m.position.copy(from);
    m.scale.setScalar(opts.scale ?? 1);
    const target = to instanceof THREE.Vector3 ? (() => { const c = to.clone(); return () => c; })() : to;
    this.flyers.push({ m, from: from.clone(), to: target, t: 0, dur: opts.dur ?? 0.32, arc: opts.arc ?? 1.6, spin: (Math.random() - 0.5) * 10, done: opts.done, pool, scaleTo: opts.scaleTo ?? (opts.scale ?? 1) });
  }

  burst(x: number, y: number, z: number, color: number, count = 8, speed = 4, size = 0.14, grav = 14) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y, z, vx: Math.cos(a) * s, vy: speed * (0.6 + Math.random()), vz: Math.sin(a) * s,
        life: 0, max: 0.45 + Math.random() * 0.4, size: size * (0.6 + Math.random() * 0.8), color: c, grav,
      });
    }
  }

  /** Slow rising particles (fire / smoke). */
  rise(x: number, y: number, z: number, color: number, spread = 0.5, size = 0.18) {
    if (this.particles.length >= this.maxParticles) return;
    this.particles.push({
      x: x + (Math.random() - 0.5) * spread, y, z: z + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 0.4, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 0.4,
      life: 0, max: 0.6 + Math.random() * 0.5, size, color: new THREE.Color(color), grav: -0.5,
    });
  }

  /** Expanding ground ring (build complete, explosions, level-ups). */
  ring(x: number, z: number, color: number, radius = 3, dur = 0.5) {
    const m = this.ringPool.get();
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.position.set(x, 0.08, z);
    this.rings.push({ m, t: 0, dur, r: radius });
  }

  /** Squash-and-stretch pop on any object. */
  pop(o: THREE.Object3D, base = 1) {
    const existing = this.pops.find((p) => p.o === o);
    if (existing) { existing.t = 0; return; }
    this.pops.push({ o, t: 0, base });
  }

  update(dt: number) {
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = easeOutCubic(k);
      const to = f.to();
      f.m.position.lerpVectors(f.from, to, e);
      f.m.position.y += Math.sin(k * Math.PI) * f.arc;
      f.m.rotation.y += f.spin * dt;
      f.m.scale.setScalar(f.m.scale.x + (f.scaleTo - f.m.scale.x) * Math.min(1, dt * 10));
      if (k >= 1) {
        f.pool.release(f.m);
        this.flyers.splice(i, 1);
        f.done?.();
      }
    }

    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const s = p.size * (1 - p.life / p.max);
      this.tmpV.set(p.x, p.y, p.z);
      this.tmpQ.identity();
      this.tmpS.set(s, s, s);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.pinst.setMatrixAt(n, this.tmpM);
      this.pinst.setColorAt(n, p.color);
      n++;
    }
    this.pinst.count = n;
    this.pinst.instanceMatrix.needsUpdate = true;
    if (this.pinst.instanceColor) this.pinst.instanceColor.needsUpdate = true;

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const k = p.t / 0.28;
      if (k >= 1) { p.o.scale.setScalar(p.base); this.pops.splice(i, 1); continue; }
      const s = 1 + Math.sin(k * Math.PI) * 0.28 * (1 - k);
      p.o.scale.set(p.base * (2 - s), p.base * s, p.base * (2 - s));
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { this.ringPool.release(r.m); this.rings.splice(i, 1); continue; }
      r.m.scale.setScalar(0.2 + easeOutCubic(k) * r.r);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    }
  }
}
