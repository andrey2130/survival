(() => { const g = window.game, S = g.settlements;
  g.eco.add('plank', 400);
  const plan = { east: 'lodge', west: 'gather', south: 'sawmill', c1_1: null, 'c-1_1': 'gather' };
  for (const chunk of Object.keys(plan)) for (const p of ['fire', 'depot', 'hut', 'tower']) { const id = `camp:${chunk}:${p}`; if (g.zones.states.has(id)) g.zones.build(id); }
  const out = {};
  for (const [chunk, w] of Object.entries(plan)) { const c = S.camp(chunk); if (!c) { out[chunk] = 'no camp'; continue; } S.buyRoute(c); S.add(c, 'log', 60); out[chunk] = `${c.trait?.name} ws:${w ? S.buildWorkshop(c, w) : '-'}`; }
  for (let i = 0; i < 1800; i++) g.update(0.1);
  S.autoOn = true; out.moved = S.autoDistribute(); out.err = g.contentErrors;
  return out;
})()
