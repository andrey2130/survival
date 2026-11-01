# Stage 2 — lighting, tone mapping, HDRI, shadows, fog, LUT (v1.10.0)

`before_after.png`: top row v1.9.2, bottom row v1.10.0 (base day, base night, forest, mine, lake, wave).

## What changed
- PBR materials (MeshStandard) everywhere instead of toon / Lambert, so the HDRI lighting applies.
- Image-based lighting: CC0 winter-sky HDRI (day) and moonlit sky (night) through PMREM, 130 KB each.
- ACES tone mapping, exposure 0.75 (A/B against AgX and Neutral).
- Low winter sun (~35°) from the side: long shadows; soft PCF (radius 3 High / 2 Medium); bias retuned.
- Baked AO in vertex colours: buildings, rocks and trees darken towards the ground, eaves darker.
- Height fog: ground haze + aerial perspective, in one shared shader chunk.
- Colour grading: 32³ 3D LUT blended from day / evening / night / blizzard moods (blizzard ready for the weather stage).
- Camp ground: cold frozen brown instead of orange; lake ice is a glossy PBR sheet reflecting the sky.

## Metrics (player's save, 390×844, High)
| Shot | Draw calls before → after | Triangles before → after |
|---|---|---|
| Base day | 446 → 487 | 485k → 529k |
| Base night | 451 → 501 | 497k → 540k |
| Forest | 278 → 335 | 490k → 563k |
| Mine | 307 → 344 | 459k → 560k |
| Lake | 219 → 246 | 433k → 477k |
| Wave | 347 → 313 | 446k → 536k |
Extra draw calls / triangles come from the lower sun: the shadow pass now catches more casters. +1 call for the grading pass.

| Preset | FPS normal | FPS at 4× slower CPU | Draw calls |
|---|---|---|---|
| High | 60 | 56 (was 59) | 460 |
| Medium (phones start here) | 60 | 59.6 | 447 |
| Low | 60 | 60 | 180 |

GPU memory: textures 11.6 MB (unchanged) + PMREM env maps ~3 MB + HDR target (half float, MSAA ×4 High / ×2 Medium) ~10–40 MB depending on resolution.
Download: 930 KB → 1.30 MB (gzip 254 → 446 KB; the two HDRIs).

High loses ~3 FPS on a 4× slower CPU because of draw calls; stage 3 (merging static buildings and props) is where they come down to the ≤ 200 budget.
