import { BALANCE } from '../config/balance';
import { res } from '../config/content';
import { events } from '../core/events';
import { rand } from '../core/math';
import type { Game } from '../game';
import type { Resident } from './residents';

export interface ExpeditionType { id: string; name: string; icon: string; minutes: number; people: number; risk: number; special: number; loot: Record<string, number> }
interface Trip { type: string; endsAt: number; people: Resident[] }

export const EXPEDITIONS = BALANCE.expeditions.types as unknown as ExpeditionType[];

/**
 * Expedition Camp: send idle residents away for a few real-time minutes (also while the game is
 * closed). They come back with loot for the Warehouse — and sometimes with a new special resident,
 * or one fewer.
 */
export class Expeditions {
  trips: Trip[] = [];
  private checkT = 0;

  constructor(private game: Game) {}

  get built() { return this.game.zones.built.has('expedition'); }
  type(id: string) { return EXPEDITIONS.find((t) => t.id === id); }
  get away() { return this.trips.reduce((n, t) => n + t.people.length, 0); }

  canSend(id: string) {
    const t = this.type(id);
    return !!t && this.built && !this.trips.some((q) => q.type === id) && this.game.residents.idleSurvivors().length >= t.people;
  }

  send(id: string): boolean {
    const g = this.game, t = this.type(id);
    if (!t || !this.canSend(id)) return false;
    const people: Resident[] = [];
    for (const s of g.residents.idleSurvivors().slice(0, t.people)) { people.push(s.res!); g.survivors.remove(s); }
    this.trips.push({ type: id, endsAt: Date.now() + t.minutes * 60000, people });
    events.emit('toast', { text: `${t.icon} ${people.map((p) => p.name).join(', ')} left for the ${t.name.toLowerCase()}`, color: '#c9e8ff' });
    g.saver.save();
    return true;
  }

  private finish(trip: Trip) {
    const g = this.game, t = this.type(trip.type);
    if (!t) return;
    const back = trip.people.filter(() => Math.random() >= t.risk);
    const lost = trip.people.length - back.length;
    const entry = { x: 0, z: g.palisade.bounds.z1 + 4 };
    for (const r of back) { r.warmth = Math.min(r.warmth, 0.7); r.food = Math.min(r.food, 0.6); g.survivors.addResident(r, entry.x + rand(-2, 2), entry.z); }
    const got: string[] = [];
    for (const [k, n] of Object.entries(t.loot)) {
      const v = Math.max(1, Math.round(n * rand(0.7, 1.3) * (back.length / trip.people.length || 0.3)));
      g.eco.add(k, v);
      got.push(`${v} ${res(k).icon}`);
    }
    if (Math.random() < t.special) {
      const r = g.residents.create();
      g.residents.maybeSpecial(r, true);
      g.survivors.addResident(r, entry.x, entry.z);
    }
    g.hud.showBanner(`${t.icon} Expedition back!`, 'good');
    events.emit('toast', { text: `${t.name}: +${got.join(' ')}${lost ? ` · ${lost} didn't return 😢` : ''}`, color: lost ? '#ffd0a8' : '#b8f5a8' });
  }

  update(dt: number) {
    this.checkT -= dt;
    if (this.checkT > 0 || !this.trips.length) return;
    this.checkT = 1;
    const now = Date.now();
    for (const trip of [...this.trips]) if (trip.endsAt <= now) { this.trips.splice(this.trips.indexOf(trip), 1); this.finish(trip); this.game.saver.save(); }
  }

  serialize() { return { list: this.trips }; }
  restore(d: { list?: unknown[] } | undefined) { this.trips = (d?.list as Trip[] | undefined) ?? []; }
}
