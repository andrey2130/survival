import * as THREE from 'three';
import type { ZoneDef } from '../config/layout';
import { mesh } from '../world/models';
import { Cell } from '../world/nav';
import type { Game } from '../game';

/** Base class for every placed building. Data comes from a ZoneDef. */
export class Building {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  appear = 0; // build pop animation 0..1

  constructor(readonly game: Game, readonly def: ZoneDef, geo: THREE.BufferGeometry | null, footprint?: [number, number]) {
    this.root.position.set(def.x, 0, def.z);
    this.root.rotation.y = def.rot ?? 0;
    this.model = geo ? mesh(geo) : new THREE.Group();
    this.root.add(this.model);
    game.scene.add(this.root);
    if (footprint) {
      const [w, d] = footprint;
      game.nav.setRect(def.x - w / 2, def.z - d / 2, def.x + w / 2, def.z + d / 2, Cell.Solid);
    }
  }

  /** world position relative to the building origin */
  at(x: number, z: number, y = 0) { return new THREE.Vector3(this.def.x + x, y, this.def.z + z); }

  update(_dt: number) {}

  /** extra state to persist (stock counts etc.) */
  serialize(): Record<string, number> | null { return null; }
  restore(_d: Record<string, number>) {}

  /** Short status shown in the world label above the building (or null). */
  status(): string | null { return null; }
  statusAnchor(): THREE.Vector3 { return this.at(0, 0, 3.6); }
}
