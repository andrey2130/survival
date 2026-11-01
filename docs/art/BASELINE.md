# Baseline — before the graphics overhaul (v1.9.2)

Reference shots: `docs/art/before/*.png` (clean, no HUD) and `*_hud.png`; montage `before/montage.png`.
Captured on the player's save (wave 98, all regions open, 45 workers), viewport 390×844 @2x,
quality High, script `refshots.mjs` (same 6 points every stage).

| Shot | FPS* | Draw calls | Triangles | Textures | Geometries | Texture mem | Shadow map |
|---|---|---|---|---|---|---|---|
| Base, day | 60 | 446 | 485k | 16 | 145 | 11.5 MB | 16 MB (2048²) |
| Base, night | 60 | 451 | 497k | 17 | 149 | 11.6 MB | 16 MB |
| Forest | 60 | 278 | 490k | 21 | 167 | 11.6 MB | 16 MB |
| Mine | 60 | 307 | 459k | 22 | 186 | 11.6 MB | 16 MB |
| Lake | 60 | 219 | 433k | 23 | 202 | 11.6 MB | 16 MB |
| Wave fight | 60 | 347 | 446k | 25 | 207 | 11.6 MB | 16 MB |

\* Desktop Chrome on Mac, vsync-capped. 4× CPU throttle on the same save: 59 FPS, 1 long frame / 5 s.

Download: `dist/index.html` 930 KB (254 KB gzip) — everything in one file, no external assets.
