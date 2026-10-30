import * as THREE from 'three';

interface Persistent { el: HTMLDivElement; used: boolean; fill?: HTMLElement; last?: string }
interface Floating { el: HTMLDivElement; pos: THREE.Vector3; t: number; dur: number; rise: number }

/**
 * World-anchored DOM labels: HP bars, building indicators, floating "+$5" / damage numbers.
 * Immediate mode: call begin(), then bar()/text() for everything visible this frame, then end().
 */
export class Labels {
  private root: HTMLDivElement;
  private items = new Map<string, Persistent>();
  private floats: Floating[] = [];
  private floatPool: HTMLDivElement[] = [];
  private v = new THREE.Vector3();
  private w = 1;
  private h = 1;

  constructor(parent: HTMLElement, private camera: THREE.Camera) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    parent.appendChild(this.root);
  }

  resize(w: number, h: number) { this.w = w; this.h = h; }

  /** Project to screen. Returns null when behind the camera. */
  project(p: THREE.Vector3): { x: number; y: number; on: boolean } | null {
    this.v.copy(p).project(this.camera);
    if (this.v.z > 1) return null;
    const x = (this.v.x * 0.5 + 0.5) * this.w, y = (-this.v.y * 0.5 + 0.5) * this.h;
    return { x, y, on: x > -40 && x < this.w + 40 && y > -40 && y < this.h + 40 };
  }

  begin() { for (const it of this.items.values()) it.used = false; }

  end() {
    for (const it of this.items.values()) {
      if (!it.used && it.el.style.display !== 'none') it.el.style.display = 'none';
    }
  }

  private get(key: string, cls: string, withFill: boolean): Persistent {
    let it = this.items.get(key);
    if (!it) {
      const el = document.createElement('div');
      el.className = cls;
      let fill: HTMLElement | undefined;
      if (withFill) { fill = document.createElement('i'); el.appendChild(fill); }
      this.root.appendChild(el);
      it = { el, used: false, fill };
      this.items.set(key, it);
    }
    return it;
  }

  private place(it: Persistent, p: THREE.Vector3): boolean {
    const s = this.project(p);
    if (!s || !s.on) { it.used = false; return false; }
    it.used = true;
    it.el.style.display = '';
    it.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    return true;
  }

  bar(key: string, p: THREE.Vector3, v01: number, color: string, width = 46) {
    const it = this.get(key, 'wl-bar', true);
    if (!this.place(it, p)) return;
    const w = `${width}px`;
    if (it.el.style.width !== w) it.el.style.width = w;
    const pct = `${Math.max(0, Math.min(1, v01)) * 100}%`;
    if (it.fill!.style.width !== pct) it.fill!.style.width = pct;
    if (it.fill!.style.background !== color) it.fill!.style.background = color;
  }

  text(key: string, p: THREE.Vector3, text: string, cls = 'wl-tag') {
    const it = this.get(key, cls, false);
    if (!this.place(it, p)) return;
    if (it.last !== text) { it.el.textContent = text; it.last = text; }
  }

  float(x: number, y: number, z: number, text: string, color = '#fff', dur = 0.9) {
    const el = this.floatPool.pop() ?? document.createElement('div');
    el.className = 'wl-float';
    el.textContent = text;
    el.style.color = color;
    el.style.opacity = '1';
    this.root.appendChild(el);
    this.floats.push({ el, pos: new THREE.Vector3(x, y, z), t: 0, dur, rise: 1.4 });
  }

  damage(x: number, y: number, z: number, n: number) {
    this.float(x + (Math.random() - 0.5) * 0.6, y, z, String(n), '#ffe066', 0.7);
  }

  update(dt: number) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { f.el.remove(); this.floatPool.push(f.el); this.floats.splice(i, 1); continue; }
      this.v.copy(f.pos);
      this.v.y += k * f.rise;
      const s = this.project(this.v);
      if (!s) continue;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.7 : 1.3 - Math.min(0.3, (k - 0.15) * 0.6);
      f.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      f.el.style.opacity = k > 0.6 ? String(1 - (k - 0.6) / 0.4) : '1';
    }
  }
}
