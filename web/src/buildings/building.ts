import * as THREE from 'three';
import type { ZoneDef } from '../config/layout';
import { mesh } from '../world/models';
import { Cell } from '../world/nav';
import type { Game } from '../game';

const outlineCache = new Map<string, THREE.CanvasTexture>();

/** Dashed white plot outline painted on the ground under a building. */
function plotOutline(w: number, d: number) {
  const key = `${w.toFixed(1)}x${d.toFixed(1)}`;
  let tex = outlineCache.get(key);
  if (!tex) {
    const ppu = 48;
    const c = document.createElement('canvas');
    c.width = Math.round(w * ppu); c.height = Math.round(d * ppu);
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 7;
    g.setLineDash([26, 18]);
    g.beginPath();
    g.roundRect(6, 6, c.width - 12, c.height - 12, 22);
    g.stroke();
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    outlineCache.set(key, tex);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

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
      this.root.add(plotOutline(w + 1.4, d + 1.4));
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
