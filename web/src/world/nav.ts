import { WORLD } from '../config/layout';

export const enum Cell { Free = 0, Solid = 1, Wall = 2, Gate = 3, Locked = 4 }

/**
 * Grid navigation (A* with corner-cut prevention + string pulling).
 * Friendly units may pass gates; enemies treat gates and walls as obstacles they must break.
 */
export class NavGrid {
  readonly size: number;
  readonly origin = WORLD.min;
  readonly cells: Uint8Array;
  /** palisade segment index per cell (-1 when none) */
  readonly seg: Int16Array;

  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private curStamp = 1;
  private heap: Int32Array;

  constructor() {
    this.size = WORLD.max - WORLD.min;
    const n = this.size * this.size;
    this.cells = new Uint8Array(n);
    this.seg = new Int16Array(n).fill(-1);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
  }

  idx(x: number, z: number): number {
    const cx = Math.floor(x - this.origin);
    const cz = Math.floor(z - this.origin);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return -1;
    return cz * this.size + cx;
  }

  cellAt(x: number, z: number): Cell {
    const i = this.idx(x, z);
    return i < 0 ? Cell.Solid : (this.cells[i] as Cell);
  }

  passable(c: Cell, friendly: boolean) {
    return c === Cell.Free || (friendly && c === Cell.Gate);
  }

  walkable(x: number, z: number, friendly = true): boolean {
    return this.passable(this.cellAt(x, z), friendly);
  }

  /** Circle approximation: center + 4 compass points. */
  walkableR(x: number, z: number, r: number, friendly = true): boolean {
    return this.walkable(x, z, friendly) && this.walkable(x + r, z, friendly) && this.walkable(x - r, z, friendly)
      && this.walkable(x, z + r, friendly) && this.walkable(x, z - r, friendly);
  }

  setRect(minX: number, minZ: number, maxX: number, maxZ: number, c: Cell, onlyIf?: Cell) {
    for (let z = Math.floor(minZ); z < Math.ceil(maxZ); z++) {
      for (let x = Math.floor(minX); x < Math.ceil(maxX); x++) {
        const i = this.idx(x + 0.5, z + 0.5);
        if (i < 0) continue;
        if (onlyIf !== undefined && this.cells[i] !== onlyIf) continue;
        this.cells[i] = c;
      }
    }
  }

  setCircle(x: number, z: number, r: number, c: Cell) {
    for (let cz = Math.floor(z - r); cz <= Math.ceil(z + r); cz++) {
      for (let cx = Math.floor(x - r); cx <= Math.ceil(x + r); cx++) {
        if ((cx + 0.5 - x) ** 2 + (cz + 0.5 - z) ** 2 > r * r) continue;
        const i = this.idx(cx + 0.5, cz + 0.5);
        if (i >= 0 && this.cells[i] !== Cell.Locked) this.cells[i] = c;
      }
    }
  }

  /** Nearest passable cell center to (x,z). */
  nearestFree(x: number, z: number, friendly = true): { x: number; z: number } | null {
    if (this.walkable(x, z, friendly)) return { x, z };
    for (let r = 1; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const px = Math.floor(x) + dx + 0.5, pz = Math.floor(z) + dz + 0.5;
          if (this.walkable(px, pz, friendly)) return { x: px, z: pz };
        }
      }
    }
    return null;
  }

  lineClear(ax: number, az: number, bx: number, bz: number, friendly = true, r = 0.35): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / 0.4);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.walkableR(ax + (bx - ax) * t, az + (bz - az) * t, r, friendly)) return false;
    }
    return true;
  }

  findPath(sx: number, sz: number, tx: number, tz: number, friendly = true): { x: number; z: number }[] | null {
    if (this.lineClear(sx, sz, tx, tz, friendly)) return [{ x: tx, z: tz }];
    const start = this.nearestFree(sx, sz, friendly);
    const goal = this.nearestFree(tx, tz, friendly);
    if (!start || !goal) return null;
    const S = this.size;
    const si = this.idx(start.x, start.z), gi = this.idx(goal.x, goal.z);
    if (si < 0 || gi < 0) return null;
    const stamp = ++this.curStamp;
    const gx = gi % S, gz = Math.floor(gi / S);
    const h = (i: number) => {
      const dx = Math.abs((i % S) - gx), dz = Math.abs(Math.floor(i / S) - gz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    let heapN = 0;
    const heap = this.heap, f = this.f, g = this.g;
    const push = (i: number) => {
      let k = heapN++;
      heap[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--heapN];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < heapN && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heapN && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
      return top;
    };
    g[si] = 0; f[si] = h(si); this.stamp[si] = stamp; this.parent[si] = -1;
    push(si);
    let found = false;
    let iter = 0;
    const cells = this.cells;
    const pass = (i: number) => cells[i] === Cell.Free || (friendly && cells[i] === Cell.Gate);
    while (heapN > 0 && iter++ < 30000) {
      const cur = pop();
      if (cur === gi) { found = true; break; }
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      const cx = cur % S, cz = Math.floor(cur / S);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= S || nz >= S) continue;
          const ni = nz * S + nx;
          if (!pass(ni) || this.closed[ni] === stamp) continue;
          if (dx && dz && (!pass(cz * S + nx) || !pass(nz * S + cx))) continue; // no corner cutting
          const ng = g[cur] + (dx && dz ? 1.414 : 1);
          if (this.stamp[ni] !== stamp || ng < g[ni]) {
            this.stamp[ni] = stamp;
            g[ni] = ng;
            f[ni] = ng + h(ni);
            this.parent[ni] = cur;
            push(ni);
          }
        }
      }
    }
    if (!found) return null;
    const raw: { x: number; z: number }[] = [];
    for (let i = gi; i !== -1; i = this.parent[i]) {
      raw.push({ x: (i % S) + this.origin + 0.5, z: Math.floor(i / S) + this.origin + 0.5 });
      if (raw.length > 4000) break;
    }
    raw.reverse();
    raw[raw.length - 1] = this.walkable(tx, tz, friendly) ? { x: tx, z: tz } : raw[raw.length - 1];
    // string pulling
    const out: { x: number; z: number }[] = [];
    let ax = sx, az = sz;
    let k = 0;
    while (k < raw.length) {
      let far = k;
      for (let j = raw.length - 1; j > k; j--) {
        if (this.lineClear(ax, az, raw[j].x, raw[j].z, friendly)) { far = j; break; }
      }
      out.push(raw[far]);
      ax = raw[far].x; az = raw[far].z;
      k = far + 1;
    }
    return out;
  }
}
