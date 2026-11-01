(() => { const g = window.game, S = g.settlements;
  for (const r of ['c1_1', 'c2_1']) if (!g.world.isOpen(r)) g.world.openRegion(r, true);
  g.zones.refresh();
  g.eco.add('plank', 300);
  const out = { logPrice: g.up.logPrice, camps: {} };
  for (const chunk of ['east', 'c1_1', 'c2_1']) {
    let money = 0; const items = {};
    for (const p of ['fire', 'depot', 'hut', 'tower']) {
      const id = `camp:${chunk}:${p}`; const st = g.zones.states.get(id); if (!st) continue;
      money += st.def.cost; for (const [k, n] of Object.entries(st.def.items ?? {})) items[k] = (items[k] ?? 0) + n;
      g.zones.build(id);
    }
    const c = S.camp(chunk); if (!c) continue;
    const rc = S.routeCost(c); money += rc.money; for (const [k, n] of Object.entries(rc)) if (k !== 'money') items[k] = (items[k] ?? 0) + n;
    S.buyRoute(c);
    out.camps[chunk] = { trait: c.trait?.name, money, items };
  }
  return out;
})()
