# Roadmap

## Next stage: logistics 2.0 (not implemented yet)
Honest status after v1.9: resource **priorities and reserves exist** (furnace → food → stall share →
wall repair → industry → market/trade, Warehouse reserves, emergency mode), workers have **fixed roles**
(assigned per person), and some goods move abstractly (farm meat and kitchen food are dispatched,
workshops draw from the Warehouse). The following are **not** in the game yet:

- **Logistics hubs**: a small depot per district (east / west / north / lake). Gatherers drop at the
  nearest hub; carriers take jobs only inside their district → short trips (lumberjacks now walk
  250–2400 m per trip).
- **Conveyors / carts between hubs**: automatic transport lines between district hubs and the Warehouse
  (like the mine carts), with capacity and speed upgrades.
- **Adjacency bonuses**: buildings next to each other work faster (sawmill next to the lumber hut,
  tailor next to the hunters' lodge, kitchen next to the canteen...).
- **Worker task priorities**: a job board with priorities per task type and per worker (e.g. carrier
  1 = furnace, 2 = stall, 3 = industry), task reservation, chained tasks so carriers never walk empty,
  and a per-district job radius.
- **Reservation of items on the ground** so two workers never run for the same piece of meat.
