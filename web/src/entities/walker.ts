import * as THREE from 'three';
import { makeHuman, animateHuman, type Character } from '../world/models';
import { angleLerp } from '../core/math';
import type { Game } from '../game';

/** Base for NPCs walking on the nav grid (survivors, workers). */
export class Walker {
  readonly char: Character;
  x: number;
  z: number;
  facing = 0;
  speed = 2.5;
  protected path: { x: number; z: number }[] = [];
  protected dest: { x: number; z: number } | null = null;
  protected moving = false;
  protected swing = 0;
  private repath = 0;
  private stuckT = 0;
  readonly anchor = new THREE.Vector3();

  constructor(protected game: Game, x: number, z: number, shirt: number, hat: number, tool: 'axe' | 'spear' | 'pickaxe' | null, scale = 1) {
    this.char = makeHuman(shirt, hat, tool, scale);
    this.x = x;
    this.z = z;
    this.char.root.position.set(x, 0, z);
    game.scene.add(this.char.root);
  }

  goTo(x: number, z: number) {
    if (this.dest && Math.abs(this.dest.x - x) < 0.2 && Math.abs(this.dest.z - z) < 0.2 && this.path.length) return;
    this.dest = { x, z };
    this.path = this.game.nav.findPath(this.x, this.z, x, z, true) ?? [{ x, z }];
    this.repath = 3;
  }

  stop() { this.path = []; this.dest = null; }

  get arrived() { return this.path.length === 0; }

  distTo(x: number, z: number) { return Math.hypot(this.x - x, this.z - z); }

  /** Step along the path; returns true while still walking. */
  protected walk(dt: number): boolean {
    this.moving = false;
    if (!this.path.length) return false;
    const p = this.path[0];
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    const step = this.speed * dt;
    if (d <= step) {
      this.x = p.x; this.z = p.z;
      this.path.shift();
    } else {
      const nx = this.x + (dx / d) * step, nz = this.z + (dz / d) * step;
      if (this.game.nav.walkable(nx, nz, true) || !this.game.nav.walkable(this.x, this.z, true)) { this.x = nx; this.z = nz; this.stuckT = 0; }
      else {
        this.stuckT += dt;
        if (this.stuckT > 0.6 && this.dest) { this.stuckT = 0; const t = this.dest; this.dest = null; this.goTo(t.x, t.z); }
      }
      this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
      this.moving = true;
    }
    // walls can change (gates broken/repaired) — refresh long paths occasionally
    this.repath -= dt;
    if (this.repath <= 0 && this.dest && this.path.length > 2) { const t = this.dest; this.dest = null; this.goTo(t.x, t.z); }
    return this.path.length > 0;
  }

  face(x: number, z: number, dt: number) {
    this.facing = angleLerp(this.facing, Math.atan2(x - this.x, z - this.z), Math.min(1, dt * 10));
  }

  protected sync(dt: number) {
    this.char.root.position.set(this.x, 0, this.z);
    this.char.root.rotation.y = this.facing;
    animateHuman(this.char, dt, this.moving ? Math.min(1, this.speed / 4) : 0, this.swing);
    this.anchor.set(this.x, 2.5, this.z);
  }

  dispose() { this.char.root.removeFromParent(); }
}
