// Headless 10-minute simulation of a Frostwood save: lumberjack trip lengths, logs/min into base stores, FPS.
// usage: node scripts/sim.mjs <dist/index.html> <save file (FWC:... export, JSON, or "none")> <out.json> [minutes=10] [prep.js]
// Needs Google Chrome (macOS path below). prep.js is evaluated in the page after loading (e.g. scripts/sim/camps.js founds
// camps with routes and workshops; scripts/sim/payback.js founds camps at distance 1-3 and reports what they cost).
// Report: lumberjack trips (base / camp), logs per minute into base stores, camp route deliveries, per-camp state,
// frame time (update + render) at the start and after the run. Used for the before/after numbers of every camp step.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [html, saveFile, out, minArg, prepFile] = process.argv.slice(2);
const minutes = Number(minArg ?? 10);
let save = null;
if (saveFile !== 'none') {
  const raw = readFileSync(saveFile, 'utf8').trim();
  const json = raw.startsWith('FWC:') ? new TextDecoder().decode(Uint8Array.from(atob(raw.slice(4)), (c) => c.charCodeAt(0))) : raw;
  save = JSON.parse(json);
  save.savedAt = Date.now(); // no offline popup
}
const prep = prepFile ? readFileSync(prepFile, 'utf8') : '';

const page = readFileSync(html);
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); }).listen(0);
const port = server.address().port;
const dbg = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'fw-'))}`,
  '--window-size=430,932', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(JSON.stringify(d.params.args).slice(0, 300)); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('fw-sim')) { sessionStorage.setItem('fw-sim', '1'); localStorage.clear(); const s = ${JSON.stringify(save ? JSON.stringify(save) : '')}; if (s) localStorage.setItem('frostwood-camp-save-v1', s); } } catch (e) {}` });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
for (let i = 0; i < 100; i++) { await sleep(200); if (await evaluate('!!window.game && !window.game.loading')) break; }
await sleep(1500);
const info0 = await evaluate(`(() => { const g = window.game; return { version: document.querySelector('.version')?.textContent ?? '', loadError: g.saver.loadError, workers: g.workers.length, lumberjacks: g.workers.filter((w) => w.kind === 'lumberjack').length, built: g.zones.built.size }; })()`);
if (prep) { console.log('prep:', await evaluate(prep)); const sv = await evaluate('window.__save || ""'); if (sv) writeFileSync(out + '.save', sv); }

// FPS: real frames for 8 s with the game running normally
const fps = async () => evaluate(`(() => { const g = window.game, gl = g.renderer.getContext(); const ms = [];
  for (let i = 0; i < 400; i++) { const t = performance.now(); g.update(1 / 60); g.renderer.render(g.scene, g.camera); gl.finish(); if (i >= 50) ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b); const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
  return { frameMs: Math.round(avg * 100) / 100, p95Ms: Math.round(ms[Math.floor(ms.length * 0.95)] * 100) / 100, fpsCapacity: Math.round(1000 / avg) }; })()`);
if (process.env.SHOT) { await sleep(2500); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(process.env.SHOT, Buffer.from(r.result.data, 'base64')); }
const fpsBefore = await fps();

const result = await evaluate(`(() => {
  const g = window.game;
  const minutes = ${minutes}, dt = 0.1, steps = Math.round(minutes * 60 / dt);
  const isCamp = (w) => !!w.camp;
  // logs lumberjacks drop into base stores vs camp stores (+ the felling crew straight into the lumber hut)
  let baseLogs = 0, campLogs = 0;
  const tp = g.transferToPort.bind(g);
  g.transferToPort = (stack, port) => {
    const w = g.workers.find((q) => q.stack === stack);
    if (w && w.kind === 'lumberjack' && port.store.type === 'log' && stack.has('log')) { if (port.id.startsWith('camp:')) campLogs++; else baseLogs++; }
    tp(stack, port);
  };
  const hut = g.port('lumber_in');
  if (hut) { const add = hut.store.add.bind(hut.store); hut.store.add = (n = 1) => { baseLogs += n; add(n); }; }
  const hook = () => {};
  const sentLogs = () => g.settlements ? [...g.settlements.camps.values()].reduce((n, c) => n + (c.sent.log ?? 0), 0) : 0;
  const sentAll = () => g.settlements ? [...g.settlements.camps.values()].reduce((n, c) => n + Object.values(c.sent).reduce((a, b) => a + b, 0), 0) : 0;
  const sent0 = sentLogs(), sentAll0 = sentAll(); if (g.settlements) for (const c of g.settlements.camps.values()) c.sent = {};
  const st = new Map(); const trips = { base: [], camp: [] };
  for (let i = 0; i < steps; i++) {
    g.update(dt);
    if (i % 50 === 0) hook();
    for (const w of g.workers) {
      if (w.kind !== 'lumberjack') continue;
      let s = st.get(w); if (!s) { s = { x: w.x, z: w.z, d: 0, size: w.stack.size, carried: 0 }; st.set(w, s); }
      const step = Math.hypot(w.x - s.x, w.z - s.z);
      if (step < 5) s.d += step; // ignore respawn teleports
      s.x = w.x; s.z = w.z;
      if (w.stack.size > s.size) s.carried = Math.max(s.carried, w.stack.size);
      if (s.size > 0 && w.stack.size === 0) { trips[isCamp(w) ? 'camp' : 'base'].push({ d: s.d, logs: s.carried }); s.d = 0; s.carried = 0; }
      s.size = w.stack.size;
    }
  }
  const sum = (a) => a.reduce((n, t) => n + t.d, 0);
  const stats = (a) => a.length ? { trips: a.length, avgM: Math.round(sum(a) / a.length), medianM: Math.round([...a].sort((x, y) => x.d - y.d)[Math.floor(a.length / 2)].d), maxM: Math.round(Math.max(...a.map((t) => t.d))), avgLogs: Math.round(a.reduce((n, t) => n + t.logs, 0) / a.length * 10) / 10 } : { trips: 0 };
  const lj = g.workers.filter((w) => w.kind === 'lumberjack');
  return {
    lumberjacks: { base: lj.filter((w) => !isCamp(w)).length, camp: lj.filter(isCamp).length },
    tripsBase: stats(trips.base), tripsCamp: stats(trips.camp),
    logsPerMinBase: Math.round(baseLogs / minutes * 10) / 10, logsPerMinCamp: Math.round(campLogs / minutes * 10) / 10,
    routeLogsPerMin: Math.round((sentLogs() - sent0) / minutes * 10) / 10, routeAllPerMin: Math.round((sentAll() - sentAll0) / minutes * 10) / 10,
    camps: g.settlements ? [...g.settlements.camps.values()].map((c) => ({ chunk: c.chunk, lv: c.level, route: c.route.tier, workers: g.settlements.workers(c.chunk).length, stock: JSON.stringify(g.settlements.items(c)), sent: c.sent, raid: c.lastRaid, damage: c.damage })) : [],
    money: Math.round(g.eco.get('money')), logPrice: g.up.logPrice, heat: Math.round(g.heat),
  };
})()`);
const fpsAfter = await fps();
const report = { errors, ...info0, ...result, fps: { start: fpsBefore, after10min: fpsAfter } };
console.log(JSON.stringify(report, null, 2));
writeFileSync(out, JSON.stringify(report, null, 2));
ws.close(); chrome.kill(); server.close();
process.exit(0);
