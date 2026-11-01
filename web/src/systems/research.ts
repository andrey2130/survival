import researchData from '../data/research.json';
import { events } from '../core/events';
import { res } from '../config/content';
import type { Game } from '../game';

export interface ResearchNode {
  id: string;
  branch: string;
  name: string;
  desc: string;
  cost: Record<string, number>;
  seconds: number;
  requires?: string[];
  effect: { grant?: Record<string, number>; key?: string; value?: number };
}

export const BRANCHES = researchData.branches;
export const NODES = researchData.nodes as unknown as ResearchNode[];

/**
 * Research tree at the Laboratory: one project at a time, paid when started, finishes after
 * `seconds` of game time. Effects: free upgrade levels (grant) or special bonuses (value(key)).
 */
export class Research {
  done = new Set<string>();
  current: { id: string; t: number } | null = null;
  private granted = new Set<string>();

  constructor(private game: Game) {}

  get built() { return this.game.zones.built.has('lab'); }
  node(id: string) { return NODES.find((n) => n.id === id); }
  state(n: ResearchNode): 'done' | 'running' | 'ready' | 'locked' {
    if (this.done.has(n.id)) return 'done';
    if (this.current?.id === n.id) return 'running';
    return (n.requires ?? []).every((r) => this.done.has(r)) ? 'ready' : 'locked';
  }

  /** Sum of special bonuses of finished projects (prod, warmth, food, heal). */
  value(key: string) {
    let v = 0;
    for (const id of this.done) { const n = this.node(id); if (n?.effect.key === key) v += n.effect.value ?? 0; }
    return v;
  }

  start(id: string): boolean {
    const g = this.game, n = this.node(id);
    if (!n || !this.built || this.current || this.state(n) !== 'ready' || !g.payCost(n.cost)) return false;
    this.current = { id, t: 0 };
    events.emit('toast', { text: `🔬 Researching ${n.name}`, color: '#c9b3ff' });
    g.saver.save();
    return true;
  }

  private apply(n: ResearchNode) {
    if (this.granted.has(n.id)) return;
    this.granted.add(n.id);
    for (const [u, lv] of Object.entries(n.effect.grant ?? {})) if (this.game.up.def(u)) this.game.up.grant(u, lv);
  }

  update(dt: number) {
    if (!this.current || !this.built) return;
    const n = this.node(this.current.id);
    if (!n) { this.current = null; return; }
    this.current.t += dt;
    if (this.current.t < n.seconds) return;
    this.done.add(n.id);
    this.current = null;
    this.apply(n);
    this.game.hud.showBanner(`🔬 ${n.name} researched!`, 'good');
    this.game.saver.save();
  }

  costText(n: ResearchNode) { return Object.entries(n.cost).map(([k, v]) => `${res(k).icon}${v}`).join(' '); }

  serialize() { return { done: [...this.done], current: this.current }; }
  restore(d: { done?: string[]; current?: { id: string; t: number } | null } | undefined) {
    if (!d) return;
    this.done = new Set(d.done ?? []);
    this.current = d.current ?? null;
    for (const id of this.done) { const n = this.node(id); if (n) this.apply(n); }
  }
}
