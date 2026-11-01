import { PRODUCERS, RECIPES, res } from '../config/content';
import { TRAITS, WORKSHOPS } from '../config/settlements';
import type { Game } from '../game';

/** Raw resources and the worker / source that brings them (measured live, with a fallback per minute). */
const RAW: Record<string, { who: string; perWorker: number }> = {
  log: { who: 'lumberjack', perWorker: 14 }, meat: { who: 'hunter', perWorker: 10 }, fish: { who: 'fisher', perWorker: 18 },
  ore: { who: 'miner', perWorker: 28 }, hide: { who: 'hunter', perWorker: 2 }, herb: { who: 'hunter', perWorker: 1 }, gold: { who: 'smelter', perWorker: 0 },
};

/**
 * Chain calculator: to make `rate` units of `product` per minute, how many production buildings
 * (at their current upgrades) and how many gatherers are needed, all the way down to raw resources.
 */
export function chainCalc(g: Game, product: string, rate: number): string[] {
  const lines: string[] = [];
  const measured = (r: string) => {
    const info = RAW[r];
    if (!info) return 0;
    const n = g.workers.filter((w) => w.kind === info.who).length;
    const made = g.flows.rates().get(r)?.get(info.who) ?? 0;
    return n && made > 0 ? made / n : info.perWorker;
  };
  const walk = (id: string, perMin: number, depth: number) => {
    const pad = '  '.repeat(depth);
    const key = Object.keys(PRODUCERS).find((k) => Object.keys(RECIPES[PRODUCERS[k].recipe]?.out ?? {})[0] === id);
    // camp workshops (tar kiln, camp sawmill) and camp gatherers / fellers
    const ws = !key ? Object.values(WORKSHOPS).find((w) => w.recipes?.some((r) => r.out[id])) : undefined;
    if (ws && depth < 4) {
      const r = ws.recipes!.find((q) => q.out[id])!;
      const per = (60 * r.out[id]) / r.seconds;
      lines.push(`${pad}${res(id).icon} ${res(id).name}: ${perMin.toFixed(1)}/min → ${Math.ceil(perMin / per)} × ${ws.name} in camps (${per.toFixed(0)}/min each, base speed)`);
      for (const [k, n] of Object.entries(r.in)) walk(k, (perMin / r.out[id]) * n, depth + 1);
      return;
    }
    const gather = !key && !RAW[id] ? Object.values(TRAITS).filter((t) => t.gather[id] || t.fell?.[id]) : [];
    if (gather.length) {
      const hut = Object.values(WORKSHOPS).find((w) => w.gather)!;
      const best = gather.map((t) => ({ t, share: (t.gather[id] ?? 0) / Object.values(t.gather).reduce((a, b) => a + b, 0) })).sort((a, b) => b.share - a.share)[0];
      const fell = gather.find((t) => t.fell?.[id]);
      const parts: string[] = [];
      if (best.share > 0) { const per = hut.gather! * best.share; parts.push(`~${Math.ceil(perMin / per)} × ${hut.name} in ${best.t.name} (≈${per.toFixed(1)}/min each)`); }
      if (fell) parts.push(`${fell.fell![id]} per tree felled by camp lumberjacks in ${fell.name}`);
      lines.push(`${pad}${res(id).icon} ${res(id).name}: ${perMin.toFixed(1)}/min → ${parts.join(' or ')}`);
      return;
    }
    if (!key) {
      const info = RAW[id];
      if (info && info.perWorker > 0) {
        const per = measured(id);
        lines.push(`${pad}${res(id).icon} ${res(id).name}: ${perMin.toFixed(1)}/min → ~${Math.ceil(perMin / per)} ${info.who}s (≈${per.toFixed(1)}/min each)`);
      } else lines.push(`${pad}${res(id).icon} ${res(id).name}: ${perMin.toFixed(1)}/min (raw)`);
      return;
    }
    const spec = PRODUCERS[key], rec = RECIPES[spec.recipe];
    const built = g.producers.filter((p) => p.def.params?.producer === key);
    const sample = built[0];
    const slots = sample ? sample.slots : 1, speed = sample ? sample.speed : 1;
    const outQty = Object.values(rec.out)[0];
    const perBuilding = (slots * 60 * outQty) / (rec.seconds / speed);
    const need = Math.ceil(perMin / perBuilding);
    lines.push(`${pad}${res(id).icon} ${res(id).name}: ${perMin.toFixed(1)}/min → ${need} × ${spec.name} (${perBuilding.toFixed(0)}/min each${sample ? ', current upgrades' : ', no upgrades'}; you have ${built.length})`);
    if (depth < 4) for (const [r, n] of Object.entries(rec.in)) walk(r, (perMin / outQty) * n, depth + 1);
  };
  walk(product, rate, 0);
  return lines;
}

/** Products the calculator offers (every producer output). */
export const CHAIN_PRODUCTS = [...new Set([...Object.values(PRODUCERS).map((p) => Object.keys(RECIPES[p.recipe]?.out ?? {})[0]), 'tarPlank', 'torch'].filter(Boolean))];
