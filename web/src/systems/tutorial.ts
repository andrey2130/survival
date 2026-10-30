import * as THREE from 'three';
import { SLOTS, ZONES } from '../config/layout';
import { Geo, mesh } from '../world/models';
import { events } from '../core/events';
import type { Game } from '../game';

interface Step {
  text: (g: Game) => string;
  target: (g: Game) => THREE.Vector3 | null;
  done: (g: Game, flags: Set<string>) => boolean;
}

const v = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z);
const zone = (id: string) => ZONES.find((z) => z.id === id)!;

const STEPS: Step[] = [
  { text: () => 'Swipe to move', target: () => null, done: (_g, f) => f.has('moved') },
  {
    text: () => 'Walk to a tree to chop it 🪓',
    target: (g) => { const t = g.trees.nearestGrown(g.player.x, g.player.z, 40, (r) => r === 'camp', true); return t ? v(t.x, t.z, 3.6) : null; },
    done: (_g, f) => f.has('chopped'),
  },
  { text: () => 'Bring logs to the furnace 🔥', target: () => v(SLOTS.furnaceInput.x, SLOTS.furnaceInput.z, 5.2), done: (_g, f) => f.has('furnace') },
  {
    text: (g) => (g.player.stack.has('log') ? 'Sell wood at the stall 🪵' : 'Chop more wood to sell 🪓'),
    target: (g) => {
      if (g.player.stack.has('log')) return v(g.counter.serve.x, g.counter.serve.z, 3.2);
      const t = g.trees.nearestGrown(g.player.x, g.player.z, 40, (r) => r === 'camp', true);
      return t ? v(t.x, t.z, 3.6) : null;
    },
    done: (_g, f) => f.has('served'),
  },
  { text: () => 'Collect your money 💵', target: (g) => v(g.counter.cash.x, g.counter.cash.z, 2), done: (_g, f) => f.has('cash') },
  {
    text: (g) => { const r = g.zones.remaining('tower1'); return g.eco.money >= r ? 'Build a Ballista tower 🏹' : `Earn $${r} for a Ballista ($${Math.floor(g.eco.money)})`; },
    target: (g) => {
      const r = g.zones.remaining('tower1');
      if (g.eco.money < r && g.counter.cash.amount > 0) return v(g.counter.cash.x, g.counter.cash.z, 2);
      return v(zone('tower1').x, zone('tower1').z, 2.5);
    },
    done: (g) => g.zones.built.has('tower1'),
  },
  {
    text: (g) => (g.waves.state === 'calm' ? 'Bears will attack soon — keep working!' : 'Defend the camp from the bears! 🐻'),
    target: (g) => { const e = g.enemies.find((q) => q.alive && !q.wild); return e ? v(e.x, e.z, 3.5) : null; },
    done: (_g, f) => f.has('waveEnd'),
  },
  {
    text: (g) => { const r = g.zones.remaining('kitchen'); return g.eco.money >= r ? 'Build the Kitchen 🍳' : `Earn $${r} for the Kitchen`; },
    target: () => v(zone('kitchen').x, zone('kitchen').z, 2.5),
    done: (g) => g.zones.built.has('kitchen'),
  },
  {
    text: (g) => (g.player.stack.has('meat') ? 'Grill the meat in the Kitchen 🍖' : 'Get meat from bears 🐻'),
    target: (g) => {
      if (g.player.stack.has('meat')) return v(SLOTS.kitchenInput.x, SLOTS.kitchenInput.z, 3.4);
      const p = g.pickups.nearest(g.player.x, g.player.z, 80, 'meat');
      if (p) return v(p.x, p.z, 2);
      const e = g.enemies.find((q) => q.alive);
      return e ? v(e.x, e.z, 3.5) : null;
    },
    done: (_g, f) => f.has('cooked'),
  },
];

/** Onboarding: short captions + a bouncing 3D arrow over the current target. */
export class Tutorial {
  step = 0;
  private flags = new Set<string>();
  private arrow: THREE.Mesh;
  private startPos = { x: 0, z: 0 };
  private t = 0;

  constructor(private game: Game) {
    this.arrow = mesh(Geo.arrow());
    this.arrow.visible = false;
    this.arrow.renderOrder = 20;
    game.scene.add(this.arrow);
    events.on('tree:fell', () => this.flags.add('chopped'));
    events.on('item:deposit', ({ target }) => { if (target === 'furnace') this.flags.add('furnace'); });
    events.on('customer:served', () => this.flags.add('served'));
    events.on('currency:collected', ({ currency }) => { if (currency === 'money') this.flags.add('cash'); });
    events.on('wave:end', () => this.flags.add('waveEnd'));
    events.on('cook:done', () => this.flags.add('cooked'));
    this.startPos = { x: game.player.x, z: game.player.z };
  }

  get done() { return this.step >= STEPS.length; }

  update(dt: number) {
    const g = this.game;
    this.t += dt;
    if (this.done) {
      this.arrow.visible = false;
      g.hud.setTutorial(null);
      g.hud.setTutorialPointer(null);
      g.hud.setSwipeHint(false);
      return;
    }
    if (Math.hypot(g.player.x - this.startPos.x, g.player.z - this.startPos.z) > 3) this.flags.add('moved');
    // flags set by events before the step was reached still count (e.g. served early)
    const s = STEPS[this.step];
    if (s.done(g, this.flags)) {
      this.step++;
      events.emit('tutorial:step', { step: this.step });
      g.haptic('success');
      if (this.done) { g.hud.showBanner('You are ready, chief!', 'good'); return; }
    }
    const cur = STEPS[this.step];
    g.hud.setSwipeHint(this.step === 0);
    g.hud.setTutorial(this.step === 0 ? null : cur.text(g));
    const target = cur.target(g);
    this.arrow.visible = !!target;
    if (target) {
      this.arrow.position.set(target.x, target.y + Math.abs(Math.sin(this.t * 4)) * 0.6, target.z);
      this.arrow.rotation.y += dt * 2;
    }
    g.hud.setTutorialPointer(target);
  }

  serialize() { return this.step; }
  restore(step: number) { this.step = step; }
}
