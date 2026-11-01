import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { ZONES, regionById, type ZoneDef } from '../config/layout';
import { BIOMES, res, type BiomeDef } from '../config/content';
import { OffscreenIndicator, type IndicatorTarget } from '../ui/offscreen';
import { fmt } from '../core/math';
import type { Game } from '../game';

const NAV = BALANCE.navigation;
const NONE: IndicatorTarget[] = [];
/** Centre of the base (the furnace). */
export const BASE = { x: 0, z: -1 };

export interface Goal {
  /** region that will be unlocked */
  region: string;
  biome: BiomeDef;
  /** zone to walk to right now (the unlock zone or a missing prerequisite), null if none is reachable yet */
  zone: ZoneDef | null;
  /** human readable condition */
  text: string;
}

/**
 * Wayfinding: off-screen arrows (base, attack, quest/next region), the dotted trail home and the
 * "what do I unlock next" logic shared with the world map.
 */
export class Wayfinding {
  readonly indicator: OffscreenIndicator;
  private trail: THREE.InstancedMesh;
  private trailMat: THREE.MeshBasicMaterial;
  private trailPts: { x: number; z: number }[] = [];
  private trailT = 0;
  private trailFrom = { x: 1e9, z: 1e9 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private goalCache: Goal | null = null;
  private goalT = 0;

  constructor(private game: Game, uiRoot: HTMLElement) {
    this.indicator = new OffscreenIndicator(uiRoot, game.camera, ['.panel.tl', '.resources', '.btn-col', '.tut-caption', '.dbg-open'], NAV.maxArrows);
    const geo = new THREE.PlaneGeometry(0.55, 0.16);
    geo.rotateX(-Math.PI / 2);
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, depthWrite: false });
    this.trail = new THREE.InstancedMesh(geo, this.trailMat, NAV.trailMaxDashes);
    this.trail.count = 0;
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 2;
    game.scene.add(this.trail);
  }

  // ------------------------------------------------------------------ next region / quest goal
  /** First story region (biome) that is shipped but still closed, and how to reach it. */
  nextGoal(): Goal | null {
    const g = this.game;
    for (const b of BIOMES) {
      if (!b.available || !b.unlockZone) continue;
      const z = ZONES.find((q) => q.id === b.unlockZone);
      if (!z || g.zones.built.has(z.id)) continue;
      const region = regionById(z.params?.opens ?? '')?.name ?? b.name;
      // walk the requirement chain down to something buildable now
      const missing = this.firstMissing(z, new Set());
      if (!missing) return { region, biome: b, zone: null, text: `${region}: requirements not met` };
      const cost = `${missing.currency === 'money' ? '$' : ''}${fmt(g.zones.remaining(missing.id))}${missing.currency === 'money' ? '' : ` ${res(missing.currency).icon}`}`;
      const text = missing === z
        ? `Open ${region}: buy "${z.label}" at ${regionById(z.region)?.name ?? z.region} for ${cost}`
        : `${region} needs "${missing.label}" first (${regionById(missing.region)?.name ?? missing.region}, ${cost})`;
      return { region, biome: b, zone: g.zones.isVisible(missing) ? missing : null, text };
    }
    return null;
  }

  /** The zone itself if it can be bought now, else the first visible unbuilt prerequisite (depth first). */
  private firstMissing(z: ZoneDef, seen: Set<string>): ZoneDef | null {
    const g = this.game;
    if (seen.has(z.id)) return null;
    seen.add(z.id);
    if (g.zones.isVisible(z)) return z;
    for (const r of z.requires ?? []) {
      if (g.zones.built.has(r)) continue;
      const rz = ZONES.find((q) => q.id === r);
      const m = rz && this.firstMissing(rz, seen);
      if (m) return m;
    }
    // region not open yet: the expansion that opens it
    if (!g.world.isOpen(z.region)) {
      const opener = ZONES.find((q) => q.params?.opens === z.region);
      if (opener && !g.zones.built.has(opener.id)) return this.firstMissing(opener, seen);
    }
    return null;
  }

  get goal() { return this.goalCache; }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const g = this.game;
    this.goalT -= dt;
    if (this.goalT <= 0) { this.goalT = 0.5; this.goalCache = this.nextGoal(); }
    const p = g.player;
    // the target list is rebuilt 10x per second (arrows themselves still move every frame)
    this.targetsT -= dt;
    if (this.targetsT <= 0) { this.targetsT = 0.1; this.targets = this.collectTargets(); }
    // menus cover the screen: no arrows on top of them
    this.indicator.update(dt, g.hud.modalOpen ? NONE : this.targets, p, g.input.joyRect());
    this.updateTrail(dt);
  }

  private targetsT = 0;
  private targets: IndicatorTarget[] = [];

  private collectTargets(): IndicatorTarget[] {
    const g = this.game;
    const targets: IndicatorTarget[] = [];
    const peek = (x: number, z: number) => () => g.peekAt(x, z);

    // 1) attacks on the base (wave warning / wave enemies / bosses)
    const w = g.waves;
    if (w.state === 'warning') targets.push({ id: 'atk-warn', kind: 'attack', x: w.spawnPoint.x, z: w.spawnPoint.z, icon: '⚠️', onTap: peek(w.spawnPoint.x, w.spawnPoint.z) });
    const groups: { x: number; z: number; boss: boolean }[] = [];
    for (const e of g.enemies) {
      if (!e.alive || e.submerged) continue;
      const boss = e.kind === 'alpha' || e.kind === 'orca';
      if (e.wild && !boss) continue;
      const near = groups.find((q) => Math.hypot(q.x - e.x, q.z - e.z) < 12);
      if (near && !boss) continue;
      groups.push({ x: e.x, z: e.z, boss });
    }
    groups.sort((a, b) => Number(b.boss) - Number(a.boss));
    groups.slice(0, 2).forEach((q, i) => targets.push({ id: `atk${i}`, kind: 'attack', x: q.x, z: q.z, icon: q.boss ? '💀' : '⚔️', onTap: peek(q.x, q.z) }));

    // 2) the base
    targets.push({ id: 'base', kind: 'base', x: BASE.x, z: BASE.z, y: 2, icon: '🏠', onTap: peek(BASE.x, BASE.z) });

    // 3) tutorial step or the next region
    const tt = g.tutorial.target;
    if (tt) targets.push({ id: 'quest', kind: 'quest', x: tt.x, z: tt.z, y: tt.y, icon: '❗', onTap: peek(tt.x, tt.z) });
    else if (this.goalCache?.zone) {
      const z = this.goalCache.zone;
      targets.push({ id: 'goal', kind: 'region', x: z.x, z: z.z, icon: '🗺️', minDist: 6, onTap: peek(z.x, z.z) });
    }

    return targets;
  }

  /** Dotted trail on the snow back to the base, only when far away. */
  private updateTrail(dt: number) {
    const g = this.game, p = g.player;
    const far = Math.hypot(p.x - BASE.x, p.z - BASE.z) > NAV.trailMinDistance && p.alive;
    this.trailMat.opacity += ((far ? 0.75 : 0) - this.trailMat.opacity) * Math.min(1, dt * 3);
    this.trail.visible = this.trailMat.opacity > 0.02;
    if (!far) return;
    this.trailT -= dt;
    if (this.trailT > 0 && Math.hypot(p.x - this.trailFrom.x, p.z - this.trailFrom.z) < 2) return;
    this.trailT = 1.5;
    this.trailFrom = { x: p.x, z: p.z };
    const goal = BALANCE.player.respawn;
    this.trailPts = [{ x: p.x, z: p.z }, ...(g.nav.findPath(p.x, p.z, goal.x, goal.z, true) ?? [{ x: goal.x, z: goal.z }])];
    let n = 0, carry = 1.2;
    for (let i = 0; i + 1 < this.trailPts.length && n < NAV.trailMaxDashes; i++) {
      const a = this.trailPts[i], b = this.trailPts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-3) continue;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-(b.z - a.z), b.x - a.x));
      let d = carry;
      for (; d < len && n < NAV.trailMaxDashes; d += NAV.trailSpacing) {
        const k = d / len;
        this.m.compose(this.pos.set(a.x + (b.x - a.x) * k, 0.06, a.z + (b.z - a.z) * k), this.q, this.one);
        this.trail.setMatrixAt(n++, this.m);
      }
      carry = d - len;
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
  }
}
