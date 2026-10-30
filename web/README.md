# Frostwood Camp

A winter-survival idle arcade game built with Three.js, TypeScript, and Vite. It ships inside the iOS app (`../survival.xcodeproj`) as a single bundled `game.html`, loaded by a WKWebView.

## Commands
- `npm run dev`: dev server (open on your phone via the LAN URL). WASD/arrows work on desktop.
- `npm run build`: typecheck, build `dist/index.html`, and copy it to `../survival/game.html`. Rebuild the Xcode app afterwards.

Debug URL params: `?debug` (+$20k, +300 gold), `?speed=3` (time scale), `?wave` (first wave in 8 s). `window.game` is exposed for testing.

## Where things live
- `src/config/balance.ts`: every gameplay number.
- `src/config/layout.ts`: regions and all purchase zones/buildings (data-driven).
- `src/config/upgrades.ts`: upgrade list (cost = base * 1.15^level).
- `src/core/`: event bus, pools, joystick, synthesized audio, save, native bridge, ads/IAP stubs.
- `src/world/`: procedural low-poly models, terrain/fog/snow, trees (instanced), palisade, A* nav grid.
- `src/entities/`: player, resource stack, enemies, survivors, workers.
- `src/buildings/`: furnace, stall, kitchen, canteen, towers, mine, rails, smelter, cart.
- `src/systems/`: economy, upgrades, waves, survivors, zones, pickups, tutorial, FX.
- `src/ui/`: HUD, world labels, bubbles, CSS.

To plug in real ads or IAP, implement `AdsProvider` and `IAPProvider` in `src/core/monetization.ts`.
