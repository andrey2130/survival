import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { REGIONS, WORLD, ZONES, MINE, type RegionDef } from '../config/layout';
import { COLORS, Geo, MAT, mesh } from './models';
import { Cell, NavGrid } from './nav';
import { Trees } from './trees';
import { Palisade } from './palisade';
import { inRect } from '../core/math';
import { events } from '../core/events';

/** Deterministic RNG so the map layout is identical between sessions (saves stay valid). */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FogRegion { def: RegionDef; group: THREE.Group; mat: THREE.MeshLambertMaterial; fade: number; removing: boolean }

export class World {
  readonly nav = new NavGrid();
  readonly trees: Trees;
  readonly palisade: Palisade;
  readonly open = new Set<string>();
  private fogs = new Map<string, FogRegion>();
  private snow!: THREE.Points;
  private snowVel!: Float32Array;
  readonly furnaceLight: THREE.PointLight;
  readonly warmAura: THREE.Mesh;
  private obstacles: { x: number; z: number; r: number }[] = [];

  constructor(private scene: THREE.Scene) {
    scene.background = new THREE.Color(0xcfe2f3);
    scene.fog = new THREE.Fog(0xdbe9f6, 58, 120);

    const hemi = new THREE.HemisphereLight(0xeef6ff, 0x7d93b5, 1.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.5);
    sun.position.set(-20, 40, 14);
    scene.add(sun);

    this.furnaceLight = new THREE.PointLight(0xff8a2a, 30, 14, 1.6);
    this.furnaceLight.position.set(0, 2.5, 1);
    scene.add(this.furnaceLight);

    this.warmAura = this.makeAura();
    scene.add(this.warmAura);

    // Nav: everything locked until regions open.
    this.nav.cells.fill(Cell.Locked);
    this.buildGround();
    this.trees = new Trees(scene);
    this.palisade = new Palisade(scene, this.nav);
    for (const r of REGIONS) if (r.open) this.openRegion(r.id, true);
    this.scatterNature();
    this.buildOuterForest();
    this.buildSnowfall();
    for (const r of REGIONS) if (!r.open) this.buildFog(r);
  }

  private makeAura() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,170,60,0.75)');
    grd.addColorStop(0.55, 'rgba(255,140,40,0.25)');
    grd.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.05, -1);
    m.scale.setScalar(BALANCE.furnace.warmRadius * 2);
    m.renderOrder = 2;
    return m;
  }

  private buildGround() {
    const size = (WORLD.max + WORLD.outerForestDepth + 20) * 2;
    const seg = 110;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const snow = new THREE.Color(COLORS.snow), shade = new THREE.Color(COLORS.snowShade), dirt = new THREE.Color(COLORS.dirt);
    const dirtDark = new THREE.Color(0xa86d3e);
    const H = BALANCE.palisade.halfSize;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = Math.sin(x * 0.35) * Math.cos(z * 0.29) * 0.5 + Math.sin(x * 0.9 + z * 0.7) * 0.25;
      c.copy(snow).lerp(shade, Math.max(0, n));
      // trodden earth inside the palisade, with some snow patches
      const inside = Math.max(Math.abs(x), Math.abs(z)) < H - 0.3;
      if (inside && n < 0.25) c.copy(dirt).lerp(dirtDark, Math.max(0, n + 0.3));
      // dirt path to the mine
      if (Math.abs(x) < 1.6 && z < -H && z > -30 && n < 0.3) c.copy(dirt).lerp(snow, 0.45);
      colors.set([c.r, c.g, c.b], i * 3);
      pos.setY(i, inside ? 0 : Math.max(0, n) * 0.08);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.name = 'ground';
    this.scene.add(ground);
  }

  private reservedSpots(): { x: number; z: number; r: number }[] {
    const spots = ZONES.map((z) => ({ x: z.x, z: z.z, r: z.kind === 'expansion' ? 4 : 3.4 }));
    spots.push({ x: MINE.rock.x, z: MINE.rock.z, r: 5 });
    for (const z of ZONES) if (z.kind === 'rail' && z.params?.from && z.params.to) {
      const [ax, az] = z.params.from, [bx, bz] = z.params.to;
      for (let t = 0; t <= 1; t += 0.2) spots.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, r: 2.6 });
    }
    return spots;
  }

  private scatterNature() {
    const rng = mulberry32(1337);
    const reserved = this.reservedSpots();
    const H = BALANCE.palisade.halfSize;
    const placed: { x: number; z: number }[] = [];
    const ok = (x: number, z: number, minD: number) => {
      if (Math.max(Math.abs(x), Math.abs(z)) < H + 2.2) return false; // keep camp interior + wall clear
      if (Math.abs(x) < 2.5 && Math.abs(z) < H + 9) return false; // gate approaches
      if (Math.abs(z) < 2.5 && Math.abs(x) < H + 9) return false;
      for (const s of reserved) if ((s.x - x) ** 2 + (s.z - z) ** 2 < s.r * s.r) return false;
      for (const p of placed) if ((p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD) return false;
      return true;
    };
    for (const r of REGIONS) {
      const [x0, z0, x1, z1] = r.rect;
      // rocks (solid)
      for (let k = 0, tries = 0; k < r.rocks && tries < 400; tries++) {
        const x = x0 + 2 + rng() * (x1 - x0 - 4), z = z0 + 2 + rng() * (z1 - z0 - 4);
        if (!ok(x, z, 3.5)) continue;
        const m = mesh(Geo.rock(k % 3));
        const s = 0.7 + rng() * 0.9;
        m.scale.set(s, s, s);
        m.rotation.y = rng() * 6;
        m.position.set(x, 0, z);
        this.scene.add(m);
        placed.push({ x, z });
        this.obstacles.push({ x, z, r: s * 0.9 });
        k++;
      }
      // trees, clustered
      for (let k = 0, tries = 0; k < r.trees && tries < 2000; tries++) {
        const x = x0 + 1.5 + rng() * (x1 - x0 - 3), z = z0 + 1.5 + rng() * (z1 - z0 - 3);
        if (!ok(x, z, r.bigTrees ? 3.0 : 2.3)) continue;
        this.trees.add(x, z, Math.floor(rng() * 3), !!r.bigTrees && rng() < 0.6, r.id);
        placed.push({ x, z });
        k++;
      }
    }
    this.trees.finalize();
    for (const o of this.obstacles) this.nav.setCircle(o.x, o.z, o.r, Cell.Solid);

    // ice plateaus near the mine
    const plateau = [[-14, -60], [16, -58], [-20, -46], [22, -50]];
    plateau.forEach(([x, z], i) => {
      const m = mesh(Geo.iceBlock(i));
      m.position.set(x, 0, z);
      m.scale.set(1.6, 1.2 + (i % 2) * 0.6, 1.4);
      this.scene.add(m);
      this.nav.setCircle(x, z, 2.6, Cell.Solid);
      this.obstacles.push({ x, z, r: 2.6 });
    });
  }

  /** Dense decorative forest + ice cliffs outside the playable map (one instanced draw call each). */
  private buildOuterForest() {
    const rng = mulberry32(99);
    const pts: { x: number; z: number; s: number }[] = [];
    const inner = WORLD.max - 1.5, outer = WORLD.max + WORLD.outerForestDepth;
    for (let i = 0; i < 1400 && pts.length < 520; i++) {
      const x = -outer + rng() * outer * 2, z = -outer + rng() * outer * 2;
      if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue;
      pts.push({ x, z, s: 0.9 + rng() * 0.6 });
    }
    const geo = Geo.tree(1);
    const inst = new THREE.InstancedMesh(geo, MAT.base, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(p.s, p.s, p.s));
      inst.setMatrixAt(i, m);
    });
    inst.frustumCulled = false;
    this.scene.add(inst);
  }

  private buildSnowfall() {
    const n = 650;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    this.snowVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 60;
      p[i * 3 + 1] = Math.random() * 28;
      p[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.snowVel[i] = 1.2 + Math.random() * 1.6;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({ size: 0.32, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  private buildFog(r: RegionDef) {
    const rng = mulberry32(r.id.length * 7919 + r.rect[0]);
    const [x0, z0, x1, z1] = r.rect;
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xf6faff, transparent: true, opacity: 0.94, flatShading: true, depthWrite: false });
    // a snow cover plane hides the ground detail
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    cover.rotation.x = -Math.PI / 2;
    cover.position.set((x0 + x1) / 2, 2.6, (z0 + z1) / 2);
    group.add(cover);
    // billowing snow-cloud puffs
    const geos: THREE.BufferGeometry[] = [];
    const count = Math.floor(((x1 - x0) * (z1 - z0)) / 45);
    for (let i = 0; i < count; i++) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const s = 2.5 + rng() * 3.5;
      g.scale(s * 1.3, s * 0.7, s * 1.3);
      g.translate(x0 + rng() * (x1 - x0), 1 + rng() * 2.5, z0 + rng() * (z1 - z0));
      geos.push(g);
    }
    // thicker wall along the border with open land
    const step = 3;
    for (let x = x0; x <= x1; x += step) for (const z of [z0, z1]) geos.push(new THREE.IcosahedronGeometry(3, 0).translate(x, 1.5, z));
    for (let z = z0; z <= z1; z += step) for (const x of [x0, x1]) geos.push(new THREE.IcosahedronGeometry(3, 0).translate(x, 1.5, z));
    const merged = new THREE.Mesh(mergeNoAttr(geos), mat);
    group.add(merged);
    group.renderOrder = 5;
    this.scene.add(group);
    this.fogs.set(r.id, { def: r, group, mat, fade: 1, removing: false });
  }

  isOpen(regionId: string) { return this.open.has(regionId); }

  regionAt(x: number, z: number): RegionDef | undefined {
    return REGIONS.find((r) => inRect(x, z, r.rect));
  }

  openRegion(id: string, instant = false) {
    const r = REGIONS.find((q) => q.id === id);
    if (!r || this.open.has(id)) return;
    this.open.add(id);
    const [x0, z0, x1, z1] = r.rect;
    this.nav.setRect(x0, z0, x1, z1, Cell.Free, Cell.Locked);
    for (const o of this.obstacles) if (inRect(o.x, o.z, r.rect)) this.nav.setCircle(o.x, o.z, o.r, Cell.Solid);
    const f = this.fogs.get(id);
    if (f) f.removing = true;
    if (!instant) events.emit('region:opened', { id });
  }

  /** Rect union bounding box of open regions (used for enemy spawns). */
  openBounds() {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of REGIONS) if (this.open.has(r.id)) {
      b = [Math.min(b[0], r.rect[0]), Math.min(b[1], r.rect[1]), Math.max(b[2], r.rect[2]), Math.max(b[3], r.rect[3])];
    }
    return b as [number, number, number, number];
  }

  /** Soft circle obstacles (trees/rocks) pushing the player out. */
  pushOut(x: number, z: number, r: number): { x: number; z: number } {
    for (const t of this.trees.list) {
      if (!t.grown) continue;
      const dx = x - t.x, dz = z - t.z;
      const min = r + BALANCE.tree.radius * (t.big ? 1.4 : 1);
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = t.x + (dx / d) * min;
        z = t.z + (dz / d) * min;
      }
    }
    return { x, z };
  }

  update(dt: number, camTarget: THREE.Vector3, heat01: number, time: number) {
    this.trees.update(dt);
    // snow follows the camera target
    const p = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    const a = p.array as Float32Array;
    for (let i = 0; i < this.snowVel.length; i++) {
      a[i * 3 + 1] -= this.snowVel[i] * dt;
      a[i * 3] += Math.sin(time * 0.7 + i) * dt * 0.4;
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 28;
    }
    p.needsUpdate = true;
    this.snow.position.set(camTarget.x, 0, camTarget.z);
    // wrap X/Z around the target
    for (let i = 0; i < this.snowVel.length; i++) {
      // keep particles in a 60x60 box around the moving origin
      if (a[i * 3] > 30) a[i * 3] -= 60; else if (a[i * 3] < -30) a[i * 3] += 60;
    }
    // furnace warmth visuals
    const flicker = 0.85 + Math.sin(time * 13) * 0.08 + Math.sin(time * 7.3) * 0.07;
    this.furnaceLight.intensity = 22 * heat01 * flicker;
    (this.warmAura.material as THREE.MeshBasicMaterial).opacity = (0.15 + 0.45 * heat01) * flicker;
    this.warmAura.scale.setScalar(BALANCE.furnace.warmRadius * 2 * (0.6 + 0.4 * heat01));
    // fog removal
    for (const [id, f] of this.fogs) {
      if (!f.removing) continue;
      f.fade -= dt * 0.7;
      f.mat.opacity = Math.max(0, f.fade) * 0.94;
      f.group.position.y = (1 - f.fade) * 4;
      f.group.scale.set(1, Math.max(0.01, f.fade), 1);
      if (f.fade <= 0) { this.scene.remove(f.group); this.fogs.delete(id); }
    }
  }
}

function mergeNoAttr(geos: THREE.BufferGeometry[]) {
  // Icosahedrons share attribute layout; simple concatenation.
  let total = 0;
  const flat = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; total += n.attributes.position.count; return n; });
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of flat) { pos.set(g.attributes.position.array as Float32Array, o); o += g.attributes.position.count * 3; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
