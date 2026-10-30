import { BALANCE } from '../config/balance';
import { SLOTS } from '../config/layout';
import { Survivor } from '../entities/survivor';
import { events } from '../core/events';
import { rand } from '../core/math';
import type { Game } from '../game';

const S = BALANCE.survivors;

/** Population: arrivals (needs housing + heat), cold-driven departures, mood. */
export class Survivors {
  list: Survivor[] = [];
  homes: { x: number; z: number; cap: number }[] = [];
  private arrivalT = 2;
  private frozenT = 0;
  private wasFrozen = false;

  constructor(private game: Game) {}

  get cap() { return this.homes.reduce((n, h) => n + h.cap, 0); }
  get count() { return this.list.filter((s) => s.alive && s.state !== 'leave').length; }
  get mood() {
    const a = this.list.filter((s) => s.alive);
    return a.length ? a.reduce((n, s) => n + s.mood, 0) / a.length : 1;
  }
  /** income multiplier from mood: 0.5 .. 1 */
  get moodMult() { return 0.5 + 0.5 * this.mood; }

  addHome(x: number, z: number, cap: number) {
    this.homes.push({ x, z, cap });
  }

  private homeFor(): { x: number; z: number } {
    // the home with the most free room
    const counts = this.homes.map((h) => this.list.filter((s) => s.home.x === h.x + 0 && s.alive).length);
    let best = 0, bf = -Infinity;
    this.homes.forEach((h, i) => { const free = h.cap - counts[i]; if (free > bf) { bf = free; best = i; } });
    const h = this.homes[best] ?? { x: -6, z: 0 };
    return { x: h.x, z: h.z };
  }

  /** Spawn residents directly at home (new game / load). */
  populate(n: number) {
    for (let i = 0; i < n; i++) {
      const h = this.homeFor();
      const s = new Survivor(this.game, h.x + rand(-1.5, 1.5), h.z + rand(0.5, 2), h, false);
      this.list.push(s);
    }
  }

  nearest(x: number, z: number) {
    let best: Survivor | null = null, bd = Infinity;
    for (const s of this.list) {
      if (!s.alive || s.state === 'leave' || !this.game.palisade.inside(s.x, s.z)) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  update(dt: number) {
    const g = this.game;
    const frozen = g.heat <= 0;
    if (frozen !== this.wasFrozen) {
      this.wasFrozen = frozen;
      events.emit(frozen ? 'heat:empty' : 'heat:restored', {});
    }
    if (frozen) {
      this.frozenT += dt;
      if (this.frozenT >= S.frozenLeaveSeconds) {
        this.frozenT = 0;
        const s = this.list.find((q) => q.alive && q.state !== 'leave');
        if (s) { s.leave(); events.emit('survivor:left', { reason: 'cold' }); }
      }
    } else {
      this.frozenT = 0;
      if (this.count < this.cap) {
        this.arrivalT -= dt;
        if (this.arrivalT <= 0 && this.list.length < S.maxVisible + 6) {
          this.arrivalT = S.arrivalInterval;
          const h = this.homeFor();
          const s = new Survivor(g, SLOTS.campEntry.x + rand(-2, 2), SLOTS.campEntry.z, h, true);
          this.list.push(s);
          events.emit('survivor:arrived', {});
        }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.update(dt);
      if (s.gone) { s.dispose(); this.list.splice(i, 1); }
    }
  }
}
