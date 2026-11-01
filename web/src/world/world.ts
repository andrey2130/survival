import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { ZONES, MINE, SLOTS, CHUNK, WALL_LEVELS, chunkKey, chunkOf, inWorld, regionDef, regionById, stallSpot, squareBounds, type RegionDef, type CampBounds } from '../config/layout';
import { COLORS, Geo, MAT, mesh, WINDOW_MAT, TREE_UNIFORMS } from './models';
import { Cell, NavGrid } from './nav';
import { Trees } from './trees';
import { Palisade } from './palisade';
import { inRect } from '../core/math';
import { events } from '../core/events';
import type { QualityPreset } from '../core/quality';
import { Footprints } from './footprints';
import { onLake, LAKE_COLORS } from '../systems/lake';

/** Deterministic RNG so the map layout is identical between sessions (saves stay valid). */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerpHex = (out: THREE.Color, a: number, b: number, k: number) => { out.setHex(a).lerp(tmpCol.setHex(b), k); };
const tmpCol = new THREE.Color();

let glowTex: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** One material for every chunk's ground mosaic. */
const GROUND_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

interface FogRegion { group: THREE.Group; mat: THREE.MeshLambertMaterial; fade: number; removing: boolean }

interface Chunk {
  def: RegionDef;
  ground: THREE.Mesh;
  treePts: { x: number; z: number; v: number; big: boolean }[];
  decor?: THREE.InstancedMesh;
  fog?: FogRegion;
  real: boolean;
}

/**
 * World — endless chunked map. Open chunks get choppable trees; their locked neighbours are shown as
 * misty decorative forest (cheap instanced trees) until bought. Chunks are generated on demand.
 */
export class World {
  readonly nav = new NavGrid();
  readonly trees: Trees;
  readonly palisade: Palisade;
  readonly open = new Set<string>();
  private chunks = new Map<string, Chunk>();
  private snow!: THREE.Points;
  private snowVel!: Float32Array;
  readonly furnaceLight: THREE.PointLight;
  readonly warmAura: THREE.Mesh;
  private obstacles: { x: number; z: number; r: number }[] = [];
  private rocks: { x: number; z: number; r: number; inst: THREE.InstancedMesh; i: number; gone?: boolean }[] = [];
  private sun!: THREE.DirectionalLight;
  shadows = true;

  /** Keep the shadow frustum centred on the camera target (snapped to texels to avoid shimmering). */
  followSun(t: THREE.Vector3) {
    const step = 68 / this.sun.shadow.mapSize.x;
    const x = Math.round(t.x / step) * step, z = Math.round(t.z / step) * step;
    this.sun.position.set(x - 22, 45, z + 16);
    this.sun.target.position.set(x, 0, z);
  }

  setShadows(on: boolean) {
    this.shadows = on;
    this.sun.castShadow = on;
  }

  /** Quality preset: shadow on/off + map size, amount of falling snow, glow sprites. */
  setQuality(q: QualityPreset) {
    this.setShadows(q.shadows);
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadowMap) {
      sh.mapSize.set(q.shadowMap, q.shadowMap);
      sh.map?.dispose();
      (sh as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.snow.geometry.setDrawRange(0, Math.round(this.snowVel.length * q.snow));
    this.glowOn = q.glow;
    this.footprints.enabled = q.footprints;
  }
  /** additive glow sprites (fire, crystals) — High quality only */
  glowOn = false;
  footprints!: Footprints;

  private hemi: THREE.HemisphereLight;
  private skyTex: THREE.CanvasTexture;
  private skyCanvas: HTMLCanvasElement;
  private skyKey = '';
  /** 0 = noon, 1 = deepest night (day/night cycle) */
  night01 = 0;
  private dayT = 0;
  private glows: THREE.Sprite[] = [];

  constructor(private scene: THREE.Scene) {
    // gradient sky (only the top of the screen sees it); the fog blends the horizon into it
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 2; this.skyCanvas.height = 128;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.skyTex;
    scene.fog = new THREE.Fog(0xd6e6f6, 75, 150);

    // cold sky from above, warmer light bounced off the snow from below
    const hemi = new THREE.HemisphereLight(0xdbe9ff, 0x9a8f86, 1.15);
    this.hemi = hemi;
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.furnaceLight = new THREE.PointLight(0xff8a2a, 30, 14, 1.6);
    this.furnaceLight.position.set(0, 2.5, 1);
    scene.add(this.furnaceLight);

    this.warmAura = this.makeAura();
    scene.add(this.warmAura);
    this.addGlow(0, 2.2, -1, 0xff9a3c, 7);
    this.footprints = new Footprints(scene);
    this.footprints.onSnow = (x, z) => !this.palisade.inside(x, z, 0.5);

    // distant snow plain under everything
    const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: COLORS.snow }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.05;
    far.receiveShadow = true;
    scene.add(far);

    // Nav: everything locked until chunks open.
    this.nav.cells.fill(Cell.Locked);
    this.trees = new Trees(scene);
    this.palisade = new Palisade(scene, this.nav, squareBounds(WALL_LEVELS[0]));
    this.openRegion('camp', true);
    this.buildSnowfall();
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

  /**
   * Chunk ground: a flat-shaded low-poly mosaic — every triangle gets ONE colour, so edges stay crisp.
   * The camp chunk shows trodden earth inside the current wall.
   */
  private buildGround(def: RegionDef) {
    const seg = def.id === 'camp' || def.id === 'lake' ? 34 : 20; // fewer triangles where no detail is painted
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, seg, seg).toNonIndexed();
    geo.rotateX(-Math.PI / 2);
    geo.translate(def.cx * CHUNK, 0, def.cz * CHUNK);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const snow = new THREE.Color(COLORS.snow), shade = new THREE.Color(0xeaf1fa), dirt = new THREE.Color(COLORS.dirt);
    const dirtDark = new THREE.Color(0xbc8250), path = new THREE.Color(0xd9b48e);
    const B = this.palisade.bounds;
    const lake = def.id === 'lake';
    const ice = new THREE.Color(LAKE_COLORS.ice), iceShade = new THREE.Color(LAKE_COLORS.iceShade);
    const c = new THREE.Color();
    const hash = (x: number, z: number) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
    for (let t = 0; t < pos.count; t += 3) {
      const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      const h = hash(Math.round(x * 10), Math.round(z * 10));
      const inside = this.palisade.inside(x, z, 0.2);
      if (inside) {
        const edge = Math.min(x - B.x0, B.x1 - x, z - B.z0, B.z1 - z);
        c.copy(h < 0.5 ? dirt : dirtDark);
        if (edge < 1.6 && h > 0.55) c.copy(snow);
      } else if (lake && onLake(x, z)) {
        c.copy(h < 0.6 ? ice : iceShade); // frozen lake
        if (!onLake(x, z, 0.94) && h > 0.5) c.copy(snow);
      } else {
        c.copy(h < 0.78 ? snow : shade);
        if (Math.abs(x) < 1.4 && z < B.z0 && z > -30 && h < 0.85) c.copy(path); // path to the mine
      }
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (t + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, GROUND_MAT);
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    this.scene.add(ground);
    return ground;
  }

  /** Spots in a chunk that must stay free of trees/rocks (zones, rails, queues, frontier expansions). */
  private reservedSpots(def: RegionDef): { x: number; z: number; r: number }[] {
    const spots = ZONES.filter((z) => inRect(z.x, z.z, def.rect, 4)).map((z) => ({ x: z.x, z: z.z, r: z.params?.clear ?? (z.kind === 'expansion' ? 4 : 3.4) }));
    const c = { x: def.cx * CHUNK, z: def.cz * CHUNK };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) spots.push({ x: c.x + dx * (CHUNK / 2 - 5) + dz * 6, z: c.z + dz * (CHUNK / 2 - 5) + dx * 6, r: 4 });
    if (def.id === 'north') {
      spots.push({ x: MINE.rock.x, z: MINE.rock.z, r: 5 });
      for (const z of ZONES) if (z.kind === 'rail' && z.params?.from && z.params.to) {
        const [ax, az] = z.params.from, [bx, bz] = z.params.to;
        for (let t = 0; t <= 1; t += 0.2) spots.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, r: 2.6 });
      }
      spots.push({ x: 0, z: -40, r: 3 });
      // mine galleries (cave floor + ring of boulders) stay clear of trees and rocks
      for (const l of BALANCE.mine.levels) spots.push({ x: l.center[0], z: l.center[1], r: l.radius + 3 });
    }
    for (const sp of this.queueSpots(this.palisade.bounds)) spots.push(sp);
    return spots;
  }

  /** Customer queue lines outside the south wall for a given wall. */
  queueSpots(b: CampBounds) {
    const out: { x: number; z: number; r: number }[] = [];
    for (const side of [1, -1] as const) {
      const st = stallSpot(side, b);
      for (let i = 0; i < SLOTS.queueMax; i++) { const p = st.queue(i); out.push({ x: p.x, z: p.z, r: 1.9 }); }
    }
    return out;
  }

  /** Is (x,z) inside the camp clearing (current wall + margin, gate approaches)? */
  private inClearing(x: number, z: number) {
    const b = this.palisade.bounds;
    if (this.palisade.inside(x, z, -2.2)) return true;
    if (Math.abs(x) < 2.5 && z > b.z0 - 9 && z < b.z1 + 9) return true; // gate approaches
    if (Math.abs(z) < 2.5 && x > b.x0 - 9 && x < b.x1 + 9) return true;
    return false;
  }

  /** Deterministic nature layout for a chunk (same every session). */
  private layoutChunk(def: RegionDef) {
    const rng = mulberry32((def.cx + 101) * 7919 + (def.cz + 101) * 104729);
    const reserved = this.reservedSpots(def);
    const [x0, z0, x1, z1] = def.rect;
    const placed: { x: number; z: number }[] = [];
    const ok = (x: number, z: number, minD: number) => {
      if (this.inClearing(x, z)) return false;
      if (def.id === 'lake' && onLake(x, z, 1.12)) return false; // nothing grows on the ice
      for (const s of reserved) if ((s.x - x) ** 2 + (s.z - z) ** 2 < s.r * s.r) return false;
      for (const p of placed) if ((p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD) return false;
      return true;
    };
    // rocks: one InstancedMesh per variant per chunk (culled with the chunk), same RNG order as before
    const rockM: THREE.Matrix4[][] = [[], [], []];
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (let k = 0, tries = 0; k < def.rocks && tries < 400; tries++) {
      const x = x0 + 2 + rng() * (x1 - x0 - 4), z = z0 + 2 + rng() * (z1 - z0 - 4);
      if (!ok(x, z, 3.5)) continue;
      const sc = 0.7 + rng() * 0.9;
      q.setFromAxisAngle(up, rng() * 6);
      rockM[k % 3].push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc, sc, sc)));
      placed.push({ x, z });
      this.obstacles.push({ x, z, r: sc * 0.9 });
      this.nav.setCircle(x, z, sc * 0.9, Cell.Solid);
      k++;
    }
    rockM.forEach((list, v) => {
      const inst = this.addStatic(Geo.rock(v), list, def);
      list.forEach((m, i) => { const p = new THREE.Vector3().setFromMatrixPosition(m); this.rocks.push({ x: p.x, z: p.z, r: m.elements[0] * 0.9, inst: inst!, i }); });
    });
    if (def.id === 'north') {
      [[-14, -60], [16, -58], [-20, -46], [22, -50]].forEach(([x, z], i) => {
        const m = mesh(Geo.iceBlock(i));
        m.position.set(x, 0, z);
        m.scale.set(1.6, 1.2 + (i % 2) * 0.6, 1.4);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        this.scene.add(m);
        this.obstacles.push({ x, z, r: 2.6 });
        placed.push({ x, z });
      });
    }
    const pts: Chunk['treePts'] = [];
    for (let k = 0, tries = 0; k < def.trees && tries < 20000; tries++) {
      const x = x0 + 1.2 + rng() * (x1 - x0 - 2.4), z = z0 + 1.2 + rng() * (z1 - z0 - 2.4);
      if (!ok(x, z, def.bigTrees ? 2.4 : 1.6)) continue;
      pts.push({ x, z, v: Math.floor(rng() * 3), big: !!def.bigTrees && rng() < 0.6 });
      placed.push({ x, z });
      k++;
    }
    return pts;
  }

  /** Static repeated props of a chunk as one culled InstancedMesh. */
  private addStatic(geo: THREE.BufferGeometry, mats: THREE.Matrix4[], def: RegionDef) {
    if (!mats.length) return null;
    const inst = new THREE.InstancedMesh(geo, MAT.instanced, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.customDepthMaterial = MAT.instancedDepth;
    inst.boundingSphere = chunkSphere(def);
    this.scene.add(inst);
    return inst;
  }

  /** Make a chunk exist visually (ground, rocks, forest, mist if locked). */
  private ensureChunk(cx: number, cz: number) {
    if (!inWorld(cx, cz)) return;
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) return;
    const def = regionDef(cx, cz);
    const ch: Chunk = { def, ground: this.buildGround(def), treePts: this.layoutChunk(def), real: false };
    this.chunks.set(key, ch);
    if (this.open.has(def.id)) this.makeReal(ch);
    else {
      ch.decor = this.decorForest(ch.treePts);
      ch.fog = this.buildFog(def);
    }
  }

  private makeReal(ch: Chunk) {
    if (ch.real) return;
    ch.real = true;
    if (ch.decor) { this.scene.remove(ch.decor); ch.decor.dispose(); ch.decor = undefined; }
    this.trees.addBatch(ch.treePts.map((p) => ({ ...p, region: ch.def.id })), chunkSphere(ch.def));
  }

  private decorForest(pts: Chunk['treePts']) {
    const inst = new THREE.InstancedMesh(Geo.lowTree(), MAT.trees, Math.max(1, pts.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    pts.forEach((p, i) => {
      const s = (p.big ? 1.4 : 1) * (0.9 + ((i * 37) % 10) / 25);
      q.setFromEuler(e.set(0, i * 1.7, 0));
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m);
    });
    inst.count = pts.length;
    inst.castShadow = false; // misty background forest: shadows would be invisible under the fog anyway
    inst.computeBoundingSphere();
    this.scene.add(inst);
    return inst;
  }

  /**
   * Camp expansion: rebuild the wall, clear trees and boulders inside the new ground (in any chunk the
   * camp now reaches) and repaint those chunks' ground as trodden earth.
   */
  setBounds(bnd: CampBounds) {
    this.palisade.rebuild(bnd);
    const queue = this.queueSpots(bnd);
    const clear = (x: number, z: number, r = 0) => this.inClearing(x, z) || queue.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < (q.r + r) ** 2);
    this.trees.clear((t) => clear(t.x, t.z));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const rk of this.rocks) {
      if (rk.gone || !clear(rk.x, rk.z, rk.r)) continue;
      rk.gone = true;
      rk.inst.setMatrixAt(rk.i, zero);
      rk.inst.instanceMatrix.needsUpdate = true;
      this.nav.setCircle(rk.x, rk.z, rk.r + 0.3, Cell.Free);
      this.obstacles = this.obstacles.filter((o) => o.x !== rk.x || o.z !== rk.z);
    }
    for (const ch of this.chunks.values()) {
      const [x0, z0, x1, z1] = ch.def.rect;
      if (x1 < bnd.x0 - 12 || x0 > bnd.x1 + 12 || z1 < bnd.z0 - 12 || z0 > bnd.z1 + 12) continue;
      this.scene.remove(ch.ground);
      ch.ground.geometry.dispose();
      ch.ground = this.buildGround(ch.def);
    }
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

  private buildFog(r: RegionDef): FogRegion {
    const rng = mulberry32(r.cx * 7919 + r.cz * 31337 + 7);
    const [x0, z0, x1, z1] = r.rect;
    const group = new THREE.Group();
    // light mist: the locked forest stays visible underneath, a snow-drift wall marks the border
    const mat = new THREE.MeshLambertMaterial({ color: 0xf6faff, transparent: true, opacity: 0.55, flatShading: true, depthWrite: false });
    const geos: THREE.BufferGeometry[] = [];
    const count = Math.floor(((x1 - x0) * (z1 - z0)) / 160);
    for (let i = 0; i < count; i++) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const sz = 2 + rng() * 2.5;
      g.scale(sz * 1.4, sz * 0.35, sz * 1.4);
      g.translate(x0 + rng() * (x1 - x0), 1 + rng() * 2.5, z0 + rng() * (z1 - z0));
      geos.push(g);
    }
    const step = 3;
    const drift = (x: number, z: number) => geos.push(new THREE.IcosahedronGeometry(2.4, 0).scale(1, 0.75, 1).translate(x, 0.9, z));
    for (let x = x0; x <= x1; x += step) for (const z of [z0, z1]) drift(x, z);
    for (let z = z0; z <= z1; z += step) for (const x of [x0, x1]) drift(x, z);
    const merged = new THREE.Mesh(mergeNoAttr(geos), mat);
    group.add(merged);
    group.renderOrder = 5;
    this.scene.add(group);
    return { group, mat, fade: 1, removing: false };
  }

  isOpen(regionId: string) { return this.open.has(regionId); }

  regionAt(x: number, z: number): RegionDef {
    const { cx, cz } = chunkOf(x, z);
    return this.chunks.get(chunkKey(cx, cz))?.def ?? regionDef(cx, cz);
  }

  /** Definitions of all open chunks. */
  openRegions(): RegionDef[] {
    return [...this.chunks.values()].filter((c) => this.open.has(c.def.id)).map((c) => c.def);
  }

  openRegion(id: string, instant = false) {
    const r = regionById(id);
    if (!r || this.open.has(id)) return;
    this.open.add(id);
    this.ensureChunk(r.cx, r.cz);
    const ch = this.chunks.get(chunkKey(r.cx, r.cz))!;
    const [x0, z0, x1, z1] = r.rect;
    this.nav.setRect(x0, z0, x1, z1, Cell.Free, Cell.Locked);
    for (const o of this.obstacles) if (inRect(o.x, o.z, r.rect)) this.nav.setCircle(o.x, o.z, o.r, Cell.Solid);
    this.makeReal(ch);
    if (ch.fog) ch.fog.removing = true;
    // reveal the neighbourhood as misty forest
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.ensureChunk(r.cx + dx, r.cz + dz);
    if (!instant) events.emit('region:opened', { id });
  }

  /** Bounding box of open chunks (used for enemy spawns). */
  openBounds() {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of this.openRegions()) {
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

  /** Additive glow sprite (fire, crystals) — shown on High quality only, stronger at night. */
  addGlow(x: number, y: number, z: number, color: number, size: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.renderOrder = 6;
    s.visible = false;
    this.scene.add(s);
    this.glows.push(s);
    return s;
  }

  /**
   * Day / night: light colours, fog and sky drift through a slow cycle. Nights stay readable on a
   * phone (moonlit blue, not black); the fire and glowing windows carry the mood.
   */
  private updateDayNight(dt: number, time: number) {
    const D = BALANCE.dayNight;
    this.dayT = (this.dayT + dt / D.cycleSeconds) % 1;
    // smooth: 0 at noon (t=0), 1 around midnight (t=0.5), short dusk/dawn
    const c = Math.cos(this.dayT * Math.PI * 2);
    this.night01 = Math.min(1, Math.max(0, (0.25 - c) / 0.75)) ** 1.4 * D.nightStrength;
    const n = this.night01;
    lerpHex(this.sun.color, 0xfff0d8, 0x9db8ff, n);
    this.sun.intensity = 2.3 - 1.5 * n;
    lerpHex(this.hemi.color, 0xdbe9ff, 0x7d93c8, n);
    lerpHex(this.hemi.groundColor, 0x9a8f86, 0x3e4a6e, n);
    this.hemi.intensity = 1.15 - 0.45 * n;
    lerpHex((this.scene.fog as THREE.Fog).color, 0xd6e6f6, 0x4a5f8c, n);
    WINDOW_MAT.color.setRGB(0.35 + 0.65 * n, 0.27 + 0.5 * n, 0.15 + 0.25 * n);
    TREE_UNIFORMS.uTime.value = time;
    // repaint the sky only when it visibly changed
    const key = n.toFixed(2);
    if (key !== this.skyKey) {
      this.skyKey = key;
      const g = this.skyCanvas.getContext('2d')!;
      const grd = g.createLinearGradient(0, 0, 0, 128);
      const top = new THREE.Color(0x7fb2e6).lerp(new THREE.Color(0x1a2547), n);
      const hor = new THREE.Color((this.scene.fog as THREE.Fog).color);
      grd.addColorStop(0, `#${top.getHexString()}`);
      grd.addColorStop(1, `#${hor.getHexString()}`);
      g.fillStyle = grd;
      g.fillRect(0, 0, 2, 128);
      this.skyTex.needsUpdate = true;
    }
    for (const s of this.glows) {
      s.visible = this.glowOn;
      (s.material as THREE.SpriteMaterial).opacity = 0.35 + 0.45 * n;
    }
  }

  update(dt: number, camTarget: THREE.Vector3, heat01: number, time: number) {
    this.trees.update(dt);
    this.updateDayNight(dt, time);
    this.footprints.update(dt);
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
    this.furnaceLight.intensity = 22 * heat01 * flicker * (1 + this.night01 * 0.8);
    (this.warmAura.material as THREE.MeshBasicMaterial).opacity = (0.08 + 0.27 * heat01) * flicker;
    this.warmAura.scale.setScalar(BALANCE.furnace.warmRadius * 2 * (0.6 + 0.4 * heat01));
    // fog removal
    for (const ch of this.chunks.values()) {
      const f = ch.fog;
      if (!f || !f.removing) continue;
      f.fade -= dt * 0.7;
      f.mat.opacity = Math.max(0, f.fade) * 0.55;
      f.group.position.y = (1 - f.fade) * 4;
      if (f.fade <= 0) { this.scene.remove(f.group); f.mat.dispose(); ch.fog = undefined; }
    }
  }
}

/** Bounding sphere of a whole chunk (instanced props are culled per chunk). */
export function chunkSphere(def: RegionDef) {
  const [x0, z0, x1, z1] = def.rect;
  return new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, 2, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0) / 2 + 4);
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
