import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { UPGRADES, type UpgradeTab } from '../config/upgrades';
import { regionById } from '../config/layout';
import { RESOURCES, BIOMES, res } from '../config/content';
import { PRODUCER_UPGRADES, type Producer } from '../buildings/producer';
import { BALANCE as B } from '../config/balance';
import type { Cost } from '../systems/economy';
import { ICONS } from './icons';
import { events } from '../core/events';
import { fmt, fmtTime } from '../core/math';
import type { Game } from '../game';

/** Hand-drawn SVG icon if there is one, else the resource emoji. */
const resIcon = (id: string) => {
  const d = res(id);
  const svg = d.svg ? (ICONS as Record<string, string>)[d.svg] : undefined;
  return svg ? `<span class="ico">${svg}</span>` : `<span class="ico emoji">${d.icon}</span>`;
};

const costHtml = (cost: Cost) => Object.entries(cost).map(([k, n]) => `${resIcon(k)}${fmt(n)}`).join(' ');

const recipeText = (p: Producer) => {
  const side = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `${n}${res(k).icon}`).join('+');
  return `${side(p.recipe.in)} → ${side(p.recipe.out)} · ${(p.recipe.seconds / p.speed).toFixed(1)}s · ×${p.slots}`;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** UIManager — HUD, menus, banners, edge arrows, tutorial caption. Pure DOM over the canvas. */
export class HUD {
  readonly root: HTMLElement;
  private res = new Map<string, { box: HTMLElement; num: HTMLElement; shown: number; target: number }>();
  private resBox!: HTMLElement;
  private hudBiome = '';
  private waveLabel!: HTMLElement;
  private timerLabel!: HTMLElement;
  private heatFill!: HTMLElement;
  private heatBox!: HTMLElement;
  private moodRow!: HTMLElement;
  private moodFill!: HTMLElement;
  private popLabel!: HTMLElement;
  private banner!: HTMLElement;
  private toasts!: HTMLElement;
  private arrows: HTMLElement[] = [];
  private tutorial!: HTMLElement;
  private tutPointer!: HTMLElement;
  private hand!: HTMLElement;
  private boostBtn!: HTMLButtonElement;
  private repairBtn!: HTMLButtonElement;
  private upgradeBtn!: HTMLButtonElement;
  private modal: HTMLElement | null = null;
  private upgradeTab: UpgradeTab | 'production' = 'player';
  private bannerT = 0;
  private stageLabel!: HTMLElement;
  private v = new THREE.Vector3();

  constructor(private game: Game, parent: HTMLElement) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    this.buildTopLeft();
    this.buildResources();
    this.buildButtons();
    this.banner = el('div', 'banner');
    this.toasts = el('div', 'toasts');
    this.tutorial = el('div', 'tut-caption');
    this.tutPointer = el('div', 'tut-pointer', '➤');
    this.hand = el('div', 'swipe-hint', `<div class="hand">${ICONS.hand}</div><div class="swipe-text">Swipe to move</div>`);
    this.root.append(this.banner, this.toasts, this.tutorial, this.tutPointer, this.hand);
    for (let i = 0; i < 4; i++) { const a = el('div', 'edge-arrow', '▲'); this.arrows.push(a); this.root.appendChild(a); }
    this.bind();
  }

  // ------------------------------------------------------------------ build
  private buildTopLeft() {
    const box = el('div', 'panel tl');
    this.waveLabel = el('div', 'wave-label', 'Day 1');
    this.timerLabel = el('div', 'timer-label', '');
    this.heatBox = el('div', 'meter heat', `<span class="ico">${ICONS.flame}</span><div class="track"><i></i></div>`);
    this.heatFill = this.heatBox.querySelector('i')!;
    this.moodRow = el('div', 'meter mood', `<span class="ico">${ICONS.smile}</span><div class="track"><i></i></div>`);
    this.moodFill = this.moodRow.querySelector('i')!;
    this.moodRow.style.display = 'none';
    this.popLabel = el('div', 'pop-label', '');
    this.stageLabel = el('div', 'stage-label', '');
    box.append(this.waveLabel, this.timerLabel, this.heatBox, this.moodRow, this.popLabel, this.stageLabel);
    this.root.appendChild(box);
  }

  private buildResources() {
    this.resBox = el('div', 'resources');
    this.root.appendChild(this.resBox);
  }

  /** The HUD shows only the 4–5 resources of the biome the player is in; the rest live in the inventory. */
  private setHudResources(ids: string[]) {
    this.resBox.innerHTML = '';
    this.res.clear();
    for (const id of ids) {
      const row = el('div', `res res-${id}`, `${resIcon(id)}<span class="num">0</span>`);
      this.resBox.appendChild(row);
      const v = this.game.resValue(id);
      this.res.set(id, { box: row, num: row.querySelector('.num')!, shown: v, target: v });
      row.querySelector('.num')!.textContent = fmt(v);
    }
    const inv = el('button', 'btn inv-btn', '📦') as HTMLButtonElement;
    inv.onclick = () => this.openInventory();
    inv.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.resBox.appendChild(inv);
  }

  private buildButtons() {
    const left = el('div', 'btn-col left');
    this.upgradeBtn = el('button', 'btn round', `${ICONS.hammer}<span>Upgrade</span>`) as HTMLButtonElement;
    this.upgradeBtn.onclick = () => this.openUpgrades();
    const shop = el('button', 'btn round small', `${ICONS.shop}<span>Shop</span>`) as HTMLButtonElement;
    shop.onclick = () => this.openShop();
    const gear = el('button', 'btn round small', `${ICONS.gear}<span>Menu</span>`) as HTMLButtonElement;
    gear.onclick = () => this.openSettings();
    left.append(this.upgradeBtn, shop, gear);
    const right = el('div', 'btn-col right');
    this.boostBtn = el('button', 'btn round ad', `${ICONS.video}<span>x2 $</span>`) as HTMLButtonElement;
    this.boostBtn.onclick = () => this.game.rewardDoubleIncome();
    this.repairBtn = el('button', 'btn round ad', `${ICONS.shield}<span>Repair</span>`) as HTMLButtonElement;
    this.repairBtn.onclick = () => this.game.rewardRepair();
    right.append(this.boostBtn, this.repairBtn);
    for (const b of [this.upgradeBtn, shop, gear, this.boostBtn, this.repairBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.append(left, right);
  }

  private bind() {
    events.on('res:changed', ({ id, delta }) => {
      const r = this.res.get(id);
      if (r && delta > 0) { r.box.classList.remove('bump'); void r.box.offsetWidth; r.box.classList.add('bump'); }
    });
    events.on('wave:warning', ({ boss }) => this.showBanner(boss ? '⚠ ALPHA BEAR INCOMING! ⚠' : 'Bears incoming!', 'danger'));
    events.on('wave:start', ({ wave }) => this.showBanner(`Wave ${wave}!`, 'danger'));
    events.on('wave:end', () => this.showBanner('Wave cleared!', 'good'));
    events.on('heat:empty', () => this.toast('The fire is out! Survivors are freezing ❄️', '#7fd3ff'));
    events.on('survivor:left', ({ reason }) => this.toast(reason === 'cold' ? 'A survivor left the cold camp…' : 'A survivor fled!', '#ffb4a8'));
    events.on('survivor:arrived', () => this.toast('New survivor arrived!', '#b8f5a8'));
    events.on('region:opened', ({ id }) => this.showBanner(`New land: ${regionById(id)?.name ?? id}!`, 'good'));
    events.on('stage:changed', ({ name }) => this.showBanner(`Stage: ${name}`, 'good'));
    events.on('player:ko', () => this.showBanner('You passed out!', 'danger'));
    events.on('toast', ({ text, color }) => this.toast(text, color));
    events.on('stack:full', () => this.toast('Backpack full!', '#ffe27a'));
  }

  showBanner(text: string, kind: 'danger' | 'good' = 'good') {
    this.banner.textContent = text;
    this.banner.className = `banner show ${kind}`;
    this.bannerT = 2.4;
  }

  toast(text: string, color = '#fff') {
    const t = el('div', 'toast', text);
    t.style.color = color;
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
    while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
  }

  setSwipeHint(on: boolean) { this.hand.style.display = on ? '' : 'none'; }

  setTutorial(text: string | null) {
    this.tutorial.style.display = text ? '' : 'none';
    if (text && this.tutorial.textContent !== text) {
      this.tutorial.textContent = text;
      this.tutorial.classList.remove('pop'); void this.tutorial.offsetWidth; this.tutorial.classList.add('pop');
    }
  }

  /** Points at an off-screen target from the screen edge. */
  setTutorialPointer(target: THREE.Vector3 | null) {
    if (!target) { this.tutPointer.style.display = 'none'; return; }
    const p = this.game.labels.project(target);
    const W = window.innerWidth, H = window.innerHeight;
    if (p && p.x > 30 && p.x < W - 30 && p.y > 140 && p.y < H - 60) { this.tutPointer.style.display = 'none'; return; }
    this.edgePlace(this.tutPointer, target, 46);
  }

  private edgePlace(e: HTMLElement, world: THREE.Vector3, margin: number) {
    const W = window.innerWidth, H = window.innerHeight;
    this.v.copy(world).project(this.game.camera);
    let dx = this.v.x, dy = -this.v.y;
    if (this.v.z > 1) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx);
    const cx = W / 2, cy = H / 2;
    const k = Math.min((W / 2 - margin) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - margin - 40) / Math.abs(Math.sin(ang) || 1e-6));
    e.style.display = '';
    e.style.transform = `translate(${cx + Math.cos(ang) * k}px, ${cy + Math.sin(ang) * k}px) translate(-50%, -50%) rotate(${ang + Math.PI / 2}rad)`;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const g = this.game;
    // animated counters (HUD set follows the biome the player is in)
    const bio = g.currentBiome;
    if (bio.id !== this.hudBiome) { this.hudBiome = bio.id; this.setHudResources(bio.hud); }
    for (const [id, r] of this.res) {
      const t = g.resValue(id);
      if (t > r.target && res(id).kind !== 'currency') { r.box.classList.remove('bump'); void r.box.offsetWidth; r.box.classList.add('bump'); }
      r.target = t;
      if (r.shown !== r.target) {
        const diff = r.target - r.shown;
        r.shown = Math.abs(diff) < 1 ? r.target : r.shown + diff * Math.min(1, dt * 12);
        r.num.textContent = fmt(Math.round(r.shown));
      }
    }
    // wave / timer
    const w = g.waves;
    this.waveLabel.textContent = `Day ${w.day} · Wave ${w.wave + (w.state === 'active' ? 0 : 1)}`;
    if (w.state === 'active') { this.timerLabel.innerHTML = `<span class="danger">⚔ ${w.waveEnemies} left</span>`; }
    else this.timerLabel.innerHTML = `${w.nextIsBoss ? '<span class="danger">BOSS</span> ' : ''}Next wave <b>${fmtTime(w.timer)}</b>`;
    const h01 = g.heat / BALANCE.furnace.maxHeat;
    this.heatFill.style.width = `${h01 * 100}%`;
    this.heatBox.classList.toggle('low', h01 < 0.25);
    if (g.diner) {
      this.moodRow.style.display = '';
      this.moodFill.style.width = `${g.survivors.mood * 100}%`;
    }
    this.popLabel.innerHTML = `<span class="ico">${ICONS.people}</span> ${g.survivors.count}/${g.survivors.cap}`;
    this.stageLabel.textContent = g.stageName;

    // ad buttons
    const adsOk = g.monetization.canShowAds(g.playTime) || g.monetization.adsRemoved;
    const boost = g.eco.doubleIncomeLeft;
    this.boostBtn.style.display = adsOk ? '' : 'none';
    this.boostBtn.querySelector('span')!.textContent = boost > 0 ? fmtTime(boost) : 'x2 $';
    this.boostBtn.classList.toggle('active', boost > 0);
    this.repairBtn.style.display = adsOk && g.palisade.damagedCount >= 3 ? '' : 'none';
    this.upgradeBtn.classList.toggle('glow', this.anyAffordable());

    // banner
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.classList.remove('show'); }

    // edge arrows towards incoming / off-screen enemies
    let ai = 0;
    if (w.state === 'warning') {
      this.edgePlace(this.arrows[ai++], new THREE.Vector3(w.spawnPoint.x, 0, w.spawnPoint.z), 34);
    } else if (w.state === 'active') {
      const dirs: THREE.Vector3[] = [];
      for (const e of g.enemies) {
        if (!e.alive || e.wild || ai + dirs.length >= 4) continue;
        const p = g.labels.project(e.root.position);
        if (p && p.on && p.x > 0 && p.x < window.innerWidth && p.y > 0 && p.y < window.innerHeight) continue;
        if (dirs.some((d) => d.distanceTo(e.root.position) < 10)) continue;
        dirs.push(e.root.position.clone());
      }
      for (const d of dirs) this.edgePlace(this.arrows[ai++], d, 34);
    }
    for (; ai < this.arrows.length; ai++) this.arrows[ai].style.display = 'none';

    if (this.modal?.dataset.kind === 'upgrades') this.refreshUpgradeList();
    if (this.modal?.dataset.kind === 'inventory') this.refreshInventory();
  }

  private anyAffordable() {
    const g = this.game;
    return UPGRADES.some((u) => (!u.requires || g.zones.built.has(u.requires)) && !g.up.maxed(u) && g.eco.get(u.currency) >= g.up.cost(u))
      || g.producers.some((p) => PRODUCER_UPGRADES.some((k) => !p.maxed(k) && g.affordable(p.upgradeCost(k))));
  }

  // ------------------------------------------------------------------ modals
  private openModal(kind: string, title: string, body: HTMLElement) {
    this.closeModal();
    const back = el('div', 'modal-back');
    back.dataset.kind = kind;
    const card = el('div', 'modal');
    const head = el('div', 'modal-head', `<span>${title}</span>`);
    const x = el('button', 'modal-x', '✕') as HTMLButtonElement;
    x.onclick = () => this.closeModal();
    head.appendChild(x);
    card.append(head, body);
    back.appendChild(card);
    back.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === back) this.closeModal(); });
    this.root.appendChild(back);
    this.modal = back;
    this.game.input.enabled = false;
    this.game.input.release();
  }

  closeModal() {
    this.modal?.remove();
    this.modal = null;
    this.game.input.enabled = true;
  }

  openUpgrades() {
    const body = el('div', 'upg');
    const tabs = el('div', 'tabs');
    const tabList: [UpgradeTab | 'production', string][] = [['player', 'Hero'], ['buildings', 'Camp'], ['workers', 'Workers']];
    if (this.game.producers.length) tabList.push(['production', 'Production']);
    for (const [id, name] of tabList) {
      const t = el('button', `tab ${id === this.upgradeTab ? 'on' : ''}`, name) as HTMLButtonElement;
      t.onclick = () => { this.upgradeTab = id; this.openUpgrades(); };
      tabs.appendChild(t);
    }
    const list = el('div', 'upg-list');
    body.append(tabs, list);
    this.openModal('upgrades', 'Upgrades', body);
    this.refreshUpgradeList(true);
  }

  private refreshUpgradeList(force = false) {
    const list = this.modal?.querySelector('.upg-list') as HTMLElement | null;
    if (!list) return;
    const g = this.game;
    if (this.upgradeTab === 'production') { this.refreshProductionList(list, force); return; }
    const items = UPGRADES.filter((u) => u.tab === this.upgradeTab);
    const sig = items.map((u) => `${u.id}:${g.up.lvl(u.id)}:${g.eco.get(u.currency) >= g.up.cost(u)}:${!u.requires || g.zones.built.has(u.requires)}`).join('|');
    if (!force && list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.innerHTML = '';
    for (const u of items) {
      const locked = u.requires && !g.zones.built.has(u.requires);
      const maxed = g.up.maxed(u);
      const cost = g.up.cost(u);
      const can = !locked && !maxed && g.eco.get(u.currency) >= cost;
      const row = el('div', `upg-row ${locked ? 'locked' : ''}`);
      row.innerHTML = `<div class="upg-info"><b>${u.name}</b> <span class="lvl">Lv ${g.up.lvl(u.id)}</span><small>${locked ? 'Unlocks later' : u.desc}</small></div>`;
      const b = el('button', `btn buy ${can ? '' : 'off'}`, maxed ? 'MAX' : `<span class="ico">${u.currency === 'gold' ? ICONS.gold : ICONS.money}</span>${fmt(cost)}`) as HTMLButtonElement;
      b.onclick = () => { if (g.up.buy(u.id)) { g.haptic('medium'); this.refreshUpgradeList(true); } };
      row.appendChild(b);
      list.appendChild(row);
    }
  }

  /** Per-building upgrades for every production chain: speed, storage, parallel jobs. */
  private refreshProductionList(list: HTMLElement, force: boolean) {
    const g = this.game;
    const ps = g.producers;
    const sig = ps.map((p) => PRODUCER_UPGRADES.map((k) => `${p.levels[k]}:${g.affordable(p.upgradeCost(k))}`).join(',')).join('|');
    if (!force && list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.innerHTML = '';
    for (const p of ps) {
      list.appendChild(el('div', 'upg-head', `${res(p.outRes).icon} ${p.def.label} <small>${recipeText(p)}</small>`));
      for (const k of PRODUCER_UPGRADES) {
        const U = B.producers.upgrades[k];
        const cost = p.upgradeCost(k);
        const maxed = p.maxed(k);
        const can = !maxed && g.affordable(cost);
        const row = el('div', 'upg-row', `<div class="upg-info"><b>${U.name}</b> <span class="lvl">Lv ${p.levels[k]}</span><small>${U.desc}</small></div>`);
        const b = el('button', `btn buy ${can ? '' : 'off'}`, maxed ? 'MAX' : costHtml(cost)) as HTMLButtonElement;
        b.onclick = () => { if (p.buyUpgrade(k)) { g.haptic('medium'); this.refreshUpgradeList(true); } };
        row.appendChild(b);
        list.appendChild(row);
      }
    }
  }

  /** Every resource the camp owns, grouped by biome (scrolls — there will be many). */
  openInventory() {
    const body = el('div', 'inv');
    this.openModal('inventory', 'Inventory', body);
    this.refreshInventory(true);
  }

  private refreshInventory(force = false) {
    const body = this.modal?.querySelector('.inv') as HTMLElement | null;
    if (!body) return;
    const g = this.game;
    const rows = RESOURCES.filter((r) => r.kind !== 'derived').map((r) => ({ r, total: g.resValue(r.id), bank: g.eco.get(r.id), carried: g.player.stack.count(r.id) }));
    const sig = rows.map((x) => `${x.total}:${x.bank}:${x.carried}`).join('|');
    if (!force && body.dataset.sig === sig) return;
    body.dataset.sig = sig;
    body.innerHTML = '';
    for (const b of BIOMES) {
      const items = rows.filter((x) => x.r.biome === b.id && (x.total > 0 || b.available));
      if (!items.length) continue;
      body.appendChild(el('div', 'upg-head', `${b.order}. ${b.name}${b.available ? '' : ' <small>(coming)</small>'}`));
      for (const x of items) {
        const where = x.r.kind === 'currency' ? '' : `<small>🏦 ${fmt(x.bank)} · 🎒 ${x.carried} · 🏠 ${fmt(Math.max(0, x.total - x.bank - x.carried))}</small>`;
        body.appendChild(el('div', `inv-row ${x.total > 0 ? '' : 'empty'}`, `<span class="inv-ico">${resIcon(x.r.id)}</span><div class="upg-info"><b>${x.r.name}</b>${where}</div><span class="inv-num">${fmt(x.total)}</span>`));
      }
    }
  }

  openShop() {
    const g = this.game;
    const m = g.monetization;
    const body = el('div', 'shop');
    const item = (title: string, desc: string, price: string, owned: boolean, buy: () => void) => {
      const r = el('div', 'upg-row', `<div class="upg-info"><b>${title}</b><small>${desc}</small></div>`);
      const b = el('button', `btn buy ${owned ? 'off' : ''}`, owned ? 'Owned' : price) as HTMLButtonElement;
      if (!owned) b.onclick = buy;
      r.appendChild(b);
      body.appendChild(r);
    };
    item('Starter Pack', '+$1,000, +20 gold, Backpack +3 levels', m.iap.price('starter_pack'), m.starterPackBought, () => g.buyIAP('starter_pack').then(() => this.openShop()));
    item('Remove Ads', 'No ad videos — rewards are instant', m.iap.price('remove_ads'), m.adsRemoved, () => g.buyIAP('remove_ads').then(() => this.openShop()));
    body.appendChild(el('p', 'note', 'Store integration is a stub — no real payments are made.'));
    this.openModal('shop', 'Shop', body);
  }

  openSettings() {
    const g = this.game;
    const body = el('div', 'settings');
    const toggle = (label: string, on: boolean, set: (v: boolean) => void) => {
      const b = el('button', `btn wide ${on ? '' : 'off'}`, `${label}: ${on ? 'ON' : 'OFF'}`) as HTMLButtonElement;
      b.onclick = () => { set(!on); this.openSettings(); };
      body.appendChild(b);
    };
    toggle('Music', g.settings.music, (v) => g.setSetting('music', v));
    toggle('Sound', g.settings.sfx, (v) => g.setSetting('sfx', v));
    toggle('Vibration', g.settings.haptics, (v) => g.setSetting('haptics', v));
    const row = el('div', 'btn-row');
    const exp = el('button', 'btn wide', 'Export save') as HTMLButtonElement;
    exp.onclick = () => this.openSaveText('export');
    const imp = el('button', 'btn wide', 'Import save') as HTMLButtonElement;
    imp.onclick = () => this.openSaveText('import');
    row.append(exp, imp);
    body.appendChild(row);
    const stats = el('p', 'note', `Played ${fmtTime(g.playTime)} · Earned $${fmt(g.eco.totalEarned)} · Waves ${g.waves.wave}`);
    body.appendChild(stats);
    const reset = el('button', 'btn wide danger', 'Reset progress') as HTMLButtonElement;
    reset.onclick = () => { if (confirm('Erase all progress?')) g.resetSave(); };
    body.appendChild(reset);
    this.openModal('settings', 'Menu', body);
  }

  /** Export: copy the save text. Import: paste one and reload. Clipboard API with a textarea fallback (WKWebView). */
  openSaveText(mode: 'export' | 'import') {
    const g = this.game;
    const body = el('div', 'settings');
    const ta = el('textarea', 'save-text') as HTMLTextAreaElement;
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    body.appendChild(ta);
    const btn = el('button', 'btn wide', mode === 'export' ? 'Copy' : 'Load this save') as HTMLButtonElement;
    const note = el('p', 'note', '');
    if (mode === 'export') {
      ta.value = g.saver.exportString();
      ta.readOnly = true;
      btn.onclick = async () => {
        ta.select();
        let ok = false;
        try { await navigator.clipboard.writeText(ta.value); ok = true; } catch { ok = document.execCommand?.('copy') ?? false; }
        note.textContent = ok ? 'Copied! Keep it somewhere safe.' : 'Select the text and copy it manually.';
      };
    } else {
      ta.placeholder = 'Paste an exported save here';
      navigator.clipboard?.readText?.().then((t) => { if (t.startsWith('FWC:')) ta.value = t; }).catch(() => {});
      btn.onclick = () => {
        try { g.saver.importString(ta.value); location.reload(); } catch (e) { note.textContent = `Not a valid save: ${(e as Error).message}`; }
      };
    }
    body.append(btn, note);
    this.openModal('savetext', mode === 'export' ? 'Export save' : 'Import save', body);
  }

  showOffline(money: number, gold: number, seconds: number, lines: string[], onClaim: (double: boolean) => void) {
    const body = el('div', 'offline');
    const amount = money > 0 || gold > 0
      ? `<div class="offline-amount"><span class="ico">${ICONS.money}</span>+${fmt(money)}${gold > 0 ? ` &nbsp; <span class="ico">${ICONS.gold}</span>+${fmt(gold)}` : ''}</div>` : '';
    body.innerHTML = `<p>Your workers kept the camp running for <b>${fmtTime(seconds)}</b></p>${amount}
      ${lines.length ? `<div class="offline-report">${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}`;
    const row = el('div', 'btn-row');
    const claim = el('button', 'btn wide', 'Collect') as HTMLButtonElement;
    claim.onclick = () => { this.closeModal(); onClaim(false); };
    row.appendChild(claim);
    if (this.game.monetization.enabled) {
      const dbl = el('button', 'btn wide ad', `${ICONS.video} x2`) as HTMLButtonElement;
      dbl.onclick = async () => { this.closeModal(); onClaim(await this.game.monetization.rewarded('double_offline')); };
      row.appendChild(dbl);
    }
    body.appendChild(row);
    this.openModal('offline', 'While you were away', body);
  }
}
