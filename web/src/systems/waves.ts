import { BALANCE } from '../config/balance';
import { events, type Vec2 } from '../core/events';
import { rand, randInt, pick } from '../core/math';
import type { Game } from '../game';
import type { EnemyKind } from '../entities/enemy';

const W = BALANCE.waves;

/** WaveManager — timers, composition, spawn side, warnings. Also keeps wild hunting-ground bears alive. */
export class Waves {
  wave = 0; // last started wave number
  timer = W.firstWaveAt;
  state: 'calm' | 'warning' | 'active' = 'calm';
  dir: Vec2 = { x: 1, z: 0 };
  spawnPoint: Vec2 = { x: 0, z: 0 };
  private queue: { kind: EnemyKind; delay: number }[] = [];
  private hpScale = 1;
  waveEnemies = 0;
  private wildT = 2;

  constructor(private game: Game) {}

  get day() { return 1 + Math.floor(this.wave / 3); }
  /** Bosses come every `bossEvery` waves, but only once the camp has grown past the first stage. */
  isBossWave(n: number) { return n % W.bossEvery === 0 && this.game.stage >= W.bossFromStage; }
  get nextIsBoss() { return this.isBossWave(this.wave + 1); }
  /** Wave number used for size / HP: capped by how far the camp has progressed. */
  effective(n: number) { return Math.min(n, W.stageWaveCap[this.game.stage] ?? n); }

  update(dt: number) {
    const g = this.game;
    if (this.state !== 'active') {
      this.timer -= dt;
      if (this.state === 'calm' && this.timer <= W.warningSeconds) this.warn();
      if (this.timer <= 0) this.start();
    } else {
      // stagger spawns
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const q = this.queue[i];
        q.delay -= dt;
        if (q.delay <= 0) {
          this.queue.splice(i, 1);
          const sp = W.spawnSpread;
          const x = this.spawnPoint.x + rand(-sp, sp) * Math.abs(this.dir.z);
          const z = this.spawnPoint.z + rand(-sp, sp) * Math.abs(this.dir.x);
          g.spawnEnemy(q.kind, x, z, this.hpScale, false);
        }
      }
      this.waveEnemies = g.enemies.filter((e) => !e.wild && e.alive).length;
      if (this.queue.length === 0 && this.waveEnemies === 0) {
        this.state = 'calm';
        this.timer = rand(W.intervalMin, W.intervalMax) * (W.intervalMultByStage[this.game.stage] ?? 1);
        events.emit('wave:end', { wave: this.wave });
      }
    }
    this.updateWild(dt);
  }

  private warn() {
    this.state = 'warning';
    const g = this.game;
    // choose a side whose edge is open land
    const b = g.world.openBounds();
    const sides: Vec2[] = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    // first waves always come from the east so the first ballista spot covers them
    this.dir = this.wave < 2 ? { x: 1, z: 0.0001 } : pick(sides);
    const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2;
    const edgeX = this.dir.x > 0 ? b[2] - 2 : this.dir.x < 0 ? b[0] + 2 : cx;
    const edgeZ = this.dir.z > 0.5 ? b[3] - 2 : this.dir.z < -0.5 ? b[1] + 2 : cz;
    // ~14 m outside the wall on that side, near the camp axis, so enemies reach it in reasonable time
    const cb = g.palisade.bounds;
    this.spawnPoint = {
      x: Math.abs(this.dir.x) > 0.5 ? Math.max(cb.x0 - 14, Math.min(cb.x1 + 14, edgeX)) : rand(-8, 8),
      z: Math.abs(this.dir.z) > 0.5 ? Math.max(cb.z0 - 14, Math.min(cb.z1 + 14, edgeZ)) : rand(-8, 8),
    };
    const nextWave = this.wave + 1;
    events.emit('wave:warning', { wave: nextWave, dir: this.dir, boss: this.isBossWave(nextWave) });
  }

  /**
   * Wave makeup. Special enemies are added first and bears fill whatever room is left under the cap
   * (before, late waves were 26 bears and the cap cut every wolf, bat and troll).
   */
  composition(n: number, stage: number, boss = n % W.bossEvery === 0 && stage >= W.bossFromStage): EnemyKind[] {
    const mult = W.stageMultiplier[stage] ?? 1;
    const CAP = 26;
    const list: EnemyKind[] = [];
    if (boss) list.push('alpha');
    // the mine wakes things up: mountain trolls smash the wall, ice bat swarms fly over it
    if (stage >= W.trollsFromStage && n % 4 === 0) for (let i = 0, c = 1 + Math.floor(n / 12); i < c; i++) list.push('troll');
    if (stage >= W.batsFromStage && n % 3 === 0) for (let i = 0, c = 4 + Math.floor(n / 4); i < c; i++) list.push('bat');
    if (stage >= W.wolvesFromStage) for (let i = 0, c = 3 + Math.floor(n / 5); i < c; i++) list.push('wolf');
    if (n >= W.familyFromWave && n % 2 === 0) {
      list.push('mother');
      for (let i = 0, c = randInt(2, 3); i < c; i++) list.push('cub');
    }
    const bears = n <= W.easyWaves.length ? W.easyWaves[n - 1] : Math.round((2 + (n - W.easyWaves.length) * 0.8) * mult);
    for (let i = 0; i < bears && list.length < CAP; i++) list.push('bear');
    return list.slice(0, CAP);
  }

  start() {
    if (this.state === 'calm') this.warn();
    this.wave++;
    this.state = 'active';
    const g = this.game;
    const mult = W.stageMultiplier[g.stage] ?? 1;
    const eff = this.effective(this.wave);
    this.hpScale = (1 + BALANCE.enemies.hpScalePerWave * (eff - 1)) * (0.8 + 0.2 * mult);
    const kinds = this.composition(eff, g.stage, this.isBossWave(this.wave));
    this.queue = kinds.map((kind, i) => ({ kind, delay: i * 0.45 + (kind === 'alpha' ? 1.5 : 0) }));
    events.emit('wave:start', { wave: this.wave, count: kinds.length, boss: kinds.includes('alpha') });
  }

  /** Debug / skip button. */
  skipToWave() { if (this.state !== 'active') this.timer = Math.min(this.timer, W.warningSeconds + 0.1); }

  /** Wild herds roaming outside the walls (2–3 animals each) — hunting targets and extra danger. */
  private updateWild(dt: number) {
    const g = this.game;
    const regions = g.world.openRegions().filter((r) => r.wildBears);
    const want = regions.reduce((n, r) => n + (r.wildBears ?? 0), 0);
    const have = g.enemies.filter((e) => e.wild && e.alive).length;
    if (have >= want) return;
    this.wildT -= dt;
    if (this.wildT > 0) return;
    this.wildT = BALANCE.wildBears.respawn;
    // regions that are short of animals
    const r = pick(regions.filter((q) => g.enemies.filter((e) => e.wild && e.alive && g.world.regionAt(e.x, e.z).id === q.id).length < (q.wildBears ?? 0)));
    if (!r) return;
    for (let tries = 0; tries < 30; tries++) {
      const x = rand(r.rect[0] + 4, r.rect[2] - 4), z = rand(r.rect[1] + 4, r.rect[3] - 4);
      if (g.palisade.inside(x, z, -3)) continue; // never inside the camp
      if (!g.nav.walkable(x, z, false)) continue;
      if ((x - g.player.x) ** 2 + (z - g.player.z) ** 2 < 144) continue;
      const herd = Math.min(r.wild ? randInt(1, 2) : randInt(BALANCE.wildBears.herdMin, BALANCE.wildBears.herdMax), want - have);
      for (let i = 0; i < herd; i++) {
        const hx = x + rand(-1.5, 1.5), hz = z + rand(-1.5, 1.5);
        const kind: EnemyKind = r.wild ? (pick(r.wild) as EnemyKind) : r.id === 'camp' || r.id === 'east' ? 'bear' : i === 0 ? 'bear' : 'wolf';
        if (g.nav.walkable(hx, hz, false)) g.spawnEnemy(kind, hx, hz, 1, true);
      }
      break;
    }
  }

  serialize() { return { wave: this.wave, timer: this.timer }; }
  restore(d: { wave: number; timer: number }) {
    this.wave = d.wave;
    this.timer = Math.max(W.warningSeconds + 5, d.timer);
    this.state = 'calm';
  }
}
