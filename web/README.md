# Frostwood Camp

A winter-survival idle arcade game built with Three.js, TypeScript, and Vite. It ships inside the iOS app (`../survival.xcodeproj`) as a single bundled `game.html`, loaded by a WKWebView.

## Commands
- `npm run dev`: dev server (open on your phone via the LAN URL). WASD/arrows work on desktop.
- `npm run build`: typecheck, build `dist/index.html`, and copy it to `../survival/game.html`. Rebuild the Xcode app afterwards.

Debug: **triple-tap any screen corner** (or press `` ` ``) to open the debug panel — add resources, change speed, simulate offline time, call waves/bosses, open regions, teleport, export/import saves. URL params: `?debug` (+$20k, +300 gold, +50 planks, a 🐞 button), `?speed=3` (time scale), `?wave` (first wave in 8 s). `window.game` is exposed for testing.

## Content (JSON, no code needed)
- `src/data/balance.json`: every number — prices, timers, HP, damage, recipes, and a separate `growth` per system (cost = base * growth^level).
- `src/data/resources.json`: resources (currency / carried item / HUD-derived). Items without a hand-made model get one generated from `shape` + `color`.
- `src/data/regions.json`: the biome chain (resources, HUD set, enemies, boss) and the named map chunks. Chunks of a biome with `available: false` stay locked.
- `src/data/producers.json`: production buildings (input stores -> timed jobs -> output store, optional fuel / tending). Recipes are in `balance.json -> recipes`.
- `src/data/zones.json`: every purchase zone. `cost`+`currency` is paid by standing on it; `items` are paid from the backpack, then the Warehouse bank.
- `src/data/upgrades.json`: upgrade list.
- `src/config/content.ts` validates all cross-references at boot (errors appear in the console and the debug panel).

Saves are versioned (`SAVE_VERSION` in `src/core/save.ts`): add a migration from the previous version whenever the save layout changes. The pre-migration save is kept in localStorage (`frostwood-camp-save-backup-v<N>`).

## Where things live
- `src/config/`: typed loaders for the JSON content, layout helpers (chunks, stall spots).
- `src/core/`: event bus, pools, joystick, synthesized audio, save, native bridge, ads/IAP stubs.
- `src/world/`: procedural low-poly models, terrain/fog/snow, trees (instanced), palisade, A* nav grid.
- `src/entities/`: player, resource stack, enemies, survivors, workers.
- `src/buildings/`: furnace, stalls, canteen, towers, mine, rails, cart, and the generic `Producer` (kitchen, smelter, sawmill) + `Warehouse`.
- `src/systems/`: economy, upgrades, waves, survivors, zones, pickups, tutorial, FX.
- `src/ui/`: HUD (biome resources, inventory, upgrades, offline report), debug panel, world labels, bubbles, CSS.

To plug in real ads or IAP, implement `AdsProvider` and `IAPProvider` in `src/core/monetization.ts`.
