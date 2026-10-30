import { clamp } from './math';

/**
 * Floating virtual joystick: appears wherever the finger touches.
 * Also supports WASD / arrows for desktop testing.
 * Output: screen-space vector (x right, y down), magnitude 0..1.
 */
export class Input {
  x = 0;
  y = 0;
  active = false;
  /** true once the player touched/moved at least once (used by onboarding) */
  hasMoved = false;
  onFirstTouch?: () => void;

  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private readonly radius = 60;
  private keys = new Set<string>();
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  enabled = true;

  constructor(surface: HTMLElement, uiRoot: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    uiRoot.appendChild(this.base);

    surface.addEventListener('pointerdown', this.down, { passive: false });
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('keydown', (e) => { this.keys.add(e.key.toLowerCase()); this.firstTouch(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.release(); });
  }

  private firstTouch() {
    if (this.onFirstTouch) { const f = this.onFirstTouch; this.onFirstTouch = undefined; f(); }
  }

  private down = (e: PointerEvent) => {
    this.firstTouch();
    if (!this.enabled || this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.ox = e.clientX;
    this.oy = e.clientY;
    this.active = true;
    this.base.style.display = 'block';
    this.base.style.left = `${this.ox}px`;
    this.base.style.top = `${this.oy}px`;
    this.knob.style.transform = 'translate(-50%, -50%)';
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      // drag the base along so the stick never "sticks" at the edge
      const k = (len - this.radius) / len;
      this.ox += dx * k;
      this.oy += dy * k;
      dx = e.clientX - this.ox;
      dy = e.clientY - this.oy;
      this.base.style.left = `${this.ox}px`;
      this.base.style.top = `${this.oy}px`;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / this.radius);
    const dead = 0.12;
    if (m > dead) {
      const n = Math.hypot(dx, dy) || 1;
      const mag = clamp((m - dead) / (1 - dead), 0, 1);
      this.x = (dx / n) * mag;
      this.y = (dy / n) * mag;
      this.hasMoved = true;
    } else { this.x = 0; this.y = 0; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  };

  release() {
    this.pointerId = null;
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.base.style.display = 'none';
  }

  /** Combined direction (joystick or keyboard). */
  read(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let kx = 0, ky = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) kx -= 1;
    if (k.has('d') || k.has('arrowright')) kx += 1;
    if (k.has('w') || k.has('arrowup')) ky -= 1;
    if (k.has('s') || k.has('arrowdown')) ky += 1;
    if (kx || ky) {
      const n = Math.hypot(kx, ky);
      this.hasMoved = true;
      return { x: kx / n, y: ky / n };
    }
    return { x: this.x, y: this.y };
  }
}
