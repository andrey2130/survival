# Credits & licenses

## Code libraries
| Library | License | Use |
|---|---|---|
| [three.js](https://threejs.org) | MIT | 3D rendering |
| [Vite](https://vite.dev) | MIT | build tool (dev only) |
| [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) | MIT | single-file build for the iOS app (dev only) |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | language (dev only) |

## Art, sound, fonts
- **3D models** — all procedural: built in code from boxes/cones/spheres with vertex colours
  (`web/src/world/models.ts`). No third-party model packs are bundled.
- **Shaders** (wind sway, ice sparkle, outlines) — written for this project.
- **Sounds** — synthesised at runtime with the Web Audio API (`web/src/core/audio.ts`). No audio files.
- **Icons** — hand-drawn inline SVG (`web/src/ui/icons.ts`) and system emoji.
- **Fonts** — the device's own rounded system font (`ui-rounded` / SF Pro Rounded on iPhone); none bundled.

If CC0 packs (e.g. Kenney, Quaternius) are added later, list each pack here with its URL and licence.
