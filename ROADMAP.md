# Roadmap

## Status of the progression / outposts / trade plan (checked against the code, v1.16.0)
The original big prompt isn't stored in the repo, so this list covers the parts named since then and what the
code actually contains.

**Done**
- Furnace Level 1–30 (`furnace` upgrade) replaces Furnace Bellows + Great Furnace; old levels migrate (save v3).
  It is the base's level: camp levels are capped by it.
- One settlement system in config: base / outpost / camp (`data/settlements.json`, `systems/settlements.ts`).
- Camps in every opened forest location (v1.11–1.16): Found Camp (fire), Forest Depot, Woodcutters' Hut,
  Watchtower; sled routes to the base (sled → road + reindeer team → log flume) with throughput levels and
  per-item send/keep rules; workers assigned per camp (+ auto-move of lumberjacks with long trips); workshops in
  slots (sawmill, nursery, hunting lodge, gatherers' hut, tar kiln); location traits (Old Pine Forest, Birch Grove,
  Burnt Woods, Frozen Bog, Hunting Grounds); levels 1–10 with costs from the base and the location;
  specialisation; tents → cabins → palisade; raids while the hero is away (damage, lost goods, alert and arrow).
- New goods: berries, mushrooms, cranberries, birch sap/bark, peat, resin, torches, tarred planks, berry pie;
  Forest Pantry, Apothecary, tarred-plank wall repair, peat as fuel, market and barter deals.
- World map: biomes, base, hero, next story region, location traits, camps with level and fire state.
- Trade: Market (per-good sell / keep), Trading Post (rotating barter deals), Fish Trader, stalls.
- Save v3 keeps an automatic copy of the v2 save; Menu → "Restore save from before the update".
- Headless simulation: `npm run sim` (scripts/sim.mjs, scenarios in scripts/sim/).

**Partly done**
- Outposts: the `outpost` tier exists in the config (max level 15, capped by the base) but there are no outposts
  in the game yet; camp routes lead to the base.
- Logistics tabs per camp have workers, stock, route and haul rules; base-style reserves/priorities inside a camp
  are just "keep N of each good" plus the fire before the depot.
- Chain calculator knows camp sources (gatherers, felling bonuses, tar kiln) at base speed, not per camp upgrades.

**Not done yet**
- Offline progress for camps (camps and routes only work while the game runs).
- Furnace Level as the gate for every building's level, and requirements for raising the Furnace Level.
- Outpost content: buildings, own level 1–15, defence, routes; camps → outpost routes.
- Conveyors (only the log flume exists as the third route tier).

## Logistics 2.0 (from v1.9)
Resource **priorities and reserves exist** (furnace → food → stall share → wall repair → industry →
market/trade, Warehouse reserves, emergency mode), workers have **fixed roles**, and some goods move abstractly.
Still missing:

- **Logistics hubs** for the base districts (east / west / north / lake). Camps now give forest locations their
  own depot; the base districts still don't have one.
- **Conveyors / carts between hubs** with capacity and speed upgrades (camp routes, step 3, will be the first).
- **Adjacency bonuses**: buildings next to each other work faster.
- **Worker task priorities**: a job board with priorities per task type and per worker, task reservation,
  chained tasks so carriers never walk empty, a per-district job radius.
- **Reservation of items on the ground** so two workers never run for the same piece of meat.
