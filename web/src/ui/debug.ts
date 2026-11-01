import { BALANCE } from '../config/balance';
import { RESOURCES, BIOMES, biomeOfChunk } from '../config/content';
import { ZONES, regionById } from '../config/layout';
import regionsData from '../data/regions.json';
import { SAVE_VERSION } from '../core/save';
import { events } from '../core/events';
import { BATCH } from '../world/batcher';
import { fmt } from '../core/math';
import type { Game } from '../game';

interface Cmd { section: string; label: string; run: () => void; on?: () => boolean }

/**
 * Debug / balancing panel. Opens with a triple tap in any screen corner (or the ` key, or ?debug).
 * Systems register their own commands with `game.debug.add(...)`, so new stages extend it.
 */
export class DebugPanel {
  private cmds: Cmd[] = [];
  private panel: HTMLElement | null = null;
  private fpsEl: HTMLElement;
  private info: HTMLElement | null = null;
  private taps: number[] = [];
  private frames = 0;
  private acc = 0;
  private fps = 0;
  showFps = false;

  constructor(private game: Game, private root: HTMLElement) {
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'dbg-fps';
    this.fpsEl.style.display = 'none';
    root.appendChild(this.fpsEl);
    window.addEventListener('pointerdown', (e) => this.onTap(e), { capture: true, passive: true });
    window.addEventListener('keydown', (e) => { if (e.key === '`') this.toggle(); });
    if (new URLSearchParams(location.search).has('debug')) {
      const b = document.createElement('button');
      b.className = 'dbg-open';
      b.textContent = '🐞';
      b.onclick = () => this.toggle();
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      root.appendChild(b);
    }
    this.registerDefaults();
  }

  add(section: string, label: string, run: () => void, on?: () => boolean) { this.cmds.push({ section, label, run, on }); }

  private onTap(e: PointerEvent) {
    const W = window.innerWidth, H = window.innerHeight, m = 70;
    const corner = (e.clientX < m || e.clientX > W - m) && (e.clientY < m + 30 || e.clientY > H - m);
    if (!corner) { this.taps = []; return; }
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 700);
    this.taps.push(now);
    if (this.taps.length >= 3) { this.taps = []; this.toggle(); }
  }

  toggle() { if (this.panel) this.close(); else this.open(); }

  private close() {
    this.panel?.remove();
    this.panel = null;
    this.info = null;
    this.game.input.enabled = true;
  }

  private open() {
    const g = this.game;
    const p = document.createElement('div');
    p.className = 'dbg';
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    const head = document.createElement('div');
    head.className = 'dbg-head';
    head.innerHTML = '<b>🐞 Debug</b>';
    const x = document.createElement('button');
    x.textContent = '✕';
    x.onclick = () => this.close();
    head.appendChild(x);
    this.info = document.createElement('div');
    this.info.className = 'dbg-info';
    const body = document.createElement('div');
    body.className = 'dbg-body';
    const sections = [...new Set(this.cmds.map((c) => c.section))];
    for (const s of sections) {
      const h = document.createElement('div');
      h.className = 'dbg-sec';
      h.textContent = s;
      body.appendChild(h);
      const row = document.createElement('div');
      row.className = 'dbg-row';
      for (const c of this.cmds.filter((q) => q.section === s)) {
        const b = document.createElement('button');
        const paint = () => { b.textContent = c.on ? `${c.on() ? '☑' : '☐'} ${c.label}` : c.label; };
        paint();
        b.onclick = () => { try { c.run(); } catch (e) { console.error(e); events.emit('toast', { text: `debug: ${(e as Error).message}`, color: '#ffb4a8' }); } paint(); g.haptic('light'); };
        row.appendChild(b);
      }
      body.appendChild(row);
    }
    if (g.contentErrors.length) {
      const h = document.createElement('div');
      h.className = 'dbg-sec bad';
      h.textContent = `Content errors (${g.contentErrors.length})`;
      const pre = document.createElement('pre');
      pre.textContent = g.contentErrors.join('\n');
      body.append(h, pre);
    }
    p.append(head, this.info, body);
    this.root.appendChild(p);
    this.panel = p;
    g.input.enabled = false;
    g.input.release();
  }

  /** called every frame (real time) */
  private minFps = 99;

  update(rawDt: number) {
    if (rawDt > 0) this.minFps = Math.min(this.minFps, 1 / rawDt);
    this.frames++;
    this.acc += rawDt;
    if (this.acc >= 0.5) { this.fps = this.frames / this.acc; this.frames = 0; this.acc = 0; this.refreshInfo(); }
  }

  private refreshInfo() {
    const g = this.game;
    const txt = `FPS ${this.fps.toFixed(0)} · x${g.timeScale} · enemies ${g.enemies.length} · workers ${g.workers.length} · pop ${g.survivors.count} · ${g.currentBiome.name} · save v${SAVE_VERSION}`;
    this.fpsEl.style.display = this.showFps ? '' : 'none';
    if (this.showFps) {
      // render + memory + live object counts (performance budget at a glance)
      const i = g.renderer.info;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      this.fpsEl.textContent = [
        `${this.fps.toFixed(0)} fps (min ${this.minFps.toFixed(0)}) · ${g.quality}${g.settings.battery ? ' · 30fps cap' : ''}`,
        `${i.render.calls} draw calls · ${fmt(i.render.triangles)} tris · ${i.memory.geometries} geo · ${i.memory.textures} tex${mem ? ` · JS ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}`,
        `enemies ${g.enemies.filter((e) => e.alive).length} · survivors ${g.survivors.list.length} · workers ${g.workers.length} · particles ${g.fx.particleCount} · ground items ${g.pickups.list.length} · batched ${BATCH.instances} in ${BATCH.drawCalls} calls`,
      ].join('\n');
    }
    this.minFps = this.fps;
    if (this.info) this.info.textContent = txt;
  }

  // ------------------------------------------------------------------ default commands
  private registerDefaults() {
    const g = this.game;
    const toast = (text: string) => events.emit('toast', { text, color: '#c9b3ff' });

    // resources
    for (const n of [1000, 10000, 100000]) this.add('Resources', `+$${fmt(n)}`, () => g.eco.add('money', n));
    this.add('Resources', '+100 gold', () => g.eco.add('gold', 100));
    this.add('Resources', '+50 every item (bank)', () => { for (const r of RESOURCES) if (r.kind === 'item') g.eco.add(r.id, 50); });
    for (const id of ['log', 'plank', 'meat', 'ore']) this.add('Resources', `Fill pack: ${id}`, () => { while (g.player.stack.space() > 0) g.player.stack.push(id); });
    this.add('Resources', 'Empty pack', () => g.player.stack.clear());

    // time
    for (const s of [1, 3, 10]) this.add('Time', `Speed x${s}`, () => { g.timeScale = s; }, () => g.timeScale === s);
    this.add('Time', '+60 s live', () => { for (let i = 0; i < 600; i++) g.update(0.1); });
    this.add('Time', 'Offline 10 min', () => { this.close(); g.offerOffline(600, true); });
    this.add('Time', 'Offline 1 h', () => { this.close(); g.offerOffline(3600, true); });
    this.add('Time', 'Offline 8 h', () => { this.close(); g.offerOffline(8 * 3600, true); });

    // combat
    this.add('Combat', 'Wave now', () => { g.waves.skipToWave(); this.close(); });
    this.add('Combat', 'Next wave = boss', () => { const e = BALANCE.waves.bossEvery; if (g.waves.state !== 'active') g.waves.wave = Math.ceil((g.waves.wave + 1) / e) * e - 1; g.waves.skipToWave(); this.close(); });
    this.add('Combat', 'Spawn boss here', () => { g.spawnEnemy('alpha', g.player.x + 8, g.player.z, 1, false); this.close(); });
    this.add('Combat', 'Kill all enemies', () => { for (const e of g.enemies) if (e.alive) e.hit(1e9, e.x, e.z, 'tower'); });
    this.add('Combat', 'God mode', () => { g.god = !g.god; }, () => g.god);
    this.add('Combat', 'Heal + repair', () => { g.player.hp = g.player.maxHp; g.palisade.repairAll(); });

    // world
    this.add('World', 'Build cheapest zone', () => {
      const z = g.zones.visible().sort((a, b) => a.cost - b.cost)[0];
      if (z) { g.zones.build(z.id); toast(`Built ${z.label}`); } else toast('No zone visible');
    });
    this.add('World', 'Show AI / stores', () => { g.debugOverlay = !g.debugOverlay; }, () => g.debugOverlay);
    this.add('World', 'Build all visible', () => { for (const z of g.zones.visible()) g.zones.build(z.id); });
    for (const [, c] of Object.entries(regionsData.chunks)) {
      if (c.id === 'camp') continue;
      this.add('Regions', `Open ${c.name}`, () => {
        const z = ZONES.find((q) => q.params?.opens === c.id);
        if (z && g.zones.states.has(z.id)) { for (const r of z.requires ?? []) if (!g.zones.built.has(r)) g.zones.build(r, true); g.zones.build(z.id); }
        else g.world.openRegion(c.id);
        g.zones.refresh();
        toast(`${c.name} (${biomeOfChunk(c.id).name}) open`);
      }, () => g.world.isOpen(c.id));
    }
    for (const b of BIOMES) {
      const chunk = Object.values(regionsData.chunks).find((c) => c.biome === b.id && c.id !== 'camp') ?? regionsData.chunks['0,0'];
      this.add('Teleport', `${b.order}. ${b.name}`, () => {
        const r = regionById(chunk.id);
        if (!r) return;
        if (!g.world.isOpen(r.id)) g.world.openRegion(r.id, true);
        const p = g.nav.nearestFree(r.cx * 56, r.cz * 56) ?? { x: r.cx * 56, z: r.cz * 56 };
        g.player.x = p.x; g.player.z = p.z;
        this.close();
      });
    }
    this.add('Teleport', 'Camp centre', () => { g.player.x = 0; g.player.z = 4; this.close(); });

    // save
    this.add('Save', 'Save now', () => { g.saver.save(); toast('Saved'); });
    this.add('Save', 'Export', () => { this.close(); g.hud.openSaveText('export'); });
    this.add('Save', 'Import', () => { this.close(); g.hud.openSaveText('import'); });
    this.add('Save', 'Reset progress', () => { if (confirm('Erase all progress?')) g.resetSave(); });

    // info
    this.add('Info', 'Performance stats', () => { this.showFps = !this.showFps; this.refreshInfo(); }, () => this.showFps);
    // benchmark scenarios (same as the automated perf runs)
    this.add('Benchmark', 'Big wave (45)', () => {
      const H = g.palisade.half;
      for (let k = 0; k < 45; k++) { const a = (k / 45) * Math.PI * 2; g.spawnEnemy(k % 3 ? 'bear' : 'wolf', Math.cos(a) * (H + 8), Math.sin(a) * (H + 8), 6, false); }
      g.waves.state = 'active'; this.close();
    });
    this.add('Benchmark', 'Max camp', () => {
      for (let k = 0; k < 80; k++) for (const z of g.zones.visible()) if (!z.id.startsWith('exp_c')) g.zones.build(z.id);
      g.survivors.populate(g.survivors.cap); this.close();
    });
    this.add('Info', 'Shadows', () => g.world.setShadows(!g.world.shadows), () => g.world.shadows);
  }
}
