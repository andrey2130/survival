import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural low-poly models. Every model is ONE merged BufferGeometry with vertex colors,
 * rendered with a single shared material => one draw call per object, tiny memory.
 */

export const MAT = {
  base: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  ghost: new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.32, depthWrite: false }),
};

export const COLORS = {
  snow: 0xf4f8ff,
  snowShade: 0xd9e6f5,
  pineDark: 0x1f4f6b,
  pine: 0x2c6c8c,
  pineLight: 0x3f86a8,
  trunk: 0x7a4a2a,
  wood: 0xb06a35,
  woodLight: 0xd08a4a,
  woodDark: 0x6e3b1c,
  stone: 0x7f8ea3,
  stoneDark: 0x5b677a,
  ice: 0xa9d6f0,
  rock: 0x6f7f96,
  bearWhite: 0xf2f2ee,
  bearShade: 0xd6d6cf,
  nose: 0x222222,
  skin: 0xf2c49b,
  red: 0xd9443a,
  orange: 0xff8a1e,
  yellow: 0xffd23f,
  gold: 0xffc93c,
  goldDark: 0xd99a15,
  meat: 0xd2483f,
  meatFat: 0xf3d6c8,
  cooked: 0x8a4a22,
  cash: 0x4cb04a,
  cashDark: 0x2e7d32,
  metal: 0x5a5f6a,
  blue: 0x3a7bd5,
  purple: 0x7b5cd6,
  dirt: 0xc58a55,
};

type V3 = [number, number, number];

class Builder {
  private parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...scale),
    );
    g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // subtle per-face shade variation for a hand-painted look
      const k = 0.94 + ((Math.floor(i / 3) * 7919) % 13) / 100;
      arr[i * 3] = Math.min(1, c.r * k);
      arr[i * 3 + 1] = Math.min(1, c.g * k);
      arr[i * 3 + 2] = Math.min(1, c.b * k);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (g.attributes.normal === undefined) g.computeVertexNormals();
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, pos?: V3, rot?: V3) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot);
  }
  cyl(rt: number, rb: number, h: number, seg: number, color: number, pos?: V3, rot?: V3) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, pos, rot);
  }
  cone(r: number, h: number, seg: number, color: number, pos?: V3, rot?: V3) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, rot);
  }
  ball(r: number, color: number, pos?: V3, scale?: V3, detail = 0) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, pos, [0, 0, 0], scale);
  }
  dodeca(r: number, color: number, pos?: V3, scale?: V3, rot?: V3) {
    return this.add(new THREE.DodecahedronGeometry(r, 0), color, pos, rot ?? [0, 0, 0], scale);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const cache = new Map<string, THREE.BufferGeometry>();
const memo = (key: string, f: () => THREE.BufferGeometry) => {
  let g = cache.get(key);
  if (!g) { g = f(); cache.set(key, g); }
  return g;
};

export const mesh = (geo: THREE.BufferGeometry): THREE.Mesh => {
  const m = new THREE.Mesh(geo, MAT.base);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

// ---------------- nature ----------------

export const Geo = {
  tree: (v: number, big = false) => memo(`tree${v}${big}`, () => {
    const b = new Builder();
    const s = big ? 1.45 : 1;
    const h = [1, 1.15, 0.9][v % 3] * s;
    const col = [COLORS.pine, COLORS.pineDark, COLORS.pineLight][v % 3];
    b.cyl(0.18 * s, 0.24 * s, 0.9 * h, 6, COLORS.trunk, [0, 0.45 * h, 0]);
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const r = (1.25 - i * 0.3) * s;
      const y = (0.9 + i * 0.75) * h;
      b.cone(r, 1.25 * h, 7, col, [0, y + 0.55 * h, 0], [0, i * 0.4, 0]);
      // snow cap on each tier
      b.cone(r * 0.62, 0.55 * h, 7, COLORS.snow, [0, y + 0.95 * h, 0], [0, i * 0.4, 0]);
    }
    return b.build();
  }),

  /** Cheap 2-tier tree for the decorative background forest (~50 triangles). */
  lowTree: () => memo('lowTree', () => new Builder()
    .cone(1.3, 1.9, 6, COLORS.pineDark, [0, 1.3, 0])
    .cone(0.95, 1.7, 6, COLORS.pine, [0, 2.4, 0], [0, 0.5, 0])
    .cone(0.55, 0.8, 6, COLORS.snow, [0, 3.05, 0], [0, 0.5, 0])
    .build()),

  stump: (big = false) => memo(`stump${big}`, () => {
    const s = big ? 1.4 : 1;
    return new Builder()
      .cyl(0.24 * s, 0.3 * s, 0.35, 7, COLORS.trunk, [0, 0.17, 0])
      .cyl(0.21 * s, 0.21 * s, 0.04, 7, COLORS.woodLight, [0, 0.36, 0])
      .cyl(0.22 * s, 0.26 * s, 0.08, 7, COLORS.snow, [0, 0.4, 0])
      .build();
  }),

  rock: (v: number) => memo(`rock${v}`, () => {
    const b = new Builder();
    b.dodeca(1, v % 2 ? COLORS.rock : COLORS.stone, [0, 0.4, 0], [1.2, 0.8, 1], [0, v, 0]);
    b.dodeca(0.7, COLORS.snow, [0.1, 0.85, 0], [1.1, 0.35, 0.9], [0, v * 2, 0]);
    return b.build();
  }),

  iceBlock: (v: number) => memo(`ice${v}`, () => {
    const b = new Builder();
    b.box(3, 2.2, 3, COLORS.stoneDark, [0, 1.1, 0], [0, v * 0.7, 0]);
    b.box(3.1, 0.35, 3.1, COLORS.snow, [0, 2.3, 0], [0, v * 0.7, 0]);
    return b.build();
  }),

  goldRock: () => memo('goldRock', () => {
    const b = new Builder();
    b.dodeca(2.2, COLORS.stoneDark, [0, 1.3, 0], [1.3, 1, 1.1]);
    b.dodeca(0.7, COLORS.gold, [1.1, 1.6, 1.2], [1, 1.2, 1]);
    b.dodeca(0.6, COLORS.gold, [-1.2, 1.2, 1.3]);
    b.dodeca(0.5, COLORS.goldDark, [0.2, 2.5, 1]);
    b.dodeca(0.9, COLORS.gold, [-0.4, 0.8, 1.9], [1, 0.8, 1]);
    b.dodeca(1.4, COLORS.snow, [0, 2.9, -0.3], [1.3, 0.35, 1.1]);
    return b.build();
  }),

  // ---------------- items ----------------
  log: () => memo('log', () => new Builder()
    .cyl(0.17, 0.17, 0.9, 7, COLORS.wood, [0, 0, 0], [0, 0, Math.PI / 2])
    .cyl(0.13, 0.13, 0.92, 7, COLORS.woodLight, [0, 0, 0], [0, 0, Math.PI / 2])
    .build()),

  meat: () => memo('meat', () => new Builder()
    .ball(0.28, COLORS.meat, [0, 0, 0], [1.2, 0.5, 0.9])
    .ball(0.12, COLORS.meatFat, [0.18, 0.05, 0.1], [1, 0.6, 1])
    .cyl(0.05, 0.05, 0.3, 5, COLORS.meatFat, [-0.35, 0, 0], [0, 0, Math.PI / 2])
    .build()),

  cooked: () => memo('cooked', () => new Builder()
    .ball(0.28, COLORS.cooked, [0, 0, 0], [1.2, 0.5, 0.9])
    .box(0.4, 0.02, 0.05, 0x3a1e0c, [0, 0.14, 0.05])
    .box(0.4, 0.02, 0.05, 0x3a1e0c, [0, 0.14, -0.12])
    .cyl(0.05, 0.05, 0.3, 5, COLORS.meatFat, [-0.35, 0, 0], [0, 0, Math.PI / 2])
    .build()),

  ore: () => memo('ore', () => new Builder()
    .dodeca(0.22, COLORS.stone, [0, 0, 0])
    .dodeca(0.12, COLORS.gold, [0.1, 0.1, 0.08])
    .build()),

  cash: () => memo('cash', () => new Builder()
    .box(0.62, 0.14, 0.34, COLORS.cash)
    .box(0.64, 0.15, 0.08, 0xffffff, [0, 0, 0])
    .box(0.12, 0.155, 0.12, COLORS.cashDark, [0, 0, 0])
    .build()),

  goldBar: () => memo('goldBar', () => new Builder()
    .box(0.5, 0.2, 0.26, COLORS.gold)
    .box(0.4, 0.06, 0.18, 0xffe27a, [0, 0.12, 0])
    .build()),

  // ---------------- characters ----------------
  // Characters are split in body + legs + arm so they can be animated cheaply.
  humanBody: (shirt: number, hat: number) => memo(`hb${shirt}_${hat}`, () => new Builder()
    .box(0.62, 0.7, 0.42, shirt, [0, 0.95, 0])
    .box(0.66, 0.12, 0.46, 0x5a3a24, [0, 0.66, 0]) // belt
    .box(0.5, 0.48, 0.46, COLORS.skin, [0, 1.56, 0])
    .box(0.08, 0.08, 0.02, 0x222222, [0.12, 1.6, 0.235])
    .box(0.08, 0.08, 0.02, 0x222222, [-0.12, 1.6, 0.235])
    .box(0.6, 0.22, 0.56, hat, [0, 1.86, 0])
    .box(0.36, 0.18, 0.36, hat, [0, 2.02, 0])
    .ball(0.1, 0xffffff, [0, 2.15, 0])
    .box(0.18, 0.5, 0.18, shirt, [-0.4, 1.0, 0])
    .build()),

  humanLeg: () => memo('hleg', () => new Builder()
    .box(0.22, 0.5, 0.24, 0x3b4a6b, [0, -0.25, 0])
    .box(0.24, 0.14, 0.32, 0x3a2a1e, [0, -0.5, 0.04])
    .build()),

  humanArm: (shirt: number) => memo(`harm${shirt}`, () => new Builder()
    .box(0.18, 0.55, 0.18, shirt, [0, -0.25, 0])
    .box(0.16, 0.14, 0.16, COLORS.skin, [0, -0.55, 0])
    .build()),

  axe: () => memo('axe', () => new Builder()
    .cyl(0.04, 0.04, 0.85, 5, COLORS.woodDark, [0, -0.6, 0.35], [Math.PI / 2.2, 0, 0])
    .box(0.06, 0.3, 0.26, 0xb9c4cf, [0, -0.62, 0.72], [Math.PI / 2.2, 0, 0])
    .build()),

  /** Big axe used by the hero's spinning attack (blade points outward along +X). */
  spinAxe: () => memo('spinAxe', () => new Builder()
    .box(1.3, 0.12, 0.12, COLORS.woodDark, [-0.35, 0, 0])
    .box(0.5, 0.1, 0.7, 0xc9d3de, [0.35, 0, 0])
    .box(0.12, 0.11, 0.78, 0xeef3f8, [0.58, 0, 0])
    .box(0.18, 0.16, 0.2, 0x555c66, [0.08, 0, 0])
    .build()),

  spear: () => memo('spear', () => new Builder()
    .cyl(0.035, 0.035, 1.5, 5, COLORS.woodDark, [0, -0.55, 0.3], [Math.PI / 2.4, 0, 0])
    .cone(0.07, 0.25, 5, 0xb9c4cf, [0, -0.3, 1.05], [Math.PI / 2.4, 0, 0])
    .build()),

  pickaxe: () => memo('pickaxe', () => new Builder()
    .cyl(0.04, 0.04, 0.85, 5, COLORS.woodDark, [0, -0.6, 0.35], [Math.PI / 2.2, 0, 0])
    .box(0.06, 0.08, 0.6, 0x8d98a5, [0, -0.62, 0.72], [0, 0, 0])
    .build()),

  bear: (white = true) => memo(`bear${white}`, () => {
    const c = white ? COLORS.bearWhite : 0x8a8f99;
    const sh = white ? COLORS.bearShade : 0x6c717b;
    return new Builder()
      .box(1.1, 0.9, 1.7, c, [0, 0.95, 0])
      .box(1.0, 0.8, 0.7, sh, [0, 1.05, -0.6])
      .box(0.75, 0.68, 0.7, c, [0, 1.25, 1.05]) // head
      .box(0.42, 0.32, 0.36, sh, [0, 1.1, 1.5]) // snout
      .box(0.16, 0.12, 0.08, COLORS.nose, [0, 1.22, 1.68])
      .box(0.08, 0.08, 0.04, 0x111111, [0.2, 1.42, 1.41])
      .box(0.08, 0.08, 0.04, 0x111111, [-0.2, 1.42, 1.41])
      .box(0.18, 0.18, 0.12, c, [0.27, 1.65, 0.95])
      .box(0.18, 0.18, 0.12, c, [-0.27, 1.65, 0.95])
      .build();
  }),

  bearLeg: (white = true) => memo(`bleg${white}`, () => new Builder()
    .box(0.32, 0.6, 0.36, white ? COLORS.bearShade : 0x6c717b, [0, -0.3, 0])
    .build()),

  wolf: () => memo('wolf', () => new Builder()
    .box(0.6, 0.55, 1.3, 0x9aa3ad, [0, 0.8, 0])
    .box(0.5, 0.48, 0.55, 0xb7bec6, [0, 1.05, 0.8])
    .box(0.28, 0.22, 0.4, 0xd8dde2, [0, 0.95, 1.2])
    .box(0.1, 0.08, 0.06, COLORS.nose, [0, 1.02, 1.42])
    .box(0.12, 0.22, 0.1, 0x9aa3ad, [0.16, 1.38, 0.72])
    .box(0.12, 0.22, 0.1, 0x9aa3ad, [-0.16, 1.38, 0.72])
    .box(0.07, 0.07, 0.03, 0xffd23f, [0.13, 1.14, 1.08])
    .box(0.07, 0.07, 0.03, 0xffd23f, [-0.13, 1.14, 1.08])
    .box(0.16, 0.16, 0.7, 0xb7bec6, [0, 0.95, -0.85], [0.6, 0, 0])
    .build()),

  wolfLeg: () => memo('wleg', () => new Builder().box(0.16, 0.5, 0.18, 0x7d858f, [0, -0.25, 0]).build()),

  // ---------------- buildings ----------------
  /** Open fire pit: stone ring, iron cauldron, glowing coals (flames are a separate animated mesh). */
  furnace: () => memo('furnace', () => {
    const b = new Builder();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.dodeca(0.5, i % 2 ? COLORS.stone : COLORS.stoneDark, [Math.cos(a) * 2.1, 0.32, Math.sin(a) * 2.1], [1.1, 0.8, 1], [0, a, 0]);
      b.dodeca(0.32, COLORS.snow, [Math.cos(a) * 2.1, 0.68, Math.sin(a) * 2.1], [1.1, 0.4, 1]);
    }
    b.cyl(1.6, 1.8, 0.35, 12, 0x5a4636, [0, 0.18, 0]);
    b.cyl(1.55, 1.0, 1.7, 12, 0x6b5242, [0, 1.2, 0]);
    b.cyl(1.7, 1.7, 0.22, 12, 0x3d2e24, [0, 2.1, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.box(0.22, 1.8, 0.22, 0x3d2e24, [Math.cos(a) * 1.25, 0.9, Math.sin(a) * 1.25], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]);
    }
    b.cyl(1.45, 1.45, 0.12, 12, 0xff7a1a, [0, 2.2, 0]);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9;
      b.dodeca(0.28, i % 2 ? 0xffb12e : 0xc4421a, [Math.cos(a) * 0.8, 2.3, Math.sin(a) * 0.8]);
    }
    return b.build();
  }),

  flame: () => memo('flame', () => new Builder()
    .cone(1.05, 2.2, 7, 0xff7a1a, [0, 1.1, 0])
    .cone(0.75, 2.7, 7, 0xffb12e, [0.2, 1.35, 0.1], [0, 0.5, 0])
    .cone(0.45, 2.0, 6, 0xffe27a, [-0.15, 1.0, -0.1], [0, 1.1, 0])
    .build()),

  counter: (roof: number = COLORS.red) => memo(`counter${roof}`, () => {
    const b = new Builder();
    b.box(3.4, 1.0, 1.2, COLORS.wood, [0, 0.5, 0]);
    b.box(3.6, 0.15, 1.4, COLORS.woodLight, [0, 1.05, 0]);
    b.box(0.2, 2.2, 0.2, COLORS.woodDark, [1.6, 1.1, -0.6]);
    b.box(0.2, 2.2, 0.2, COLORS.woodDark, [-1.6, 1.1, -0.6]);
    b.box(0.2, 2.2, 0.2, COLORS.woodDark, [1.6, 1.1, 0.6]);
    b.box(0.2, 2.2, 0.2, COLORS.woodDark, [-1.6, 1.1, 0.6]);
    b.box(4.0, 0.25, 2.0, roof, [0, 2.3, 0], [0.12, 0, 0]);
    b.box(4.05, 0.12, 2.05, COLORS.snow, [0, 2.45, 0], [0.12, 0, 0]);
    b.box(1.6, 0.5, 0.1, COLORS.woodLight, [0, 1.75, 0.65]);
    return b.build();
  }),

  tent: () => memo('tent', () => {
    const b = new Builder();
    b.add(new THREE.ConeGeometry(1.6, 2.2, 4), 0x9b6b43, [0, 1.1, 0], [0, Math.PI / 4, 0]);
    b.add(new THREE.ConeGeometry(1.0, 0.8, 4), COLORS.snow, [0, 1.9, 0], [0, Math.PI / 4, 0]);
    b.box(0.7, 1.0, 0.1, 0x3a2414, [0, 0.5, 1.12]);
    return b.build();
  }),

  house: () => memo('house', () => {
    const b = new Builder();
    b.box(3.2, 2.0, 2.6, COLORS.wood, [0, 1, 0]);
    for (let i = 0; i < 4; i++) b.box(3.3, 0.12, 2.7, COLORS.woodDark, [0, 0.3 + i * 0.5, 0]);
    b.add(new THREE.CylinderGeometry(0.01, 2.3, 1.6, 4), COLORS.woodDark, [0, 2.8, 0], [0, Math.PI / 4, 0], [1.05, 1, 0.8]);
    b.add(new THREE.CylinderGeometry(0.01, 2.2, 1.35, 4), COLORS.snow, [0, 3.0, 0], [0, Math.PI / 4, 0], [1.05, 1, 0.8]);
    b.box(0.8, 1.3, 0.1, 0x4a2a14, [0, 0.65, 1.31]);
    b.box(0.6, 0.5, 0.1, 0xffd56b, [1.0, 1.2, 1.31]);
    b.box(0.5, 1.2, 0.5, COLORS.stoneDark, [1.0, 3.2, -0.5]);
    return b.build();
  }),

  lumberhut: () => memo('lumberhut', () => {
    const b = new Builder();
    b.box(3.4, 1.8, 2.4, COLORS.woodDark, [0, 0.9, -0.3]);
    b.box(3.8, 0.3, 3.0, COLORS.wood, [0, 2.0, -0.2], [0.18, 0, 0]);
    b.box(3.85, 0.15, 3.05, COLORS.snow, [0, 2.2, -0.2], [0.18, 0, 0]);
    b.box(1.0, 1.2, 0.1, 0x3a2414, [-0.8, 0.6, 0.91]);
    b.box(0.1, 0.8, 0.6, 0xb9c4cf, [1.0, 1.1, 0.95], [0, 0, 0.4]);
    b.cyl(0.4, 0.45, 0.5, 8, COLORS.trunk, [1.4, 0.25, 1.4]);
    return b.build();
  }),

  kitchen: () => memo('kitchen', () => {
    const b = new Builder();
    b.box(3.0, 1.0, 1.8, COLORS.stone, [0, 0.5, 0]);
    b.box(2.6, 0.1, 1.4, 0x333333, [0, 1.05, 0]);
    for (let i = -2; i <= 2; i++) b.box(0.05, 0.05, 1.4, 0x888888, [i * 0.5, 1.12, 0]);
    b.box(1.2, 0.3, 0.6, COLORS.orange, [0, 0.95, 0.2]);
    b.box(0.2, 2.6, 0.2, COLORS.woodDark, [1.4, 1.3, -0.8]);
    b.box(0.2, 2.6, 0.2, COLORS.woodDark, [-1.4, 1.3, -0.8]);
    b.box(3.4, 0.2, 2.4, 0x2f7d6d, [0, 2.6, -0.2], [0.15, 0, 0]);
    b.box(3.45, 0.1, 2.45, COLORS.snow, [0, 2.73, -0.2], [0.15, 0, 0]);
    b.cyl(0.35, 0.3, 0.5, 8, 0x444444, [-0.9, 1.35, -0.2]);
    return b.build();
  }),

  diner: () => memo('diner', () => {
    const b = new Builder();
    b.box(3.4, 0.15, 1.6, COLORS.woodLight, [0, 0.95, 0]);
    b.box(0.2, 0.9, 0.2, COLORS.woodDark, [1.5, 0.45, 0.6]);
    b.box(0.2, 0.9, 0.2, COLORS.woodDark, [-1.5, 0.45, 0.6]);
    b.box(0.2, 0.9, 0.2, COLORS.woodDark, [1.5, 0.45, -0.6]);
    b.box(0.2, 0.9, 0.2, COLORS.woodDark, [-1.5, 0.45, -0.6]);
    b.box(3.4, 0.12, 0.5, COLORS.wood, [0, 0.5, 1.25]);
    b.box(3.4, 0.12, 0.5, COLORS.wood, [0, 0.5, -1.25]);
    b.box(3.6, 0.1, 1.8, 0xc94f43, [0, 1.03, 0]);
    return b.build();
  }),

  tower: () => memo('tower', () => {
    const b = new Builder();
    for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) b.box(0.3, 3.2, 0.3, COLORS.woodDark, [x, 1.6, z]);
    b.box(2.1, 0.12, 0.15, COLORS.wood, [0, 1.2, 0.9], [0, 0, 0.6]);
    b.box(2.1, 0.12, 0.15, COLORS.wood, [0, 1.2, -0.9], [0, 0, -0.6]);
    b.box(2.6, 0.3, 2.6, COLORS.wood, [0, 3.3, 0]);
    b.box(2.7, 0.15, 2.7, COLORS.snow, [0, 3.0, 0]);
    for (const [x, z, w, d] of [[0, 1.25, 2.6, 0.12], [0, -1.25, 2.6, 0.12], [1.25, 0, 0.12, 2.6], [-1.25, 0, 0.12, 2.6]]) b.box(w, 0.5, d, COLORS.woodLight, [x, 3.7, z]);
    return b.build();
  }),

  ballista: () => memo('ballista', () => new Builder()
    .box(0.4, 0.4, 1.6, COLORS.metal, [0, 0.2, 0])
    .box(1.8, 0.12, 0.16, COLORS.woodDark, [0, 0.25, 0.5], [0, 0, 0])
    .box(0.18, 0.18, 1.2, COLORS.woodLight, [0, 0.45, 0.2])
    .cone(0.1, 0.3, 4, 0xb9c4cf, [0, 0.45, 0.95], [Math.PI / 2, 0, 0])
    .box(0.05, 0.05, 1.4, 0xdddddd, [0.45, 0.28, 0.1], [0, -0.55, 0])
    .box(0.05, 0.05, 1.4, 0xdddddd, [-0.45, 0.28, 0.1], [0, 0.55, 0])
    .build()),

  cannon: () => memo('cannon', () => new Builder()
    .box(1.0, 0.4, 1.2, COLORS.woodDark, [0, 0.2, 0])
    .cyl(0.3, 0.38, 1.6, 10, 0x3d4552, [0, 0.55, 0.3], [Math.PI / 2 - 0.25, 0, 0])
    .cyl(0.32, 0.32, 0.12, 10, 0x262b33, [0, 0.75, 1.05], [Math.PI / 2 - 0.25, 0, 0])
    .build()),

  bolt: () => memo('bolt', () => new Builder()
    .box(0.08, 0.08, 0.9, COLORS.woodDark)
    .cone(0.09, 0.25, 4, 0xb9c4cf, [0, 0, 0.55], [Math.PI / 2, 0, 0])
    .build()),

  shell: () => memo('shell', () => new Builder().ball(0.22, 0x2a2e36, [0, 0, 0], [1, 1, 1], 1).build()),

  firetrap: () => memo('firetrap', () => {
    const b = new Builder();
    b.cyl(1.3, 1.4, 0.2, 10, COLORS.stoneDark, [0, 0.1, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(0.5, 0.25, 0.25, COLORS.woodDark, [Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5], [0, -a, 0.2]);
    }
    return b.build();
  }),

  palisadeLogs: (len: number, stone = false) => memo(`pal${len.toFixed(2)}${stone}`, () => {
    const b = new Builder();
    if (stone) {
      const n = Math.max(1, Math.round(len / 1.2));
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + (i + 0.5) * (len / n);
        b.box(len / n - 0.05, 2.4, 1.0, i % 2 ? COLORS.stone : COLORS.stoneDark, [x, 1.2, 0]);
        b.box(len / n * 0.6, 0.5, 1.0, COLORS.stone, [x, 2.65, 0]);
        b.box(len / n - 0.05, 0.14, 1.05, COLORS.snow, [x, 2.45, 0]);
      }
      return b.build();
    }
    const n = Math.max(1, Math.round(len / 0.42));
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + (i + 0.5) * (len / n);
      const h = 1.9 + ((i * 37) % 5) * 0.08;
      b.cyl(0.2, 0.2, h, 6, i % 2 ? COLORS.wood : COLORS.woodDark, [x, h / 2, 0]);
      b.cone(0.2, 0.45, 6, COLORS.woodLight, [x, h + 0.22, 0]);
    }
    b.box(len, 0.16, 0.12, COLORS.woodDark, [0, 0.7, 0.22]);
    b.box(len, 0.16, 0.12, COLORS.woodDark, [0, 1.4, 0.22]);
    b.box(len, 0.25, 0.7, COLORS.snow, [0, 0.12, 0]);
    return b.build();
  }),

  palisadeBroken: (len: number) => memo(`palb${len.toFixed(2)}`, () => {
    const b = new Builder();
    const n = Math.max(1, Math.round(len / 0.42));
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + (i + 0.5) * (len / n);
      const h = 0.3 + ((i * 53) % 4) * 0.12;
      b.cyl(0.2, 0.2, h, 6, COLORS.woodDark, [x, h / 2, 0]);
    }
    b.box(len, 0.2, 0.7, COLORS.snow, [0, 0.1, 0]);
    return b.build();
  }),

  gate: (len: number, stone = false) => memo(`gate${len}${stone}`, () => {
    const b = new Builder();
    const c = stone ? COLORS.stoneDark : COLORS.woodDark;
    b.box(0.5, 3.0, 0.5, c, [len / 2, 1.5, 0]);
    b.box(0.5, 3.0, 0.5, c, [-len / 2, 1.5, 0]);
    b.box(len + 0.6, 0.4, 0.5, c, [0, 3.0, 0]);
    b.box(len + 0.7, 0.15, 0.6, COLORS.snow, [0, 3.25, 0]);
    return b.build();
  }),

  gateDoor: (len: number) => memo(`gdoor${len}`, () => {
    const b = new Builder();
    const n = Math.round(len / 0.45);
    for (let i = 0; i < n; i++) b.box(len / n - 0.04, 1.8, 0.16, i % 2 ? COLORS.wood : COLORS.woodLight, [(i + 0.5) * (len / n), 0.9, 0]);
    b.box(len, 0.15, 0.2, COLORS.woodDark, [len / 2, 0.5, 0.05]);
    b.box(len, 0.15, 0.2, COLORS.woodDark, [len / 2, 1.3, 0.05]);
    return b.build();
  }),

  mineStation: () => memo('minestation', () => {
    const b = new Builder();
    b.box(3, 0.4, 2.4, COLORS.woodDark, [0, 0.2, 0]);
    for (const [x, z] of [[-1.3, -1], [1.3, -1], [-1.3, 1], [1.3, 1]]) b.box(0.2, 2.6, 0.2, COLORS.wood, [x, 1.3, z]);
    b.box(3.2, 0.25, 2.6, COLORS.woodLight, [0, 2.7, 0]);
    b.box(3.3, 0.12, 2.7, COLORS.snow, [0, 2.88, 0]);
    b.box(1.2, 0.8, 1.2, 0x8a5a2a, [0, 1.8, 0]); // hopper
    return b.build();
  }),

  smelter: () => memo('smelter', () => {
    const b = new Builder();
    b.box(3.4, 2.2, 3.0, COLORS.stoneDark, [0, 1.1, 0]);
    b.box(1.4, 1.0, 0.2, COLORS.orange, [0, 0.8, 1.5]);
    b.box(0.9, 0.6, 0.22, COLORS.yellow, [0, 0.7, 1.52]);
    b.cyl(0.5, 0.6, 2.4, 8, COLORS.stone, [0.9, 3.2, -0.5]);
    b.box(3.6, 0.2, 3.2, COLORS.snow, [0, 2.25, 0]);
    b.box(2.0, 0.3, 1.2, COLORS.metal, [0, 0.15, 2.4]);
    return b.build();
  }),

  rail: (len: number) => memo(`rail${len.toFixed(2)}`, () => {
    const b = new Builder();
    const n = Math.max(1, Math.round(len / 0.7));
    for (let i = 0; i < n; i++) b.box(1.5, 0.1, 0.25, COLORS.woodDark, [0, 0.05, -len / 2 + (i + 0.5) * (len / n)]);
    b.box(0.1, 0.12, len, 0x8d98a5, [0.5, 0.14, 0]);
    b.box(0.1, 0.12, len, 0x8d98a5, [-0.5, 0.14, 0]);
    return b.build();
  }),

  cart: () => memo('cart', () => new Builder()
    .box(1.2, 0.7, 1.6, 0x6b4a2a, [0, 0.65, 0])
    .box(1.0, 0.1, 1.4, 0x3a2414, [0, 0.98, 0])
    .cyl(0.22, 0.22, 0.15, 8, COLORS.metal, [0.55, 0.25, 0.5], [0, 0, Math.PI / 2])
    .cyl(0.22, 0.22, 0.15, 8, COLORS.metal, [-0.55, 0.25, 0.5], [0, 0, Math.PI / 2])
    .cyl(0.22, 0.22, 0.15, 8, COLORS.metal, [0.55, 0.25, -0.5], [0, 0, Math.PI / 2])
    .cyl(0.22, 0.22, 0.15, 8, COLORS.metal, [-0.55, 0.25, -0.5], [0, 0, Math.PI / 2])
    .build()),

  pony: () => memo('pony', () => new Builder()
    .box(0.7, 0.7, 1.5, 0x8b5a2b, [0, 1.15, 0])
    .box(0.42, 0.7, 0.45, 0x8b5a2b, [0, 1.65, 0.75], [-0.5, 0, 0])
    .box(0.36, 0.34, 0.6, 0x7a4a22, [0, 1.95, 1.05])
    .box(0.12, 0.5, 0.5, 0x3a2414, [0, 1.85, 0.55])
    .box(0.18, 0.8, 0.18, 0x6b4220, [0.22, 0.4, 0.55])
    .box(0.18, 0.8, 0.18, 0x6b4220, [-0.22, 0.4, 0.55])
    .box(0.18, 0.8, 0.18, 0x6b4220, [0.22, 0.4, -0.55])
    .box(0.18, 0.8, 0.18, 0x6b4220, [-0.22, 0.4, -0.55])
    .box(0.12, 0.5, 0.12, 0x3a2414, [0, 1.15, -0.85], [0.6, 0, 0])
    .box(0.06, 0.06, 1.6, COLORS.woodDark, [0.42, 1.0, -0.6])
    .box(0.06, 0.06, 1.6, COLORS.woodDark, [-0.42, 1.0, -0.6])
    .build()),

  monument: () => memo('monument', () => {
    const b = new Builder();
    b.cyl(2.2, 2.6, 0.6, 8, COLORS.stone, [0, 0.3, 0]);
    b.cyl(0.8, 1.1, 4.5, 6, COLORS.stoneDark, [0, 2.8, 0]);
    b.add(new THREE.OctahedronGeometry(1.1, 0), 0x7fe0ff, [0, 6.1, 0], [0, 0, 0], [1, 1.5, 1]);
    b.cyl(2.3, 2.3, 0.15, 8, COLORS.snow, [0, 0.65, 0]);
    return b.build();
  }),

  stoneWallKit: () => memo('wallkit', () => new Builder()
    .box(1.4, 0.8, 1.0, COLORS.stone, [0, 0.4, 0])
    .box(1.0, 0.6, 0.8, COLORS.stoneDark, [0.3, 1.1, 0.1])
    .box(0.8, 0.5, 0.7, COLORS.stone, [-0.4, 1.05, -0.1])
    .build()),

  workerBench: () => memo('bench', () => new Builder()
    .box(1.6, 0.12, 0.6, COLORS.woodLight, [0, 0.5, 0])
    .box(0.12, 0.5, 0.5, COLORS.woodDark, [0.65, 0.25, 0])
    .box(0.12, 0.5, 0.5, COLORS.woodDark, [-0.65, 0.25, 0])
    .build()),

  shadow: () => memo('shadow', () => {
    const g = new THREE.CircleGeometry(0.5, 14);
    g.rotateX(-Math.PI / 2);
    return g;
  }),

  arrow: () => memo('arrow', () => new Builder()
    .cone(0.55, 0.9, 4, COLORS.yellow, [0, 0, 0], [Math.PI, Math.PI / 4, 0])
    .box(0.4, 0.8, 0.4, COLORS.yellow, [0, 0.8, 0], [0, Math.PI / 4, 0])
    .build()),
};

export const ITEM_GEO = {
  log: Geo.log,
  meat: Geo.meat,
  cooked: Geo.cooked,
  ore: Geo.ore,
} as const;

/** Blob shadow — cheaper than real shadow maps on mobile. */
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x23324a, transparent: true, opacity: 0.14, depthWrite: false });
export const makeShadow = (size: number) => {
  const m = new THREE.Mesh(Geo.shadow(), shadowMat);
  m.scale.setScalar(size);
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
};

export interface Character {
  root: THREE.Group;
  body: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  arm: THREE.Group;
  tool?: THREE.Mesh;
  phase: number;
}

/** Build an animatable humanoid. */
export function makeHuman(shirt: number, hat: number, tool: 'axe' | 'spear' | 'pickaxe' | null, scale = 1): Character {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  root.add(inner);
  const body = mesh(Geo.humanBody(shirt, hat));
  inner.add(body);
  const legL = mesh(Geo.humanLeg());
  legL.position.set(0.16, 0.6, 0);
  const legR = mesh(Geo.humanLeg());
  legR.position.set(-0.16, 0.6, 0);
  inner.add(legL, legR);
  const arm = new THREE.Group();
  arm.position.set(0.42, 1.25, 0);
  arm.add(mesh(Geo.humanArm(shirt)));
  let toolMesh: THREE.Mesh | undefined;
  if (tool) {
    toolMesh = mesh(tool === 'axe' ? Geo.axe() : tool === 'spear' ? Geo.spear() : Geo.pickaxe());
    arm.add(toolMesh);
  }
  inner.add(arm);
  root.add(makeShadow(1.3));
  return { root, body, legL, legR, arm, tool: toolMesh, phase: Math.random() * 6 };
}

/** Walk / swing animation shared by player and NPCs. */
export function animateHuman(c: Character, dt: number, speed01: number, swing01: number) {
  c.phase += dt * (6 + speed01 * 8);
  const s = Math.sin(c.phase) * 0.7 * speed01;
  c.legL.rotation.x = s;
  c.legR.rotation.x = -s;
  c.body.position.y = Math.abs(Math.sin(c.phase)) * 0.06 * speed01;
  // swing01: 0..1 progress of an attack swing (0 = idle)
  if (swing01 > 0) {
    const k = swing01 < 0.35 ? -swing01 / 0.35 : -1 + (swing01 - 0.35) / 0.65 * 2.4;
    c.arm.rotation.x = Math.max(-1.6, Math.min(0.9, k * 1.6));
  } else {
    c.arm.rotation.x += (-s * 0.6 - c.arm.rotation.x) * Math.min(1, dt * 10);
  }
}
