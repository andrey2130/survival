import * as THREE from 'three';

/**
 * Edge-of-screen arrows for off-screen targets (base, quest goal, attacking enemies, stations...).
 * Generic: callers pass a list of targets every frame; this component decides which ones to show,
 * slides them along the screen border so they point at the target, keeps them off the HUD and the
 * joystick, and stops them from overlapping each other.
 */
export type IndicatorKind = 'attack' | 'base' | 'quest' | 'region' | 'station';

export interface IndicatorTarget {
  /** stable id (one DOM element per id) */
  id: string;
  kind: IndicatorKind;
  x: number;
  z: number;
  /** world height used for the on-screen test (default 1) */
  y?: number;
  icon: string;
  /** hidden while closer than this (metres) */
  minDist?: number;
  onTap?: () => void;
}

const STYLE: Record<IndicatorKind, { color: string; priority: number; pulse?: boolean }> = {
  attack: { color: '#ff4a3d', priority: 0, pulse: true },
  base: { color: '#ffd23f', priority: 1 },
  quest: { color: '#7fe07a', priority: 2 },
  region: { color: '#7fd3ff', priority: 3 },
  station: { color: '#c9b3ff', priority: 3 },
};

interface Item { el: HTMLDivElement; arrow: HTMLDivElement; dist: HTMLSpanElement; icon: HTMLSpanElement; alpha: number; want: number; target?: IndicatorTarget }
type Rect = { x0: number; y0: number; x1: number; y1: number };

const SIZE = 52; // indicator footprint (px), used for spacing
const PAD = 10;

export class OffscreenIndicator {
  private root: HTMLDivElement;
  private items = new Map<string, Item>();
  private v = new THREE.Vector3();
  private safe = { t: 0, r: 0, b: 0, l: 0 };
  private probe: HTMLDivElement;
  private avoid: Rect[] = [];
  private avoidT = 0;

  constructor(parent: HTMLElement, private camera: THREE.Camera, private avoidSelectors: string[], readonly max = 4) {
    this.root = document.createElement('div');
    this.root.className = 'osi-layer';
    parent.appendChild(this.root);
    // read env(safe-area-inset-*) through a probe element
    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    parent.appendChild(this.probe);
    this.readSafe();
    window.addEventListener('resize', () => this.readSafe());
  }

  private readSafe() {
    const cs = getComputedStyle(this.probe);
    this.safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  private item(t: IndicatorTarget): Item {
    let it = this.items.get(t.id);
    if (!it) {
      const el = document.createElement('div');
      el.className = 'osi';
      const arrow = document.createElement('div');
      arrow.className = 'osi-arrow';
      const icon = document.createElement('span');
      icon.className = 'osi-icon';
      const dist = document.createElement('span');
      dist.className = 'osi-dist';
      el.append(arrow, icon, dist);
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.items.get(t.id)?.target?.onTap?.(); });
      this.root.appendChild(el);
      it = { el, arrow, dist, icon, alpha: 0, want: 0 };
      this.items.set(t.id, it);
    }
    return it;
  }

  /** HUD panels / buttons the arrows must not cover (refreshed a few times a second). */
  private refreshAvoid(extra: Rect[]) {
    this.avoid = [];
    for (const sel of this.avoidSelectors) {
      document.querySelectorAll(sel).forEach((n) => {
        const r = (n as HTMLElement).getBoundingClientRect();
        if (r.width && r.height) this.avoid.push({ x0: r.left - PAD, y0: r.top - PAD, x1: r.right + PAD, y1: r.bottom + PAD });
      });
    }
    this.avoid.push(...extra);
  }

  // ---- rectangle perimeter helpers (t = distance along the border, clockwise from top-left)
  private toPerim(r: Rect, x: number, y: number) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const d = [Math.abs(y - r.y0), Math.abs(x - r.x1), Math.abs(y - r.y1), Math.abs(x - r.x0)];
    const e = d.indexOf(Math.min(...d));
    if (e === 0) return x - r.x0;
    if (e === 1) return w + (y - r.y0);
    if (e === 2) return w + h + (r.x1 - x);
    return 2 * w + h + (r.y1 - y);
  }
  private fromPerim(r: Rect, t: number) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0, P = 2 * (w + h);
    t = ((t % P) + P) % P;
    if (t < w) return { x: r.x0 + t, y: r.y0 };
    if (t < w + h) return { x: r.x1, y: r.y0 + (t - w) };
    if (t < 2 * w + h) return { x: r.x1 - (t - w - h), y: r.y1 };
    return { x: r.x0, y: r.y1 - (t - 2 * w - h) };
  }

  private blocked(x: number, y: number, placed: { x: number; y: number }[]) {
    const h = SIZE / 2;
    for (const a of this.avoid) if (x + h > a.x0 && x - h < a.x1 && y + h > a.y0 && y - h < a.y1) return true;
    for (const p of placed) if (Math.abs(p.x - x) < SIZE && Math.abs(p.y - y) < SIZE) return true;
    return false;
  }

  /**
   * @param targets everything that could be pointed at this frame
   * @param from the player position (distance readout)
   * @param joystick screen rect of the active joystick (avoided), if any
   */
  update(dt: number, targets: IndicatorTarget[], from: { x: number; z: number }, joystick: Rect | null) {
    const W = window.innerWidth, H = window.innerHeight;
    this.avoidT -= dt;
    if (this.avoidT <= 0 || joystick) { this.avoidT = 0.4; this.refreshAvoid(joystick ? [joystick] : []); }
    const s = this.safe;
    const edge: Rect = { x0: s.l + SIZE / 2 + 6, y0: s.t + SIZE / 2 + 6, x1: W - s.r - SIZE / 2 - 6, y1: H - s.b - SIZE / 2 - 6 };
    const cx = (edge.x0 + edge.x1) / 2, cy = (edge.y0 + edge.y1) / 2;

    for (const it of this.items.values()) it.want = 0;
    const list = targets
      .map((t) => ({ t, d: Math.hypot(t.x - from.x, t.z - from.z) }))
      .filter((q) => q.d >= (q.t.minDist ?? 0))
      .sort((a, b) => STYLE[a.t.kind].priority - STYLE[b.t.kind].priority || a.d - b.d);

    const placed: { x: number; y: number }[] = [];
    let shown = 0;
    for (const { t, d } of list) {
      const it = this.item(t);
      it.target = t;
      this.v.set(t.x, t.y ?? 1, t.z).project(this.camera);
      const behind = this.v.z > 1;
      const sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
      const onScreen = !behind && sx > s.l && sx < W - s.r && sy > s.t && sy < H - s.b;
      if (onScreen || shown >= this.max) continue;
      // ray from the screen centre towards the target, clipped to the border rectangle
      let dx = sx - cx, dy = sy - cy;
      if (behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(dy, dx);
      const k = Math.min((edge.x1 - cx) / Math.abs(Math.cos(ang) || 1e-6), (edge.y1 - cy) / Math.abs(Math.sin(ang) || 1e-6));
      const base = this.toPerim(edge, cx + Math.cos(ang) * k, cy + Math.sin(ang) * k);
      // slide along the border (alternating sides) until it clears the HUD and the other arrows
      let pos = this.fromPerim(edge, base);
      for (let step = 1; step < 80 && this.blocked(pos.x, pos.y, placed); step++) {
        pos = this.fromPerim(edge, base + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 10);
      }
      placed.push(pos);
      shown++;
      // the arrow always points exactly at the target, wherever it ended up on the border
      const aim = behind ? ang : Math.atan2(sy - pos.y, sx - pos.x);
      it.want = 1;
      const st = STYLE[t.kind];
      it.el.className = `osi ${t.kind}${st.pulse ? ' pulse' : ''}`;
      it.el.style.setProperty('--c', st.color);
      it.el.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) translate(-50%, -50%)`;
      it.arrow.style.transform = `rotate(${aim}rad)`;
      if (it.icon.textContent !== t.icon) it.icon.textContent = t.icon;
      const txt = `${Math.round(d)} m`;
      if (it.dist.textContent !== txt) it.dist.textContent = txt;
    }
    // fade in/out
    for (const it of this.items.values()) {
      it.alpha += (it.want - it.alpha) * Math.min(1, dt * 8);
      if (it.alpha < 0.02 && it.want === 0) { if (it.el.style.display !== 'none') it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      it.el.style.opacity = it.alpha.toFixed(2);
      it.el.style.pointerEvents = it.want ? 'auto' : 'none';
    }
  }
}
