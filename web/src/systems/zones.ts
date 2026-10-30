import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { ZONES, type ZoneDef, type IconId } from '../config/layout';
import { MAT } from '../world/models';
import { createBuilding, ghostGeo } from '../buildings';
import { events } from '../core/events';
import { easeOutBack, fmt } from '../core/math';
import type { Game } from '../game';
import type { Building } from '../buildings/building';

const ICON: Record<IconId, string> = {
  tower: '🏹', cannon: '💣', fire: '🔥', kitchen: '🍳', diner: '🍽️', axe: '🪓', house: '🏠', expand: '', carrier: '📦',
  hunter: '🎯', cook: '🧑‍🍳', cashier: '💰', miner: '⛏️', guard: '🛡️', backpack: '🎒', rail: '🛤️', smelter: '🏭', cart: '🛒',
  wall: '🧱', monument: '💎',
};

interface ZoneState {
  def: ZoneDef;
  paid: number;
  tile?: THREE.Mesh;
  ghost?: THREE.Mesh;
  canvas?: HTMLCanvasElement;
  tex?: THREE.CanvasTexture;
  appear: number;
  inside: number;
  payT: number;
  drawn: number;
  size: number;
}

/** Purchase zones: stand on a tile, money flies in, the building pops out when paid. */
export class Zones {
  states = new Map<string, ZoneState>();
  built = new Set<string>();
  private building: { b: Building; t: number }[] = [];
  /** zone the player is standing on (for UI) */
  activeZone: ZoneState | null = null;

  constructor(private game: Game) {
    for (const def of ZONES) this.states.set(def.id, { def, paid: 0, appear: 0, inside: 0, payT: 0, drawn: -1, size: def.kind === 'expansion' ? 3.4 : 2.6 });
  }

  isVisible(def: ZoneDef) {
    if (this.built.has(def.id)) return false;
    if (!this.game.world.isOpen(def.region)) return false;
    return (def.requires ?? []).every((r) => this.built.has(r));
  }

  remaining(id: string) {
    const s = this.states.get(id)!;
    return s.def.cost - s.paid;
  }

  /** Show newly unlocked zones, auto-build free/prebuilt ones. Call after anything gets built. */
  refresh() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of this.states.values()) {
        if (!this.isVisible(s.def)) continue;
        if (s.def.prebuilt || s.def.cost <= 0) { this.build(s.def.id, true); changed = true; continue; }
        if (!s.tile) this.createVisual(s);
      }
    }
  }

  private createVisual(s: ZoneState) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    s.canvas = c;
    s.tex = new THREE.CanvasTexture(c);
    s.tex.colorSpace = THREE.SRGBColorSpace;
    s.tex.anisotropy = 4;
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(s.size, s.size), new THREE.MeshBasicMaterial({ map: s.tex, transparent: true, depthWrite: false }));
    tile.rotation.x = -Math.PI / 2;
    tile.rotation.z = Math.PI / 4; // square & upright as seen from the 45° camera
    tile.position.set(s.def.x, 0.07, s.def.z);
    tile.renderOrder = 3;
    tile.scale.setScalar(0.01);
    this.game.scene.add(tile);
    s.tile = tile;
    s.appear = 0;
    const gg = ghostGeo(s.def);
    if (gg) {
      const ghost = new THREE.Mesh(gg, MAT.ghost);
      if (s.def.kind === 'rail') {
        const [ax, az] = s.def.params!.from!, [bx, bz] = s.def.params!.to!;
        ghost.position.set((ax + bx) / 2, 0.02, (az + bz) / 2);
        ghost.rotation.y = Math.atan2(bx - ax, bz - az);
      } else {
        ghost.position.set(s.def.x, 0.02, s.def.z);
        ghost.rotation.y = s.def.rot ?? 0;
      }
      ghost.renderOrder = 4;
      this.game.scene.add(ghost);
      s.ghost = ghost;
    }
    s.drawn = -1;
    this.draw(s);
  }

  private draw(s: ZoneState) {
    const rem = s.def.cost - s.paid;
    if (s.drawn === rem || !s.canvas) return;
    s.drawn = rem;
    const g = s.canvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 256);
    g.save();
    const r = 34;
    const box = (inset: number) => {
      g.beginPath();
      g.roundRect(inset, inset, 256 - inset * 2, 256 - inset * 2, r);
    };
    g.fillStyle = 'rgba(40,52,70,0.62)';
    box(14); g.fill();
    // paid progress
    const k = s.paid / s.def.cost;
    if (k > 0) {
      g.save(); box(14); g.clip();
      g.fillStyle = 'rgba(76,200,90,0.55)';
      g.fillRect(0, 256 - 14 - (256 - 28) * k, 256, 256);
      g.restore();
    }
    g.lineWidth = 9;
    g.setLineDash([22, 14]);
    g.strokeStyle = 'rgba(255,255,255,0.92)';
    box(16); g.stroke();
    g.setLineDash([]);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (s.def.kind === 'expansion') {
      g.strokeStyle = '#fff';
      g.fillStyle = '#fff';
      g.lineWidth = 10;
      for (let i = 0; i < 4; i++) {
        g.save(); g.translate(128, 104); g.rotate((i * Math.PI) / 2);
        g.beginPath(); g.moveTo(0, -8); g.lineTo(0, -48); g.stroke();
        g.beginPath(); g.moveTo(-16, -40); g.lineTo(0, -62); g.lineTo(16, -40); g.closePath(); g.fill();
        g.restore();
      }
    } else {
      g.font = '84px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      g.fillText(ICON[s.def.icon], 128, 100);
    }
    g.font = '900 54px ui-rounded, "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(20,30,45,0.9)';
    const txt = (s.def.currency === 'gold' ? '🟨' : '💵') + ' ' + fmt(rem);
    g.strokeText(txt, 128, 190);
    g.fillStyle = s.def.currency === 'gold' ? '#ffd23f' : '#ffffff';
    g.fillText(txt, 128, 190);
    g.restore();
    s.tex!.needsUpdate = true;
  }

  build(id: string, instant = false) {
    const s = this.states.get(id)!;
    if (this.built.has(id)) return;
    this.built.add(id);
    s.paid = s.def.cost;
    if (s.tile) { this.game.scene.remove(s.tile); s.tile.geometry.dispose(); (s.tile.material as THREE.Material).dispose(); s.tex?.dispose(); s.tile = undefined; }
    if (s.ghost) { this.game.scene.remove(s.ghost); s.ghost = undefined; }
    const b = createBuilding(this.game, s.def);
    this.game.buildings.set(id, b);
    if (!instant) {
      b.root.scale.setScalar(0.01);
      this.building.push({ b, t: 0 });
      this.game.fx.ring(s.def.x, s.def.z, 0xffe27a, 4, 0.6);
      this.game.fx.burst(s.def.x, 1, s.def.z, 0xffffff, 18, 6, 0.2);
      this.game.fx.burst(s.def.x, 1, s.def.z, 0xffd23f, 10, 5, 0.16);
      this.game.haptic('success');
      events.emit('zone:built', { id, kind: s.def.kind, x: s.def.x, z: s.def.z });
    }
    this.refresh();
    this.game.onBuilt(id);
  }

  update(dt: number, time: number) {
    const g = this.game;
    const p = g.player;
    this.activeZone = null;
    for (const s of this.states.values()) {
      if (!s.tile) continue;
      if (s.appear < 1) { s.appear = Math.min(1, s.appear + dt * 2.5); s.tile.scale.setScalar(Math.max(0.01, easeOutBack(s.appear))); }
      if (s.ghost) (s.ghost.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(time * 3) * 0.08;
      const half = s.size / 2 + 0.15;
      // tile is a diamond: rotate player offset by 45° to test against the square
      const dx = p.x - s.def.x, dz = p.z - s.def.z;
      const c = Math.SQRT1_2;
      const lx = dx * c - dz * c, lz = dx * c + dz * c;
      const inside = p.alive && Math.abs(lx) < half && Math.abs(lz) < half;
      if (!inside) { s.inside = 0; continue; }
      this.activeZone = s;
      s.inside += dt;
      if (s.inside < 0.3) continue;
      s.payT -= dt;
      if (s.payT > 0) continue;
      s.payT = BALANCE.economy.zonePayTick;
      const cur = s.def.currency;
      const have = g.eco.get(cur);
      if (have <= 0) continue;
      const rem = s.def.cost - s.paid;
      const accel = Math.pow(BALANCE.economy.zonePayAccel, s.inside - 0.3);
      const per = Math.min(rem, have, Math.max(1, Math.ceil(Math.max(BALANCE.economy.zonePayRateStart * accel, s.def.cost / 45))));
      g.eco.add(cur, -per);
      s.paid += per;
      g.fx.fly(cur === 'money' ? g.cashGeo : g.goldGeo, new THREE.Vector3(p.x, 1.8, p.z), new THREE.Vector3(s.def.x, 0.2, s.def.z), { dur: 0.28, arc: 1.2 });
      events.emit('zone:pay', { id: s.def.id, remaining: s.def.cost - s.paid });
      g.haptic('light');
      this.draw(s);
      if (s.paid >= s.def.cost) this.build(s.def.id);
    }
    for (let i = this.building.length - 1; i >= 0; i--) {
      const b = this.building[i];
      b.t += dt * 2.2;
      b.b.root.scale.setScalar(Math.max(0.01, easeOutBack(Math.min(1, b.t))));
      if (b.t >= 1) { b.b.root.scale.setScalar(1); this.building.splice(i, 1); }
    }
  }

  /** Visible (unbuilt) zones — for tutorial/arrows. */
  visible() { return [...this.states.values()].filter((s) => s.tile).map((s) => s.def); }

  serialize() {
    const paid: Record<string, number> = {};
    for (const s of this.states.values()) if (s.paid > 0 && !this.built.has(s.def.id)) paid[s.def.id] = s.paid;
    return { built: [...this.built], paid };
  }
  restorePaid(paid: Record<string, number>) {
    for (const [id, v] of Object.entries(paid)) { const s = this.states.get(id); if (s) { s.paid = Math.min(v, s.def.cost - 1); this.draw(s); } }
  }
}
