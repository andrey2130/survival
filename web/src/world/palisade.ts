import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { Geo, mesh } from './models';
import { Cell, NavGrid } from './nav';
import { events } from '../core/events';

export interface Segment {
  i: number;
  ax: number; az: number; bx: number; bz: number;
  cx: number; cz: number;
  len: number;
  angle: number;
  gate: boolean;
  hp: number;
  maxHp: number;
  group: THREE.Group;
  intact: THREE.Mesh;
  broken: THREE.Mesh;
  door?: THREE.Object3D;
  doorOpen: number;
  shake: number;
  cells: number[];
  /** lowered section (the wood stall window) */
  low?: boolean;
}

/** Sharpened-log wall around the camp, with gates. Segments have HP and can be repaired with logs. */
export class Palisade {
  segments: Segment[] = [];
  stone = false;
  hpMult = 1;

  /** current half-size of the square wall */
  half: number;
  private root = new THREE.Group();

  constructor(private scene: THREE.Scene, private nav: NavGrid, H: number) {
    this.half = H;
    scene.add(this.root);
    this.build(H);
  }

  /** Replace the wall with a bigger one (camp expansion). Damage is forgiven. */
  rebuild(H: number) {
    for (const seg of this.segments) for (const i of seg.cells) { if (this.nav.seg[i] === seg.i) { this.nav.cells[i] = Cell.Free; this.nav.seg[i] = -1; } }
    this.scene.remove(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.segments = [];
    this.half = H;
    this.build(H);
    if (this.stone) {
      for (const sg of this.segments) {
        sg.group.remove(sg.intact);
        sg.intact = mesh(sg.gate ? Geo.gate(sg.len, true) : Geo.palisadeLogs(sg.len, true));
        sg.group.add(sg.intact);
      }
    }
    this.setHpMult(this.hpMult);
    for (const sg of this.segments) sg.hp = sg.maxHp;
  }

  private build(H: number) {
    const gw = BALANCE.palisade.gateWidth / 2;
    const cuts = [-H, (-H - gw) / 2, -gw, gw, (H + gw) / 2, H];
    const sides: [number, number, number, number][] = [
      [1, 0, 0, -H], // north: varies along x, z=-H
      [1, 0, 0, H], // south
      [0, 1, -H, 0], // west: varies along z, x=-H
      [0, 1, H, 0], // east
    ];
    for (const [ux, uz, ox, oz] of sides) {
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k], b = cuts[k + 1];
        this.addSegment(ox + ux * a, oz + uz * a, ox + ux * b, oz + uz * b, k === 2);
      }
    }
    // corner posts
    for (const [x, z] of [[-H, -H], [H, -H], [-H, H], [H, H]]) {
      const post = mesh(Geo.gate(0.01));
      post.position.set(x, 0, z);
      post.scale.set(1, 0.85, 1);
      this.root.add(post);
    }
  }

  private addSegment(ax: number, az: number, bx: number, bz: number, gate: boolean) {
    const len = Math.hypot(bx - ax, bz - az);
    const angle = Math.atan2(bz - az, bx - ax);
    const group = new THREE.Group();
    group.position.set((ax + bx) / 2, 0, (az + bz) / 2);
    group.rotation.y = -angle;
    const intact = mesh(gate ? Geo.gate(len) : Geo.palisadeLogs(len));
    const broken = mesh(Geo.palisadeBroken(len));
    broken.visible = false;
    group.add(intact, broken);
    let door: THREE.Object3D | undefined;
    if (gate) {
      door = new THREE.Group();
      const leaf = mesh(Geo.gateDoor(len - 0.4));
      door.add(leaf);
      door.position.set(-len / 2 + 0.2, 0, 0);
      group.add(door);
    }
    this.root.add(group);
    const seg: Segment = {
      i: this.segments.length, ax, az, bx, bz, cx: (ax + bx) / 2, cz: (az + bz) / 2, len, angle, gate,
      hp: BALANCE.palisade.segmentHp, maxHp: BALANCE.palisade.segmentHp, group, intact, broken, door, doorOpen: 0, shake: 0, cells: [],
    };
    // rasterize into the nav grid
    const steps = Math.ceil(len / 0.25);
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      for (const off of [-0.35, 0.35]) {
        const i = this.nav.idx(ax + (bx - ax) * t + nx * off, az + (bz - az) * t + nz * off);
        if (i >= 0 && !seg.cells.includes(i)) seg.cells.push(i);
      }
    }
    this.segments.push(seg);
    this.applyCells(seg);
  }

  private applyCells(seg: Segment) {
    for (const i of seg.cells) {
      if (seg.hp <= 0) { this.nav.cells[i] = Cell.Free; this.nav.seg[i] = -1; }
      else { this.nav.cells[i] = seg.gate ? Cell.Gate : Cell.Wall; this.nav.seg[i] = seg.i; }
    }
  }

  segmentAtCell(x: number, z: number): Segment | null {
    const i = this.nav.idx(x, z);
    if (i < 0) return null;
    const s = this.nav.seg[i];
    return s >= 0 ? this.segments[s] : null;
  }

  damage(seg: Segment, dmg: number) {
    if (seg.hp <= 0) return;
    seg.hp = Math.max(0, seg.hp - dmg);
    seg.shake = 0.3;
    events.emit('palisade:hit', { x: seg.cx, z: seg.cz });
    if (seg.hp <= 0) {
      seg.intact.visible = false;
      if (seg.door) seg.door.visible = false;
      seg.broken.visible = true;
      this.applyCells(seg);
      events.emit('palisade:broken', { x: seg.cx, z: seg.cz });
    }
  }

  repair(seg: Segment, amount: number) {
    const wasBroken = seg.hp <= 0;
    seg.hp = Math.min(seg.maxHp, seg.hp + amount);
    seg.shake = 0.15;
    if (wasBroken && seg.hp > 0) {
      seg.intact.visible = true;
      if (seg.door) seg.door.visible = true;
      seg.broken.visible = false;
      this.applyCells(seg);
    }
    if (seg.hp >= seg.maxHp) events.emit('palisade:repaired', { x: seg.cx, z: seg.cz });
  }

  repairAll() {
    for (const s of this.segments) this.repair(s, s.maxHp);
  }

  setHpMult(mult: number) {
    this.hpMult = mult;
    const base = this.stone ? BALANCE.palisade.stoneHp : BALANCE.palisade.segmentHp;
    for (const s of this.segments) {
      const ratio = s.hp / s.maxHp;
      s.maxHp = Math.round(base * mult);
      s.hp = Math.round(s.maxHp * ratio);
    }
  }

  /** Fortress stage: swap logs for stone. */
  makeStone() {
    if (this.stone) return;
    this.stone = true;
    for (const s of this.segments) {
      s.group.remove(s.intact);
      s.intact = mesh(s.gate ? Geo.gate(s.len, true) : Geo.palisadeLogs(s.len, true));
      if (s.low) s.intact.scale.y = 0.42;
      s.group.add(s.intact);
      s.hp = 1;
    }
    this.setHpMult(this.hpMult);
    for (const s of this.segments) { s.hp = s.maxHp; s.intact.visible = true; s.broken.visible = false; if (s.door) s.door.visible = true; this.applyCells(s); }
  }

  /** Lower the wall section nearest to (x,z) so the stall behind it is visible. Still blocks enemies. */
  setLow(x: number, z: number) {
    let best: Segment | null = null, bd = Infinity;
    for (const s of this.segments) { if (s.gate) continue; const d = this.distToSegment(s, x, z); if (d < bd) { bd = d; best = s; } }
    if (!best) return;
    best.low = true;
    best.intact.scale.y = 0.42;
  }

  nearestDamaged(x: number, z: number, r: number): Segment | null {
    let best: Segment | null = null;
    let bd = r;
    for (const s of this.segments) {
      if (s.hp >= s.maxHp) continue;
      const d = this.distToSegment(s, x, z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  distToSegment(s: Segment, x: number, z: number) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
  }

  /** Closest point on a segment (enemies walk to it). */
  closestPoint(s: Segment, x: number, z: number) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = Math.max(0.1, Math.min(0.9, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
    return { x: s.ax + dx * t, z: s.az + dz * t };
  }

  get damagedCount() { return this.segments.filter((s) => s.hp < s.maxHp).length; }

  inside(x: number, z: number) {
    const H = this.half;
    return Math.abs(x) < H && Math.abs(z) < H;
  }

  update(dt: number, friendlies: { x: number; z: number }[]) {
    for (const s of this.segments) {
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt);
        s.intact.position.x = Math.sin(s.shake * 60) * s.shake * 0.3;
      }
      if (s.door) {
        let near = false;
        for (const f of friendlies) if ((f.x - s.cx) ** 2 + (f.z - s.cz) ** 2 < 9) { near = true; break; }
        s.doorOpen += ((near ? 1 : 0) - s.doorOpen) * Math.min(1, dt * 8);
        s.door.rotation.y = s.doorOpen * 1.6;
      }
    }
  }

  serialize() { return { stone: this.stone, hp: this.segments.map((s) => Math.round(s.hp)) }; }

  restore(d: { stone: boolean; hp: number[] }) {
    if (d.stone) this.makeStone();
    d.hp.forEach((hp, i) => {
      const s = this.segments[i];
      if (!s) return;
      s.hp = Math.min(s.maxHp, Math.max(0, hp));
      s.intact.visible = s.hp > 0;
      s.broken.visible = s.hp <= 0;
      if (s.door) s.door.visible = s.hp > 0;
      this.applyCells(s);
    });
  }
}
