/**
 * Resource flow bookkeeping for the Logistics screen and balance checks: who produced / consumed how
 * much of each resource over the last minute, and how much of the time each key building was working.
 * Rolling window of 12 x 5 s buckets.
 */
const BUCKET = 5;
const N = 12;

type Counts = Map<string, number>; // key `${res}|${who}` -> signed amount

export class Flows {
  private buckets: Counts[] = Array.from({ length: N }, () => new Map());
  private up: Map<string, { on: number; total: number }>[] = Array.from({ length: N }, () => new Map());
  private i = 0;
  private t = 0;
  /** seconds of data in the window (the first minute is shorter) */
  private span = 0;

  /** +n produced / -n consumed of `res` by `who` (building id or worker kind). */
  /** called for every positive production (Logistics uses it for the stall's share of logs) */
  onProduce?: (res: string, n: number) => void;

  add(res: string, n: number, who: string) {
    if (n > 0 && !res.includes('>')) this.onProduce?.(res, n);
    const b = this.buckets[this.i], k = `${res}|${who}`;
    b.set(k, (b.get(k) ?? 0) + n);
  }

  /** Record whether `what` was working during this frame. */
  track(what: string, on: boolean, dt: number) {
    const u = this.up[this.i];
    let e = u.get(what);
    if (!e) { e = { on: 0, total: 0 }; u.set(what, e); }
    e.total += dt;
    if (on) e.on += dt;
  }

  update(dt: number) {
    this.t += dt;
    this.span = Math.min(BUCKET * N, this.span + dt);
    if (this.t < BUCKET) return;
    this.t -= BUCKET;
    this.i = (this.i + 1) % N;
    this.buckets[this.i].clear();
    this.up[this.i].clear();
  }

  /** Per-minute rates: res -> who -> signed amount per minute. */
  rates(): Map<string, Map<string, number>> {
    const sum = new Map<string, Map<string, number>>();
    const scale = 60 / Math.max(1, this.span);
    for (const b of this.buckets) for (const [k, v] of b) {
      const [res, who] = k.split('|');
      let r = sum.get(res);
      if (!r) { r = new Map(); sum.set(res, r); }
      r.set(who, (r.get(who) ?? 0) + v * scale);
    }
    return sum;
  }

  /** Net per minute for one resource. */
  net(res: string) { let n = 0; for (const v of this.rates().get(res)?.values() ?? []) n += v; return n; }

  /** Share of time (0..1) `what` was working over the window. */
  uptime(what: string) {
    let on = 0, total = 0;
    for (const u of this.up) { const e = u.get(what); if (e) { on += e.on; total += e.total; } }
    return total > 0 ? on / total : 0;
  }

  get tracked() { const s = new Set<string>(); for (const u of this.up) for (const k of u.keys()) s.add(k); return [...s]; }
}
