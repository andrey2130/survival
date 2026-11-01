# Roadmap

## Status of the progression / outposts / trade plan (checked against the code, v1.11.0)
The original big prompt isn't stored in the repo, so this list covers the parts named since then and what the
code actually contains.

**Done**
- Furnace Level 1–30 (`furnace` upgrade) replaces Furnace Bellows + Great Furnace; old levels migrate (save v3).
  It is the base's level: camp levels are capped by it (`data/settlements.json`).
- Settlement tiers in one config: base / outpost / camp (`data/settlements.json`, `systems/settlements.ts`).
- Camps in opened forest locations (v1.11.0): Found Camp (camp fire), Forest Depot, Woodcutters' Hut (2 camp
  lumberjacks), Watchtower. Camp lumberjacks chop only in their location and drop logs at the depot (~20 m trips).
- World map: chunk grid by biome, base, hero, next story region, camps with level and fire state.
- Trade: Market (sells Warehouse goods with per-good sell / keep settings), Trading Post (rotating barter
  deals), Fish Trader (smoked fish), wood and meat stalls, market price floors for processed wood.
- Save v3 keeps an automatic copy of the v2 save; Menu → "Restore save from before the update".

**Partly done**
- Outposts: the `outpost` tier exists in the config (max level 15, capped by the base) but there are no outposts
  in the game yet — no buildings, defence or routes. Camp routes will lead to the base until they exist.
- Logistics screen: reserves and priorities for the base only; no tab per settlement yet.

**Not done yet**
- Camps, step 3: camp → base routes (cart/sled → road + sled team → log drive / conveyor), what to haul and
  what to keep, route throughput upgrades, assigning existing workers to a camp (and auto-assignment), Logistics
  tab per settlement. Until then camp logs stay in the depot (the hero can carry them).
- Camps, step 4: production buildings (sawmill, tree nursery, hunting lodge, gatherers' hut, tar kiln) and the
  character of every location (Old Pine Forest, Birch Grove, Burnt Woods, Frozen Bog, Hunting Grounds).
- Camps, step 5: camp levels 2–10 (upgrade costs from the base + the location), specialisation, visuals
  (tents → cabins → palisade).
- Camps, step 6: new goods (berries, mushrooms, resin, birch bark, birch sap, peat, cranberries, torches, tarred
  planks) in trade and recipes.
- Camps, step 7: bears / wolves attacking camps while the hero is away (damage + lost depot goods, alert and
  arrow), balance (payback 10–20 min), camps in the progression simulation and the chain calculator.
- Furnace Level as the gate for every building's level, and requirements for raising the Furnace Level.
- Outpost content: buildings, own level 1–15, defence, routes to the base.

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
