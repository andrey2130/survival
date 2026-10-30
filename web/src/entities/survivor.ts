import { BALANCE } from '../config/balance';
import { SLOTS } from '../config/layout';
import { Walker } from './walker';
import { Bubble } from '../ui/bubbles';
import { events } from '../core/events';
import { rand, pick } from '../core/math';
import type { Game } from '../game';
import type { Damageable } from './enemy';

const S = BALANCE.survivors;
const SHIRTS = [0xe0723c, 0x6aa84f, 0x8e6bbf, 0xd9b44a, 0x4f9fd9, 0xc24f7a, 0x4fb3a5];
const HATS = [0x2f4f6f, 0xc0392b, 0xf1c40f, 0x16a085, 0x7f8c8d, 0xffffff];

type State = 'arrive' | 'idle' | 'toQueue' | 'queue' | 'toSeat' | 'waitFood' | 'eat' | 'leave';

/** Survivor / customer NPC: buys wood at the stall, eats at the canteen, freezes without heat. */
export class Survivor extends Walker implements Damageable {
  state: State = 'arrive';
  hp = S.hp;
  alive = true;
  mood = 1;
  want = 1;
  got = 0;
  seat = -1;
  gone = false;
  private woodT: number;
  private hungerT: number;
  private patience = 0;
  private eatT = 0;
  private wanderT = 0;
  private bubble: Bubble;
  private shiver = 0;

  constructor(game: Game, x: number, z: number, public home: { x: number; z: number }, arriving: boolean) {
    super(game, x, z, pick(SHIRTS), pick(HATS), null, 0.92);
    this.speed = S.speed * rand(0.9, 1.1);
    this.bubble = new Bubble(this.char.root);
    this.woodT = arriving ? rand(S.woodNeedMin, S.woodNeedMax) : rand(1, S.firstWoodNeed + 3);
    this.hungerT = rand(S.hungerMin, S.hungerMax);
    if (arriving) this.goTo(home.x, home.z);
    else this.state = 'idle';
  }

  get busy() { return this.state !== 'idle'; }

  hit(dmg: number) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.game.fx.burst(this.x, 1.2, this.z, 0xd9443a, 5, 3);
    if (this.hp <= 0) {
      this.alive = false;
      events.emit('survivor:left', { reason: 'hurt' });
      this.leave(1.7);
    }
  }

  leave(speedMult = 1) {
    this.releaseSlots();
    this.state = 'leave';
    this.speed = S.speed * speedMult;
    this.goTo(SLOTS.campEntry.x, SLOTS.campEntry.z);
  }

  private releaseSlots() {
    this.game.counter.leaveQueue(this);
    if (this.seat >= 0) { this.game.diner?.releaseSeat(this.seat); this.seat = -1; }
  }

  /** Called by the counter once the customer has all the wood they wanted. */
  served() {
    this.state = 'idle';
    this.woodT = rand(S.woodNeedMin, S.woodNeedMax);
    this.wanderT = 0;
  }

  get frozen() { return this.game.heat <= 0 && this.state !== 'leave' && this.alive; }

  update(dt: number) {
    const g = this.game;
    if (this.frozen) {
      this.moving = false;
      this.shiver += dt;
      this.char.root.position.x = this.x + Math.sin(this.shiver * 50) * 0.04;
      this.bubble.set('cold');
      this.char.root.rotation.y = this.facing;
      return;
    }
    const diner = g.diner;
    switch (this.state) {
      case 'arrive':
        if (!this.walk(dt)) this.state = 'idle';
        break;
      case 'idle': {
        this.woodT -= dt;
        if (diner) this.hungerT -= dt;
        if (diner && this.hungerT <= 0) {
          const seat = diner.claimSeat(this);
          if (seat >= 0) { this.seat = seat; this.state = 'toSeat'; const p = diner.seatPos(seat); this.goTo(p.x, p.z); break; }
          this.mood = Math.max(0, this.mood - dt * 0.01);
        }
        if (this.woodT <= 0 && g.counter.canJoin()) {
          this.want = Math.floor(rand(BALANCE.economy.customerWantMin, BALANCE.economy.customerWantMax + 1));
          this.got = 0;
          g.counter.joinQueue(this);
          this.state = 'toQueue';
          break;
        }
        // wander near home / warm fire
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = rand(3, 7);
          const warm = g.heat > 0 && Math.random() < 0.5;
          const cx = warm ? 0 : this.home.x, cz = warm ? 2.5 : this.home.z;
          const r = warm ? 4 : 2.2;
          const a = Math.random() * Math.PI * 2;
          const tx = cx + Math.cos(a) * r * rand(0.6, 1), tz = cz + Math.sin(a) * r * rand(0.6, 1);
          if (g.nav.walkable(tx, tz)) this.goTo(tx, tz);
        }
        this.walk(dt);
        break;
      }
      case 'toQueue':
      case 'queue': {
        const idx = g.counter.queueIndex(this);
        if (idx < 0) { this.state = 'idle'; break; }
        const p = g.counter.slotPos(idx);
        if (this.distTo(p.x, p.z) > 0.15) { this.goTo(p.x, p.z); this.walk(dt); }
        else { this.stop(); this.state = 'queue'; this.face(g.counter.def.x, g.counter.def.z - 2, dt); }
        break;
      }
      case 'toSeat':
        if (!diner) { this.state = 'idle'; break; }
        if (!this.walk(dt)) { this.state = 'waitFood'; this.patience = S.hungryPatience; }
        break;
      case 'waitFood':
        if (!diner) { this.state = 'idle'; break; }
        this.face(diner.def.x, diner.def.z, dt);
        this.patience -= dt;
        if (diner.takeFood(this)) { this.state = 'eat'; this.eatT = BALANCE.diner.eatSeconds; }
        else if (this.patience <= 0) {
          this.mood = Math.max(0, this.mood - S.moodLossNoFood);
          this.hungerT = rand(8, 14);
          diner.releaseSeat(this.seat);
          this.seat = -1;
          this.state = 'idle';
        }
        break;
      case 'eat':
        this.eatT -= dt;
        this.swing = (this.eatT * 2) % 1;
        if (this.eatT <= 0 && diner) {
          this.swing = 0;
          diner.pay(this);
          this.mood = Math.min(1, this.mood + S.moodRegenFed);
          this.hungerT = rand(S.hungerMin, S.hungerMax);
          diner.releaseSeat(this.seat);
          this.seat = -1;
          this.state = 'idle';
        }
        break;
      case 'leave':
        if (!this.walk(dt)) this.gone = true;
        break;
    }
    // bubble
    const b = this.state === 'toQueue' || this.state === 'queue' ? 'wood'
      : this.state === 'toSeat' || this.state === 'waitFood' ? 'food'
        : this.state === 'eat' ? 'happy'
          : this.state === 'leave' ? 'angry'
            : this.mood < 0.4 ? 'angry' : null;
    this.bubble.set(b);
    this.sync(dt);
  }

  serialize() { return { mood: this.mood }; }
}
