import * as THREE from 'three';
import { BALANCE } from './config/balance';
import { STAGES, WALL_LEVELS, type ItemType, type WorkerKind } from './config/layout';
import { events } from './core/events';
import { Input } from './core/input';
import { AudioManager } from './core/audio';
import { Platform, type HapticStyle } from './core/platform';
import { Monetization, type ProductId } from './core/monetization';
import { SaveSystem, SAVE_VERSION, type SaveData } from './core/save';
import { RESOURCES, res, biomeOfChunk, validateContent } from './config/content';
import { Pool } from './core/pool';
import { damp, fmt, rand } from './core/math';
import { World } from './world/world';
import { Geo, itemGeo } from './world/models';
import { FX } from './systems/fx';
import { Economy, type Cost } from './systems/economy';
import { Upgrades } from './systems/upgrades';
import { Waves } from './systems/waves';
import { Survivors } from './systems/survivors';
import { Pickups } from './systems/pickups';
import { Zones } from './systems/zones';
import { Tutorial } from './systems/tutorial';
import type { CurrencyPile, Port } from './systems/storage';
import { Player } from './entities/player';
import { Enemy, type Damageable, type EnemyKind } from './entities/enemy';
import { Worker } from './entities/worker';
import type { ResourceStack } from './entities/stack';
import type { Building } from './buildings/building';
import type { Stall, Diner, Furnace } from './buildings/camp';
import { Producer, bankable } from './buildings/producer';
import { Projectiles } from './buildings/defense';
import { Labels } from './ui/labels';
import { HUD } from './ui/hud';
import { DebugPanel } from './ui/debug';

const CAM = BALANCE.camera;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly audio = new AudioManager();
  readonly monetization = new Monetization();
  readonly world: World;
  readonly fx: FX;
  readonly labels: Labels;
  readonly hud: HUD;
  readonly eco = new Economy();
  readonly up: Upgrades;
  readonly player: Player;
  readonly waves: Waves;
  readonly survivors: Survivors;
  readonly pickups: Pickups;
  readonly zones: Zones;
  readonly tutorial: Tutorial;
  readonly projectiles: Projectiles;
  readonly saver: SaveSystem;
  readonly debug: DebugPanel;
  /** problems found in the JSON content (shown in the debug panel) */
  readonly contentErrors: string[];
  readonly buildings = new Map<string, Building>();
  readonly ports: Port[] = [];
  readonly cashPiles: CurrencyPile[] = [];
  enemies: Enemy[] = [];
  workers: Worker[] = [];
  readonly cashGeo = Geo.cash();
  readonly goldGeo = Geo.goldBar();

  time = 0;
  playTime = 0;
  stage = 1;
  loading = true;
  settings = { music: true, sfx: true, haptics: true };
  timeScale = 1;
  /** fuel burn multiplier for producers/furnace (weather raises it) */
  fuelMult = 1;
  /** debug: player takes no damage */
  god = false;

  private camTarget = new THREE.Vector3();
  private shakeAmt = 0;
  private transferT = 0;
  private derivedT = 0;
  private fullWarnT = 0;
  private enemyPools: { bear: Pool<Enemy>; wolf: Pool<Enemy> };
  private telegraphs: Pool<THREE.Mesh>;
  private hiddenAt = 0;
  private last = performance.now();
  /** Adaptive quality: shadows first, then resolution (never below 1.5x on retina screens). */
  private perf = {
    frames: 0, time: 0, warmup: 6, bad: 0, done: false,
    ratio: Math.min(window.devicePixelRatio, 2.5),
    minRatio: Math.min(window.devicePixelRatio, 1.5),
    lastFps: 0, lastChange: '' as '' | 'shadows' | 'ratio',
  };

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(CAM.fov, 1, 1, 260);

    this.contentErrors = validateContent();
    this.input = new Input(this.renderer.domElement, uiRoot);
    this.world = new World(this.scene);
    this.fx = new FX(this.scene);
    this.labels = new Labels(uiRoot, this.camera);
    this.up = new Upgrades(this.eco);
    this.survivors = new Survivors(this);
    this.player = new Player(this);
    this.waves = new Waves(this);
    this.pickups = new Pickups(this);
    this.projectiles = new Projectiles(this);
    this.hud = new HUD(this, uiRoot);
    this.zones = new Zones(this);
    this.tutorial = new Tutorial(this);

    this.enemyPools = {
      bear: new Pool(() => new Enemy(this, false), (e) => this.scene.add(e.root), (e) => this.scene.remove(e.root)),
      wolf: new Pool(() => new Enemy(this, true), (e) => this.scene.add(e.root), (e) => this.scene.remove(e.root)),
    };
    this.enemyPools.bear.prewarm(8);
    const tgeo = new THREE.CircleGeometry(1, 32);
    tgeo.rotateX(-Math.PI / 2);
    this.telegraphs = new Pool<THREE.Mesh>(() => {
      const m = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.4, depthWrite: false }));
      m.renderOrder = 3;
      return m;
    }, (m) => this.scene.add(m), (m) => this.scene.remove(m));

    this.saver = new SaveSystem(() => this.serialize());
    this.debug = new DebugPanel(this, uiRoot);
    this.bindFeedback();
    this.boot();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => this.onVisibility());
    (window as any).game = this; // handy for debugging / automated tests
  }

  // ================================================================== accessors
  get nav() { return this.world.nav; }
  get trees() { return this.world.trees; }
  get palisade() { return this.world.palisade; }
  get heat() { return this.furnace?.heat ?? 0; }
  get furnace() { return this.building<Furnace>('furnace'); }
  get counter() { return this.building<Stall>('counter')!; }
  get meatStall() { return this.building<Stall>('meatstall'); }
  get stalls(): Stall[] { return [this.counter, this.meatStall].filter((s): s is Stall => !!s); }

  /** Camp expansion: bigger wall, cleared forest, stalls move to the new wall. */
  setWallLevel(level: number) {
    const H = WALL_LEVELS[Math.min(level, WALL_LEVELS.length) - 1];
    if (H <= this.palisade.half) return;
    this.world.setWallHalf(H);
    for (const s of this.stalls) s.place(H);
    this.palisade.setHpMult(this.up.wallHpMult);
    if (!this.loading) {
      this.fx.ring(0, 0, 0xffe27a, H, 0.9);
      this.shake(0.3);
      events.emit('toast', { text: 'The camp grew bigger!', color: '#ffe27a' });
    }
  }
  get kitchen() { return this.building<Producer>('kitchen'); }
  /** every built kitchen, in build order (cook i tends kitchen i) */
  get kitchens(): Producer[] { return this.producers.filter((p) => p.def.params?.producer === 'kitchen'); }
  get producers(): Producer[] { return [...this.buildings.values()].filter((b): b is Producer => b instanceof Producer); }
  get diner() { return this.building<Diner>('diner'); }
  get stageName() { return STAGES[this.stage - 1]?.name ?? ''; }
  building<T extends Building>(id: string) { return this.buildings.get(id) as T | undefined; }
  port(id: string) { return this.ports.find((p) => p.id === id); }
  addPort(p: Port) { this.ports.push(p); }
  addCashPile(p: CurrencyPile) { this.cashPiles.push(p); }

  // ================================================================== boot / save
  private boot() {
    const save = this.saver.load();
    this.zones.refresh(); // prebuilt camp core
    if (save) this.restore(save);
    else this.survivors.populate(BALANCE.start.population);
    this.loading = false;
    this.updateStage(true);
    this.applySettings();

    const params = new URLSearchParams(location.search);
    if (params.has('debug')) { this.eco.add('money', 20000); this.eco.add('gold', 300); this.eco.add('plank', 50); }
    if (params.has('speed')) this.timeScale = Number(params.get('speed')) || 1;
    if (params.has('wave')) this.waves.timer = 8;

    if (save) {
      const away = (Date.now() - save.savedAt) / 1000;
      setTimeout(() => this.offerOffline(away), 600);
      if (this.saver.loadedVersion < SAVE_VERSION) console.info(`save migrated v${this.saver.loadedVersion} -> v${SAVE_VERSION}`);
    }
    if (this.saver.loadError) setTimeout(() => events.emit('toast', { text: this.saver.loadError, color: '#ffb4a8' }), 800);
    if (this.contentErrors.length && params.has('debug')) setTimeout(() => events.emit('toast', { text: `${this.contentErrors.length} content errors — see debug panel`, color: '#ffb4a8' }), 1200);
  }

  private serialize(): SaveData {
    const buildings: SaveData['buildings'] = {};
    for (const [id, b] of this.buildings) { const s = b.serialize(); if (s) buildings[id] = s; }
    const z = this.zones.serialize();
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      playTime: this.playTime,
      bank: { ...this.eco.bank },
      totalEarned: this.eco.totalEarned,
      heat: this.heat,
      built: z.built,
      paid: z.paid,
      paidItems: z.paidItems,
      upgrades: this.up.levels,
      buildings,
      palisade: this.world.palisade.serialize(),
      waves: this.waves.serialize(),
      player: this.player.serialize(),
      population: this.survivors.count,
      mood: this.survivors.mood,
      tutorial: this.tutorial.serialize(),
      pickups: this.pickups.serialize(),
      doubleIncomeLeft: this.eco.doubleIncomeLeft,
      iap: { adsRemoved: this.monetization.adsRemoved, starterPack: this.monetization.starterPackBought },
      settings: this.settings,
    };
  }

  private restore(d: SaveData) {
    this.up.levels = { ...d.upgrades };
    this.monetization.adsRemoved = d.iap.adsRemoved;
    this.monetization.starterPackBought = d.iap.starterPack;
    if (d.iap.starterPack) this.up.grant('stackCap', 3);
    for (const id of d.built) if (this.zones.ensure(id)) this.zones.build(id, true);
    this.zones.restorePaid(d.paid ?? {}, d.paidItems ?? {});
    for (const [id, s] of Object.entries(d.buildings)) this.buildings.get(id)?.restore(s);
    this.world.palisade.setHpMult(this.up.wallHpMult);
    this.world.palisade.restore(d.palisade);
    this.waves.restore(d.waves);
    this.eco.bank = { ...this.eco.bank, ...d.bank };
    this.eco.totalEarned = d.totalEarned;
    this.eco.doubleIncomeLeft = d.doubleIncomeLeft;
    this.playTime = d.playTime;
    this.player.x = d.player.x; this.player.z = d.player.z;
    if (!this.nav.walkable(this.player.x, this.player.z)) { this.player.x = BALANCE.player.respawn.x; this.player.z = BALANCE.player.respawn.z; }
    this.player.hp = Math.max(1, d.player.hp);
    for (const t of d.player.stack.slice(0, this.up.stackCap)) this.player.stack.push(t);
    this.survivors.populate(Math.min(d.population, this.survivors.cap));
    for (const s of this.survivors.list) s.mood = d.mood;
    this.tutorial.restore(d.tutorial);
    for (const p of d.pickups.slice(0, 60)) this.pickups.spawn(p.t, p.x, p.z);
    this.settings = { ...this.settings, ...d.settings };
  }

  resetSave() {
    this.saver.reset();
    location.reload();
  }

  setSetting(k: keyof Game['settings'], v: boolean) {
    this.settings[k] = v;
    this.applySettings();
    this.saver.save();
  }

  private applySettings() {
    this.audio.setMusic(this.settings.music);
    this.audio.setSfx(this.settings.sfx);
    Platform.setHaptics(this.settings.haptics);
  }

  // ================================================================== resources
  /** How many of a resource the player owns: bank + backpack + every camp store (HUD / inventory). */
  resValue(id: string): number {
    const d = res(id);
    if (d.kind === 'currency') return this.eco.get(id);
    if (d.kind === 'derived') return (d.items ?? []).reduce((n, it) => n + this.resValue(it), 0);
    return this.eco.get(id) + (this.eco.derived[id] ?? 0);
  }

  /** Backpack + bank — what menus can spend. */
  spendable(id: string) { return this.eco.get(id) + (res(id).kind === 'item' ? this.player.stack.count(id) : 0); }
  affordable(cost: Cost) { return Object.entries(cost).every(([k, n]) => this.spendable(k) >= n); }

  /** Pay a menu cost: carried items are used first, then the Warehouse bank. */
  payCost(cost: Cost): boolean {
    if (!this.affordable(cost)) return false;
    for (const [k, n] of Object.entries(cost)) {
      let left = n;
      if (res(k).kind === 'item') while (left > 0 && this.player.stack.remove(k)) left--;
      if (left > 0) this.eco.add(k, -left);
    }
    return true;
  }

  /** Recount carried + stored items (cheap, every 0.25 s). */
  private recountItems() {
    const counts: Record<string, number> = {};
    for (const s of this.player.stack.slots) counts[s.type] = (counts[s.type] ?? 0) + 1;
    const seen = new Set<object>();
    for (const p of this.ports) {
      if (p.bank || seen.has(p.store)) continue;
      seen.add(p.store);
      counts[p.store.type] = (counts[p.store.type] ?? 0) + p.store.count;
    }
    for (const r of RESOURCES) if (r.kind === 'item') this.eco.derived[r.id] = counts[r.id] ?? 0;
  }

  /** Biome the player is standing in (drives the HUD resource set). */
  get currentBiome() { return biomeOfChunk(this.world.regionAt(this.player.x, this.player.z).id); }

  // ================================================================== offline progress
  /** Income per second produced by automation alone (used for offline earnings). */
  offlineRates() {
    const n = (k: WorkerKind) => this.workers.filter((w) => w.kind === k).length;
    const eff = BALANCE.economy.offlineEfficiency;
    let money = 0, gold = 0;
    const woodRate = n('lumberjack') * 0.22;
    if (n('carrier') && n('cashier')) {
      const demand = 2 / BALANCE.counter.visitorInterval; // visiting buyers, ~2 logs each
      money += Math.min(woodRate * 0.75, demand) * this.up.logPrice * this.survivors.moodMult;
    }
    if (n('hunter') && n('cook') && (this.diner || this.meatStall)) money += n('hunter') * 0.08 * this.up.mealPrice;
    if (n('miner') && this.building('cart') && this.building('smelter')) gold += n('miner') * 0.2 * (BALANCE.recipes.smeltGold.out.gold ?? 1) * this.up.goldIncomeMult;
    return { money: money * this.eco.incomeMult * eff, gold: gold * eff * 0.5 };
  }

  /** Hours of offline progress that count (research will raise it). */
  get offlineCapHours() { return BALANCE.economy.offlineCapHours; }

  /**
   * Fast-forward every production chain without visuals. Producers stop when inputs, fuel or storage
   * run out. Returns report lines for the "while you were away" window.
   */
  simulateProduction(seconds: number): string[] {
    const lines: string[] = [];
    const why = { input: 'ran out of input', fuel: 'ran out of fuel', full: 'storage full', staff: 'nobody to work it', '': '' };
    for (const p of this.producers) {
      // one tending worker per building of the same type
      const same = this.producers.filter((q) => q.spec === p.spec);
      const staffed = !p.spec.tend || this.workers.filter((w) => w.kind === p.spec.tend).length > same.indexOf(p);
      const r = p.simulate(seconds, staffed);
      const made = Object.entries(r.made).map(([k, n]) => `+${fmt(n)} ${res(k).icon}`).join(' ');
      if (made || r.stopped) lines.push(`${p.def.label}: ${made || 'nothing made'}${r.stopped ? ` — ${why[r.stopped]}` : ''}`);
    }
    return lines;
  }

  offerOffline(seconds: number, force = false) {
    if (seconds < BALANCE.economy.offlineMinSeconds && !force) return;
    const capped = Math.min(seconds, this.offlineCapHours * 3600);
    const r = this.offlineRates();
    const money = Math.floor(r.money * capped), gold = Math.floor(r.gold * capped);
    const lines = this.simulateProduction(capped * BALANCE.economy.offlineEfficiency);
    if (money <= 0 && gold <= 0 && !lines.length) return;
    this.hud.showOffline(money, gold, capped, lines, (double) => {
      const k = double ? 2 : 1;
      this.eco.add('money', money * k);
      if (gold) this.eco.add('gold', gold * k);
      if (money <= 0) return;
      this.labels.float(this.player.x, 2.6, this.player.z, `+$${fmt(money * k)}`, '#8dff7a', 1.4);
      this.saver.save();
    });
  }

  private onVisibility() {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.last = performance.now();
      if (this.hiddenAt) this.offerOffline((Date.now() - this.hiddenAt) / 1000);
      this.hiddenAt = 0;
    }
  }

  // ================================================================== monetization
  async rewardDoubleIncome() {
    if (await this.monetization.rewarded('double_income')) {
      this.eco.doubleIncomeLeft += BALANCE.monetization.doubleIncomeSeconds;
      events.emit('toast', { text: 'Income x2 for 5 minutes!', color: '#c9b3ff' });
    }
  }

  async rewardRepair() {
    if (await this.monetization.rewarded('instant_repair')) {
      this.world.palisade.repairAll();
      events.emit('toast', { text: 'Palisade repaired!', color: '#b8f5a8' });
    }
  }

  async buyIAP(id: ProductId) {
    if (!(await this.monetization.iap.purchase(id))) return;
    if (id === 'remove_ads') this.monetization.adsRemoved = true;
    else {
      this.monetization.starterPackBought = true;
      this.eco.add('money', 1000);
      this.eco.add('gold', 20);
      this.up.grant('stackCap', 3);
    }
    this.saver.save();
  }

  // ================================================================== services used by entities
  haptic(style: HapticStyle) { Platform.haptic(style); }
  shake(a: number) { this.shakeAmt = Math.min(1, this.shakeAmt + a); }

  nearestEnemy(x: number, z: number, r: number, filter?: (e: Enemy) => boolean): Enemy | null {
    let best: Enemy | null = null, bd = r * r;
    for (const e of this.enemies) {
      if (!e.alive || (filter && !filter(e))) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  combatants(): Damageable[] { return this.workers.filter((w) => w.combatant && w.alive); }

  spawnEnemy(kind: EnemyKind, x: number, z: number, hpScale: number, wild: boolean) {
    const e = (kind === 'wolf' ? this.enemyPools.wolf : this.enemyPools.bear).get();
    e.spawn(kind, x, z, hpScale, wild);
    this.enemies.push(e);
    this.fx.burst(x, 0.5, z, 0xffffff, 10, 4, 0.25);
    return e;
  }

  dropMeat(x: number, z: number, n: number) {
    for (let i = 0; i < n; i++) this.pickups.spawn('meat', x + rand(-1.2, 1.2), z + rand(-1.2, 1.2), new THREE.Vector3(x, 1.2, z));
  }

  dropGold(x: number, z: number, n: number) {
    const p = this.player;
    for (let i = 0; i < Math.min(n, 8); i++) {
      this.fx.fly(this.goldGeo, new THREE.Vector3(x, 1.4, z), () => new THREE.Vector3(p.x, 1.6, p.z), { dur: 0.6 + i * 0.08, arc: 3 });
    }
    setTimeout(() => {
      this.eco.add('gold', n);
      this.labels.float(p.x, 2.8, p.z, `+${n} gold`, '#ffd23f', 1.2);
      events.emit('currency:collected', { currency: 'gold', amount: n, x: p.x, z: p.z });
    }, 700);
  }

  telegraphCircle(x: number, z: number, r: number) {
    const m = this.telegraphs.get();
    m.position.set(x, 0.09, z);
    m.scale.setScalar(r);
    return m;
  }
  releaseTelegraph(m: THREE.Mesh) { this.telegraphs.release(m); }

  /** Item flies into a stack (or lands on the ground if the stack is full). */
  giveItemTo(stack: ResourceStack, type: ItemType, from: THREE.Vector3, dur = 0.35) {
    if (stack.space() <= 0) {
      this.pickups.spawn(type, from.x + rand(-1.2, 1.2), from.z + rand(-1.2, 1.2), from);
      if (stack === this.player.stack && this.fullWarnT <= 0) { this.fullWarnT = 4; events.emit('stack:full', {}); }
      return;
    }
    stack.incoming++;
    this.fx.fly(itemGeo(type), from, () => stack.topWorld(), {
      dur, arc: 1.8,
      done: () => {
        stack.incoming = Math.max(0, stack.incoming - 1);
        if (stack.size < stack.cap) stack.push(type);
        else this.pickups.spawn(type, from.x, from.z);
      },
    });
  }

  spawnLogsFromTree(x: number, z: number, n: number, collector: { stack: ResourceStack }) {
    for (let i = 0; i < n; i++) this.giveItemTo(collector.stack, 'log', new THREE.Vector3(x + rand(-0.4, 0.4), 1.4 + i * 0.3, z + rand(-0.4, 0.4)), 0.35 + i * 0.08);
  }

  transferToPort(stack: ResourceStack, port: Port) {
    const type = port.store.type;
    const from = stack.remove(type);
    if (!from) return;
    port.store.reserve();
    const anchor = port.anchor;
    this.fx.fly(itemGeo(type), from, () => (anchor ? anchor : port.store.landing()), { dur: 0.3, arc: 1.4, done: () => port.store.receive() });
    events.emit('item:deposit', { item: type, target: port.id });
  }

  takeFromPort(port: Port, stack: ResourceStack) {
    const from = port.store.source().clone();
    if (!port.store.take()) return;
    stack.incoming++;
    const type = port.store.type;
    this.fx.fly(itemGeo(type), from, () => stack.topWorld(), {
      dur: 0.3, arc: 1.4,
      done: () => { stack.incoming = Math.max(0, stack.incoming - 1); if (stack.size < stack.cap) stack.push(type); },
    });
    events.emit('item:pickup', { item: type });
  }

  /** Item flies from a stack into the Warehouse and is added to the resource bank. */
  bankItem(stack: ResourceStack, type: string, port: Port) {
    const from = stack.remove(type);
    if (!from) return;
    const to = port.anchor ?? new THREE.Vector3(port.x, 1, port.z);
    this.fx.fly(itemGeo(type), from, to, { dur: 0.3, arc: 1.4, done: () => { this.eco.add(type, 1); events.emit('item:banked', { item: type, amount: 1 }); } });
    events.emit('item:deposit', { item: type, target: port.id });
  }

  hireWorker(kind: WorkerKind, x: number, z: number) {
    const w = new Worker(this, kind, { x, z });
    this.workers.push(w);
    return w;
  }

  onBuilt(id: string) {
    if (id === 'stonewall' || id.startsWith('house')) this.saver.save();
    this.updateStage(this.loading);
  }

  private updateStage(silent: boolean) {
    let s = 1;
    for (const st of STAGES) if (!st.key || this.zones.built.has(st.key)) s = Math.max(s, st.id);
    if (s !== this.stage) {
      this.stage = s;
      if (!silent) events.emit('stage:changed', { stage: s, name: this.stageName });
    }
  }

  // ================================================================== feedback wiring
  private bindFeedback() {
    events.on('tree:fell', () => this.haptic('medium'));
    events.on('player:hit', () => this.haptic('heavy'));
    events.on('wave:warning', () => this.haptic('warning'));
    events.on('enemy:died', ({ kind }) => { if (kind === 'alpha') this.haptic('heavy'); });
    events.on('palisade:broken', ({ x, z }) => { this.shake(0.3); this.fx.burst(x, 1, z, 0x7a4a2a, 16, 5, 0.2); });
    events.on('upgrade:bought', () => { this.fx.ring(this.player.x, this.player.z, 0xffe27a, 2.5); this.world.palisade.setHpMult(this.up.wallHpMult); });
    events.on('meal:eaten', ({ amount }) => { const d = this.diner; if (d) this.labels.float(d.def.x, 2.4, d.def.z, `+$${amount}`, '#8dff7a'); });
  }

  // ================================================================== frame
  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const raw = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (document.visibilityState === 'hidden') return;
      this.update(raw * this.timeScale);
      this.renderer.render(this.scene, this.camera);
      this.debug.update(raw);
      this.adaptQuality(raw);
    };
    loop();
  }

  /** Drop render resolution step by step if the device can't hold ~55 FPS. */
  private adaptQuality(dt: number) {
    const p = this.perf;
    if (p.done) return;
    if (p.warmup > 0) { p.warmup -= dt; return; } // ignore shader-compile hitches at startup
    p.frames++;
    p.time += dt;
    if (p.time < 3) return;
    const fps = p.frames / p.time;
    p.frames = 0;
    p.time = 0;
    // A downgrade that didn't help means we're vsync/power-capped (e.g. iOS Low Power Mode = 30 FPS):
    // undo it and stop adapting instead of making the picture blurry for nothing.
    if (p.lastChange && fps < p.lastFps * 1.12) {
      if (p.lastChange === 'ratio') { p.ratio += 0.25; this.renderer.setPixelRatio(p.ratio); this.resize(); }
      else this.world.setShadows(true);
      p.done = true;
      return;
    }
    p.lastChange = '';
    if (fps >= 50) { p.bad = 0; return; }
    if (++p.bad < 2) return;
    p.bad = 0;
    p.lastFps = fps;
    if (this.world.shadows) { this.world.setShadows(false); p.lastChange = 'shadows'; }
    else if (p.ratio - 0.25 >= p.minRatio) { p.ratio -= 0.25; this.renderer.setPixelRatio(p.ratio); this.resize(); p.lastChange = 'ratio'; }
    else p.done = true;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep a similar horizontal view on wide screens
    this.camera.fov = w > h ? CAM.fov * 0.8 : CAM.fov * Math.min(1.25, Math.max(1, (h / w) / 1.9));
    this.camera.updateProjectionMatrix();
    this.labels.resize(w, h);
  }

  /** One simulation step (public so the debug panel can fast-forward). */
  update(dt: number) {
    this.time += dt;
    this.playTime += dt;
    const yaw = (CAM.yawDeg * Math.PI) / 180;

    this.eco.incomeMult = this.up.goldIncomeMult * (this.zones.built.has('monument') ? 1.5 : 1);
    this.eco.update(dt);
    this.player.update(dt, yaw);
    this.playerInteractions(dt);
    for (const b of this.buildings.values()) b.update(dt);
    this.waves.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.update(dt)) {
        this.enemies.splice(i, 1);
        (e.kind === 'wolf' ? this.enemyPools.wolf : this.enemyPools.bear).release(e);
      }
    }
    this.survivors.update(dt);
    for (const w of this.workers) w.update(dt);
    this.projectiles.update(dt);
    this.pickups.update(dt, this.time);
    this.zones.update(dt, this.time);
    this.world.palisade.update(dt, [this.player, ...this.workers, ...this.survivors.list]);
    this.world.update(dt, this.camTarget, this.heat / BALANCE.furnace.maxHeat, this.time);
    this.world.followSun(this.camTarget);
    this.fx.update(dt);
    this.tutorial.update(dt);
    this.updateCamera(dt, yaw);
    this.updateLabels(dt);
    this.hud.update(dt);
    this.saver.update(dt);
    const fd = Math.hypot(this.player.x, this.player.z + 1);
    this.audio.setFireLevel(Math.max(0, 1 - fd / 9) * (this.heat > 0 ? 1 : 0));
    this.audio.update(dt);

    this.derivedT -= dt;
    if (this.derivedT <= 0) {
      this.derivedT = 0.25;
      this.recountItems();
    }
    if (this.fullWarnT > 0) this.fullWarnT -= dt;
  }

  private playerInteractions(dt: number) {
    const p = this.player;
    if (!p.alive) return;
    const st = p.stack;
    this.transferT -= dt;
    if (this.transferT <= 0) {
      let did = false;
      for (const port of this.ports) {
        if (!port.player || (port.active && !port.active())) continue;
        if ((p.x - port.x) ** 2 + (p.z - port.z) ** 2 > port.r * port.r) continue;
        if (port.bank) {
          const t = st.firstOf(st.slots.map((s) => s.type).filter(bankable));
          if (!t) continue;
          this.bankItem(st, t, port);
          did = true; break;
        }
        if (port.mode === 'in' && st.has(port.store.type) && port.store.space() > 0) {
          this.transferToPort(st, port); did = true; break;
        }
        if (port.mode === 'out' && port.store.count > 0 && st.space() > 0) {
          this.takeFromPort(port, st); did = true; break;
        }
      }
      if (!did && st.has('log')) {
        const seg = this.world.palisade.nearestDamaged(p.x, p.z, BALANCE.palisade.repairRadius);
        if (seg) {
          const from = st.remove('log')!;
          this.fx.fly(Geo.log(), from, new THREE.Vector3(seg.cx, 1.2, seg.cz), {
            dur: 0.3, arc: 1.2,
            done: () => { this.world.palisade.repair(seg, BALANCE.palisade.repairPerLog); this.fx.burst(seg.cx, 1.2, seg.cz, 0xd08a4a, 5, 3, 0.12); },
          });
          events.emit('item:deposit', { item: 'log', target: 'palisade' });
          did = true;
        }
      }
      if (did) this.transferT = BALANCE.player.transferInterval;
    }
    this.pickups.collect(p.x, p.z, st);

    // scoop up money / gold piles
    for (const pile of this.cashPiles) {
      if (pile.amount <= 0) continue;
      if ((p.x - pile.x) ** 2 + (p.z - pile.z) ** 2 > 2.2 ** 2) continue;
      const amount = pile.amount;
      const geo = pile.currency === 'money' ? this.cashGeo : this.goldGeo;
      const n = Math.min(8, pile.pile.inst.count);
      for (let i = 0; i < n; i++) {
        const from = pile.pile.slotPos(Math.max(0, pile.pile.inst.count - 1 - i));
        this.fx.fly(geo, from, () => new THREE.Vector3(p.x, 1.6, p.z), { dur: 0.25 + i * 0.04, arc: 1.2, scaleTo: 0.5 });
      }
      pile.amount = 0;
      pile.refresh();
      this.eco.add(pile.currency, amount);
      this.labels.float(p.x, 2.8, p.z, pile.currency === 'money' ? `+$${fmt(amount)}` : `+${fmt(amount)} gold`, pile.currency === 'money' ? '#8dff7a' : '#ffd23f');
      events.emit('currency:collected', { currency: pile.currency, amount, x: p.x, z: p.z });
      this.haptic('light');
    }
  }

  private updateCamera(dt: number, yaw: number) {
    const p = this.player;
    const tx = p.x, tz = p.z;
    const k = damp(CAM.followDamping, dt);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    if (this.time < 0.1) this.camTarget.set(tx, 0, tz);
    const d = CAM.distance;
    let sx = 0, sy = 0;
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
      const s = this.shakeAmt * this.shakeAmt * 0.8;
      sx = (Math.random() - 0.5) * s; sy = (Math.random() - 0.5) * s;
    }
    this.camera.position.set(this.camTarget.x + Math.sin(yaw) * d + sx, CAM.height + sy, this.camTarget.z + Math.cos(yaw) * d);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z);
  }

  private updateLabels(dt: number) {
    const L = this.labels;
    L.begin();
    const p = this.player;
    if (p.hp < p.maxHp && p.alive) L.bar('player', p.hpBarAnchor, p.hp / p.maxHp, '#4cd964', 54);
    for (const e of this.enemies) {
      if (!e.alive || (e.showBar <= 0 && e.kind !== 'alpha' && e.hp >= e.maxHp)) continue;
      L.bar(`e${this.enemies.indexOf(e)}`, e.hpAnchor, e.hp / e.maxHp, '#ff4d4d', e.kind === 'alpha' ? 80 : 44);
    }
    for (const s of this.world.palisade.segments) {
      if (s.hp >= s.maxHp) continue;
      L.bar(`pal${s.i}`, new THREE.Vector3(s.cx, 3.3, s.cz), s.hp / s.maxHp, s.hp <= 0 ? '#888' : '#ffb340', 40);
    }
    for (const w of this.workers) {
      if (w.combatant && w.alive && w.hp < w.maxHp) L.bar(`w${this.workers.indexOf(w)}`, w.anchor, w.hp / w.maxHp, '#4cd964', 36);
    }
    for (const [id, b] of this.buildings) {
      const s = b.status();
      if (s) L.text(`b-${id}`, b.statusAnchor(), s);
    }
    L.end();
    L.update(dt);
  }
}
