import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { Geo, mesh, COLORS, TREE_UNIFORMS } from '../world/models';
import { Cell } from '../world/nav';
import { events } from '../core/events';
import { rand, randInt } from '../core/math';
import type { Game } from '../game';
import type { Enemy, Damageable } from '../entities/enemy';
import type { Labels } from '../ui/labels';
import type { Port } from './storage';

const L = BALANCE.lake;
const O = L.orca;

/** Is (x,z) on the frozen lake (ellipse from balance.json)? `scale` grows/shrinks the ellipse. */
export function onLake(x: number, z: number, scale = 1) {
  const [cx, cz] = L.center, [rx, rz] = L.radius;
  return ((x - cx) / (rx * scale)) ** 2 + ((z - cz) / (rz * scale)) ** 2 < 1;
}

export interface Hole {
  i: number;
  x: number;
  z: number;
  frozen: boolean;
  /** fish left before the hole freezes over */
  catches: number;
  ice: number;
  /** catch progress 0..1 (player or a fisher standing here) */
  progress: number;
  claimedBy: object | null;
  water: THREE.Mesh;
  plug: THREE.Mesh;
  rod: THREE.Mesh;
  fishing: number;
}

interface Water { x: number; z: number; r: number; t: number; mesh: THREE.Mesh }

/**
 * Frozen Lake (region 3): ice fishing holes that freeze over and must be broken, temporary breaks in the
 * ice made by the orca boss, and the orca's attack cycle (follow under the ice -> telegraph -> breach ->
 * surface and become vulnerable -> dive).
 */
export class Lake {
  holes: Hole[] = [];
  private built = false;
  private waters: Water[] = [];
  private iceCd = 0;
  orcaCooldown: number = O.firstDelay;
  private orca: Enemy | null = null;
  private orcaState: 'follow' | 'telegraph' | 'surface' = 'follow';
  private orcaT = 0;
  private offIceT = 0;
  private biteCd = 0;
  private spots: { x: number; z: number; tele: THREE.Mesh }[] = [];
  private waterGeo = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
  private waterMat = new THREE.MeshStandardMaterial({ color: 0x0e2a3a, roughness: 0.15, metalness: 0 });
  private saved: { frozen: boolean; catches: number; ice: number }[] | null = null;

  constructor(private game: Game) {}

  get open() { return this.game.world.isOpen('lake'); }

  /** Create hole meshes the first time the lake is open. */
  private build() {
    this.built = true;
    const sc = this.game.scene;
    sc.add(iceSheet());
    L.holes.forEach(([x, z], i) => {
      const water = new THREE.Mesh(this.waterGeo, this.waterMat);
      water.scale.setScalar(0.85);
      water.position.set(x, 0.05, z);
      water.receiveShadow = true;
      const rim = mesh(Geo.iceRim());
      rim.position.set(x, 0, z);
      rim.rotation.y = i * 1.3;
      const plug = mesh(Geo.icePlug());
      plug.position.set(x, 0, z);
      const rod = mesh(Geo.fishRod());
      rod.position.set(x, 0, z + 1.1);
      rod.rotation.y = Math.PI;
      rod.visible = false;
      sc.add(water, rim, plug, rod);
      const s = this.saved?.[i];
      const h: Hole = { i, x, z, frozen: s?.frozen ?? i % 2 === 1, catches: s?.catches ?? randInt(L.catchesMin, L.catchesMax), ice: s?.ice ?? L.iceHits, progress: 0, claimedBy: null, water, plug, rod, fishing: 0 };
      this.holes.push(h);
      this.refreshHole(h);
    });
  }

  private refreshHole(h: Hole) {
    h.plug.visible = h.frozen;
    h.water.visible = !h.frozen;
  }

  // ------------------------------------------------------------------ API for the player / fishers
  /** Nearest open hole nobody else is fishing at (claimed for `who`). */
  claimHole(who: object, x: number, z: number, frozenToo = false): Hole | null {
    let best: Hole | null = null, bd = Infinity;
    for (const h of this.holes) {
      if (h.claimedBy && h.claimedBy !== who) continue;
      if (h.frozen && !frozenToo) continue;
      const d = Math.hypot(h.x - x, h.z - z) + (h.frozen ? 30 : 0);
      if (d < bd) { bd = d; best = h; }
    }
    for (const h of this.holes) if (h.claimedBy === who && h !== best) h.claimedBy = null;
    if (best) best.claimedBy = who;
    return best;
  }

  release(who: object) { for (const h of this.holes) if (h.claimedBy === who) h.claimedBy = null; }

  /** Fish at a hole for dt seconds. Returns true when a fish was caught. */
  fishAt(h: Hole, dt: number): boolean {
    if (h.frozen) return false;
    h.fishing = 0.2;
    h.progress += (dt * this.game.up.mult('iceAuger')) / L.fishSeconds;
    if (h.progress < 1) return false;
    h.progress = 0;
    this.game.fx.burst(h.x, 0.3, h.z, 0x7fb3d9, 6, 3, 0.12);
    if (--h.catches <= 0) this.freeze(h);
    events.emit('lake:fish', { x: h.x, z: h.z });
    this.game.flows.add('fish', 1, 'ice holes');
    return true;
  }

  /** One axe / pick hit on a frozen hole. Returns true when it breaks open. */
  hitIce(h: Hole): boolean {
    if (!h.frozen) return true;
    h.ice -= 1;
    this.game.fx.burst(h.x, 0.4, h.z, 0xcdeaff, 6, 3.5, 0.14);
    if (h.ice > 0) return false;
    h.frozen = false;
    h.ice = L.iceHits;
    h.catches = randInt(L.catchesMin, L.catchesMax);
    this.refreshHole(h);
    this.game.fx.burst(h.x, 0.3, h.z, 0x2a6fa8, 10, 4, 0.16);
    this.game.fx.ring(h.x, h.z, 0xcdeaff, 1.6, 0.4);
    return true;
  }

  private freeze(h: Hole) {
    h.frozen = true;
    h.progress = 0;
    this.refreshHole(h);
    this.game.fx.ring(h.x, h.z, 0xffffff, 1.4, 0.4);
  }

  /** Where seal thieves raid: the smokehouse fish / smoked fish stores and the fish trader. */
  stealTarget(x: number, z: number): Port | null {
    let best: Port | null = null, bd = Infinity;
    for (const p of this.game.ports) {
      if (p.store.count <= 0 || (p.store.type !== 'fish' && p.store.type !== 'smokedFish')) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd && d < 40) { bd = d; best = p; }
    }
    return best;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (!this.open) return;
    if (!this.built) this.build();
    const g = this.game, p = g.player;
    for (const h of this.holes) { h.fishing = Math.max(0, h.fishing - dt); h.rod.visible = h.fishing > 0; }

    // the hero fishes by standing still next to an open hole, and breaks frozen ones with the axes
    if (p.alive) {
      const near = this.holes.find((h) => Math.hypot(h.x - p.x, h.z - p.z) < L.fishRadius);
      if (near && !near.frozen && !p.moving && !p.stack.full) {
        near.claimedBy = p;
        if (this.fishAt(near, dt)) g.giveItemTo(p.stack, 'fish', new THREE.Vector3(near.x, 0.6, near.z));
      } else for (const h of this.holes) if (h.claimedBy === p) { h.claimedBy = null; h.progress = 0; }
      this.iceCd -= dt;
      const ice = this.holes.find((h) => h.frozen && Math.hypot(h.x - p.x, h.z - p.z) < L.fishRadius + 0.6);
      if (ice && this.iceCd <= 0) {
        this.iceCd = g.up.attackInterval * (p.moving ? 2.5 : 1) * 1.6;
        if (this.hitIce(ice)) g.haptic('medium'); else g.haptic('light');
      }
    }

    // temporary breaks in the ice (orca)
    for (let i = this.waters.length - 1; i >= 0; i--) {
      const w = this.waters[i];
      w.t -= dt;
      w.mesh.scale.setScalar(w.r * Math.min(1, (O.waterSeconds - w.t) * 4, w.t * 2 + 0.2));
      if (w.t <= 0) {
        g.nav.setCircle(w.x, w.z, w.r * 0.8, Cell.Free);
        g.scene.remove(w.mesh);
        this.waters.splice(i, 1);
      }
    }

    // orca boss: rises when the hero walks out on the ice
    this.orcaCooldown -= dt;
    if (!this.orca && this.orcaCooldown <= 0 && p.alive && onLake(p.x, p.z, 0.85)) {
      const e = g.spawnEnemy('orca', p.x, p.z, 1, true);
      this.orca = e;
      this.dive(e);
      this.offIceT = 0;
      events.emit('toast', { text: 'The ice is cracking… a giant orca hunts below! 🐋', color: '#7fd3ff' });
      g.hud.showBanner('⚠ GIANT ORCA ⚠', 'danger');
    }
  }

  private dive(e: Enemy) {
    e.submerged = true;
    e.root.visible = false;
    this.orcaState = 'follow';
    this.orcaT = O.followSeconds;
  }

  /** Called from Enemy.update for the orca. */
  driveOrca(e: Enemy, dt: number) {
    const g = this.game, p = g.player;
    this.orcaT -= dt;
    // gives up when the hero leaves the ice for a while (comes back later at full health)
    this.offIceT = p.alive && onLake(p.x, p.z, 1.05) ? 0 : this.offIceT + dt;
    if (this.offIceT > O.leashSeconds) { this.clearSpots(); this.orca = null; this.orcaCooldown = 20; e.despawn(); return; }
    if (this.orcaState === 'follow') {
      e.x += (p.x - e.x) * Math.min(1, dt * 1.5);
      e.z += (p.z - e.z) * Math.min(1, dt * 1.5);
      e.rise = -2;
      if (this.orcaT <= 0) this.telegraph(e);
    } else if (this.orcaState === 'telegraph') {
      const k = 1 - this.orcaT / O.telegraph;
      for (const s of this.spots) (s.tele.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * Math.abs(Math.sin(k * Math.PI * 5));
      if (this.orcaT <= 0) this.breach(e);
    } else {
      e.rise += (0 - e.rise) * Math.min(1, dt * 8);
      this.biteCd -= dt;
      if (p.alive && Math.hypot(p.x - e.x, p.z - e.z) < e.radius + 1.4 && this.biteCd <= 0) {
        this.biteCd = 1.3;
        p.hit(O.biteDamage);
        g.fx.burst(p.x, 1, p.z, 0x2a6fa8, 8, 3, 0.15);
      }
      if (this.orcaT <= 0) { g.fx.burst(e.x, 0.4, e.z, 0x2a6fa8, 14, 4, 0.2); this.dive(e); }
    }
  }

  private telegraph(e: Enemy) {
    const g = this.game, p = g.player;
    this.orcaState = 'telegraph';
    this.orcaT = O.telegraph;
    const pts = [{ x: p.x, z: p.z }];
    for (let tries = 0; pts.length < O.breaches && tries < 40; tries++) {
      const x = p.x + rand(-5, 5), z = p.z + rand(-5, 5);
      if (onLake(x, z, 0.92) && pts.every((q) => Math.hypot(q.x - x, q.z - z) > O.breachRadius * 1.6)) pts.push({ x, z });
    }
    this.spots = pts.map((q) => ({ ...q, tele: g.telegraphCircle(q.x, q.z, O.breachRadius) }));
    e.x = pts[0].x; e.z = pts[0].z;
    events.emit('enemy:telegraph', pts[0]);
  }

  private breach(e: Enemy) {
    const g = this.game;
    const victims: Damageable[] = [g.player, ...g.workers.filter((w) => w.alive)];
    for (const s of this.spots) {
      for (const v of victims) if (v.alive && Math.hypot(v.x - s.x, v.z - s.z) < O.breachRadius) v.hit(O.damage, s.x, s.z);
      g.fx.burst(s.x, 0.4, s.z, 0xffffff, 16, 6, 0.22);
      g.fx.burst(s.x, 0.4, s.z, 0x2a6fa8, 10, 5, 0.2);
      this.addWater(s.x, s.z, O.breachRadius * 0.9);
    }
    g.shake(0.5);
    const s = this.spots[randInt(0, this.spots.length - 1)];
    this.clearSpots();
    e.x = s.x; e.z = s.z;
    e.rot = rand(0, Math.PI * 2);
    e.submerged = false;
    e.root.visible = true;
    e.rise = -1.6;
    this.orcaState = 'surface';
    this.orcaT = O.surfaceSeconds;
    this.biteCd = 0.6;
  }

  /** Open water nobody can stand in for a few seconds. */
  private addWater(x: number, z: number, r: number) {
    const m = new THREE.Mesh(this.waterGeo, this.waterMat);
    m.position.set(x, 0.06, z);
    m.scale.setScalar(0.01);
    this.game.scene.add(m);
    this.waters.push({ x, z, r, t: O.waterSeconds, mesh: m });
    this.game.nav.setCircle(x, z, r * 0.8, Cell.Solid);
  }

  private clearSpots() {
    for (const s of this.spots) this.game.releaseTelegraph(s.tele);
    this.spots = [];
  }

  onOrcaDied(_e: Enemy) {
    this.clearSpots();
    this.orca = null;
    this.orcaCooldown = O.cooldown;
    this.game.hud.showBanner('The orca is defeated!', 'good');
  }

  /** Progress bars over holes (fishing / ice left). */
  labels(Lb: Labels) {
    if (!this.built) return;
    for (const h of this.holes) {
      if (!h.frozen && h.progress > 0.02) Lb.bar(`hole${h.i}`, new THREE.Vector3(h.x, 1.6, h.z), h.progress, '#7fd3ff', 40);
      else if (h.frozen && h.ice < L.iceHits) Lb.bar(`hole${h.i}`, new THREE.Vector3(h.x, 1.2, h.z), h.ice / L.iceHits, '#e8f6ff', 40);
      else if (h.frozen && Math.hypot(h.x - this.game.player.x, h.z - this.game.player.z) < 7) Lb.text(`holet${h.i}`, new THREE.Vector3(h.x, 1, h.z), '🧊 break the ice');
    }
  }

  serialize() {
    if (!this.built) return { orca: Math.max(0, this.orcaCooldown), holes: this.saved ?? [] };
    return { orca: Math.max(0, this.orcaCooldown), holes: this.holes.map((h) => ({ frozen: h.frozen, catches: h.catches, ice: h.ice })) };
  }

  restore(d: ReturnType<Lake['serialize']> | undefined) {
    if (!d) return;
    this.orcaCooldown = d.orca;
    this.saved = d.holes;
  }
}

/**
 * Glossy ice over the lake: a Phong sheet with a sun highlight and twinkling sparkles
 * (hash of world position + time in the fragment shader — no textures).
 */
function iceSheet() {
  const [cx, cz] = L.center, [rx, rz] = L.radius;
  const geo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(rx * 0.97, 1, rz * 0.97);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7fbfe6, roughness: 0.12, metalness: 0, envMapIntensity: 1.4, transparent: true, opacity: 0.62, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TREE_UNIFORMS.uTime;
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vWPos;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  vec2 cell = floor(vWPos.xz * 2.2);
  float r = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float tw = pow(max(0.0, sin(uTime * 2.3 + r * 60.0)), 28.0) * step(0.9, r);
  gl_FragColor.rgb += tw * 0.9;
  gl_FragColor.a = max(gl_FragColor.a, tw);`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.position.set(cx, 0.03, cz);
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

export const LAKE_COLORS = { ice: 0xbfe3f7, iceShade: 0xa9d6f0, snowEdge: COLORS.snow };
