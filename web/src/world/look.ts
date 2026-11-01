import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import dayHdr from '../assets/env/day.hdr?url';
import nightHdr from '../assets/env/night.hdr?url';

/**
 * The camera "look" (see docs/art/ART_BIBLE.md §4): image-based lighting from a winter-sky HDRI
 * (night: moonlit HDRI), height fog with aerial perspective, tone mapping and colour grading
 * through a 3D LUT that blends day / evening / night / blizzard moods. ACES tone mapping.
 *
 * Medium / High render the scene into an HDR target and finish it in one full-screen pass
 * (tone map -> sRGB -> LUT). Low renders straight to the screen with ACES and no grading.
 */

/** Light levels (tuned against the reference shots, docs/art). */
export const LIGHT = {
  exposure: 0.75,
  sunDay: 5.5, sunNight: 0.9,
  hemiDay: 0.25, hemiNight: 0.3,
  envDay: 0.5, envNight: 0.75,
};

// ------------------------------------------------------------------ height fog (all materials)
/**
 * Replaces three's fog chunks: distance fog (aerial perspective: far things lighter and bluer)
 * plus a thin layer of ground haze that thickens with distance. World height is rebuilt from the
 * view-space position, so it works for every material (meshes, instances, points, sprites).
 */
export const FOG = { heightDensity: { value: 0.35 }, heightFalloff: { value: 5.0 } };
let fogInstalled = false;
export function installFog() {
  if (fogInstalled) return;
  fogInstalled = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogY;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world y = (R^T (mv - t)).y for the rigid view matrix
  vFogY = dot( vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] ), mvPosition.xyz - viewMatrix[3].xyz );
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogY;
  uniform float fogHeightDensity;
  uniform float fogHeightFalloff;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // ground haze: dense at the snow, gone a few metres up, stronger further away
  float haze = fogHeightDensity * exp( - max( vFogY, 0.0 ) / fogHeightFalloff ) * smoothstep( 30.0, fogFar, vFogDepth );
  fogFactor = clamp( fogFactor + haze * ( 1.0 - fogFactor ), 0.0, 1.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
  // the two extra uniforms live in the shared fog uniform group, so every material gets them
  const U = THREE.UniformsLib.fog as Record<string, THREE.IUniform>;
  U.fogHeightDensity = FOG.heightDensity;
  U.fogHeightFalloff = FOG.heightFalloff;
  for (const k of Object.keys(THREE.ShaderLib)) {
    const s = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[k];
    if (s.uniforms.fogColor) { s.uniforms.fogHeightDensity = FOG.heightDensity; s.uniforms.fogHeightFalloff = FOG.heightFalloff; }
  }
}

// ------------------------------------------------------------------ colour grading LUT
interface Grade {
  /** saturation (1 = unchanged) */ sat: number;
  /** contrast around mid grey */ con: number;
  /** colour added to the shadows */ shadow: [number, number, number];
  /** colour added to the highlights */ high: [number, number, number];
  /** overall multiply */ gain: [number, number, number];
  /** lifted blacks */ lift: number;
}
/** Moods (ART_BIBLE §4). Values are in display (sRGB) space. */
export const GRADES: Record<'day' | 'evening' | 'night' | 'blizzard', Grade> = {
  day: { sat: 1.1, con: 1.06, shadow: [-0.015, 0.0, 0.045], high: [0.02, 0.012, -0.01], gain: [1, 1, 1], lift: 0 },
  evening: { sat: 1.2, con: 1.06, shadow: [0.02, -0.01, 0.07], high: [0.07, 0.025, -0.035], gain: [1.03, 0.98, 0.95], lift: 0.01 },
  night: { sat: 1.1, con: 1.12, shadow: [-0.03, 0.0, 0.08], high: [0.06, 0.02, -0.03], gain: [0.88, 0.96, 1.08], lift: 0.012 },
  blizzard: { sat: 0.72, con: 0.86, shadow: [0.0, 0.015, 0.04], high: [0.0, 0.0, 0.01], gain: [0.97, 0.99, 1.02], lift: 0.06 },
};
export type Mood = keyof typeof GRADES;
const LUT_N = 32;

function grade(c: number[], g: Grade) {
  let [r, gg, b] = c;
  const l0 = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  // split toning
  const sh = (1 - l0) ** 2, hi = l0 ** 2;
  r += g.shadow[0] * sh + g.high[0] * hi;
  gg += g.shadow[1] * sh + g.high[1] * hi;
  b += g.shadow[2] * sh + g.high[2] * hi;
  // contrast
  r = (r - 0.5) * g.con + 0.5; gg = (gg - 0.5) * g.con + 0.5; b = (b - 0.5) * g.con + 0.5;
  // saturation
  const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  r = l + (r - l) * g.sat; gg = l + (gg - l) * g.sat; b = l + (b - l) * g.sat;
  // lift + gain
  r = g.lift + r * (1 - g.lift) * g.gain[0]; gg = g.lift + gg * (1 - g.lift) * g.gain[1]; b = g.lift + b * (1 - g.lift) * g.gain[2];
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, gg)), Math.min(1, Math.max(0, b))];
}

// ------------------------------------------------------------------ the look
export class Look {
  /** full-screen grading pass on (Medium / High) */
  post = false;
  private rt: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lut: THREE.Data3DTexture;
  private lutData = new Uint8Array(LUT_N ** 3 * 4);
  private weightsKey = '';
  private env: { day: THREE.Texture | null; night: THREE.Texture | null } = { day: null, night: null };
  /** tunables (debug) */
  readonly cfg = LIGHT;
  readonly grades = GRADES;
  /** current mood weights (for the debug panel) */
  weights: Record<Mood, number> = { day: 1, evening: 0, night: 0, blizzard: 0 };

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    installFog();
    // ACES: richer contrast and saturation than AgX on snow scenes (A/B in docs/art/STAGE2.md)
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    this.lut = new THREE.Data3DTexture(this.lutData, LUT_N, LUT_N, LUT_N);
    this.lut.format = THREE.RGBAFormat;
    this.lut.type = THREE.UnsignedByteType;
    this.lut.minFilter = this.lut.magFilter = THREE.LinearFilter;
    this.lut.wrapS = this.lut.wrapT = this.lut.wrapR = THREE.ClampToEdgeWrapping;
    this.lut.unpackAlignment = 1;
    this.setMood(this.weights);

    const mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tLut: { value: this.lut }, uLutN: { value: LUT_N } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `precision highp sampler3D;
        uniform sampler2D tScene; uniform sampler3D tLut; uniform float uLutN; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tScene, vUv).rgb;
          c = toneMapping(c);                                   // ACES (renderer setting) with exposure
          c = clamp(linearToOutputTexel(vec4(c, 1.0)).rgb, 0.0, 1.0);  // -> sRGB
          vec3 uvw = c * ((uLutN - 1.0) / uLutN) + 0.5 / uLutN;
          gl_FragColor = vec4(texture(tLut, uvw).rgb, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.loadEnv();
  }

  private loadEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const loader = new HDRLoader();
    const load = (url: string, key: 'day' | 'night') => loader.load(url, (t) => {
      this.env[key] = pm.fromEquirectangular(t).texture;
      t.dispose();
      if (this.env.day && this.env.night) pm.dispose();
    });
    load(dayHdr, 'day');
    load(nightHdr, 'night');
  }

  /**
   * Time of day: night01 0..1 (0 = noon) and evening01 (sun near the horizon). Picks the HDRI and
   * its strength and blends the LUT moods.
   */
  update(night01: number, evening01: number, blizzard01 = 0) {
    const night = night01 > 0.5;
    const env = night ? this.env.night : this.env.day;
    if (env && this.scene.environment !== env) this.scene.environment = env;
    // matched at the switch point so there's no visible jump
    this.scene.environmentIntensity = night ? LIGHT.envNight : Math.max(0.2, LIGHT.envDay * (1 - night01 * 1.3));
    this.renderer.toneMappingExposure = LIGHT.exposure;
    const w = { day: 0, evening: 0, night: 0, blizzard: blizzard01 };
    w.night = THREE.MathUtils.smoothstep(night01, 0.35, 0.85);
    w.evening = Math.min(1 - w.night, evening01);
    w.day = Math.max(0, 1 - w.night - w.evening);
    this.setMood(w);
  }

  /** Rebuild the LUT for a blend of moods (only when the blend actually changed). */
  setMood(w: Record<Mood, number>) {
    const key = (Object.keys(GRADES) as Mood[]).map((k) => w[k].toFixed(2)).join(',');
    if (key === this.weightsKey) return;
    this.rebuildLut(w, key);
  }

  /** Force the LUT to be rebuilt (after editing GRADES). */
  refreshLut() { this.rebuildLut(this.weights, this.weightsKey); }

  private rebuildLut(w: Record<Mood, number>, key: string) {
    this.weightsKey = key;
    this.weights = { ...w };
    const moods = (Object.keys(GRADES) as Mood[]).filter((k) => w[k] > 0.001);
    const tot = moods.reduce((s, k) => s + w[k], 0) || 1;
    const d = this.lutData, N = LUT_N;
    let i = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const c = [r / (N - 1), g / (N - 1), b / (N - 1)];
      let o = [0, 0, 0];
      for (const k of moods) {
        const gr = grade(c, GRADES[k]), f = w[k] / tot;
        o = [o[0] + gr[0] * f, o[1] + gr[1] * f, o[2] + gr[2] * f];
      }
      d[i++] = o[0] * 255; d[i++] = o[1] * 255; d[i++] = o[2] * 255; d[i++] = 255;
    }
    this.lut.needsUpdate = true;
  }

  /** MSAA samples of the HDR target (the canvas' own antialiasing doesn't apply to it) */
  private samples = 4;

  setPost(on: boolean, samples = 4) {
    this.post = on;
    if (this.rt && (!on || samples !== this.samples)) { this.rt.dispose(); this.rt = null; }
    this.samples = samples;
    this.resize();
  }

  resize() {
    if (!this.post) return;
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(v.x, v.y, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
      (this.quad.material as THREE.ShaderMaterial).uniforms.tScene.value = this.rt.texture;
    } else this.rt.setSize(v.x, v.y);
  }

  render(camera: THREE.Camera) {
    const r = this.renderer;
    // stats cover the whole frame (scene + grading pass)
    r.info.autoReset = false;
    r.info.reset();
    if (!this.post || !this.rt) { r.render(this.scene, camera); return; }
    r.setRenderTarget(this.rt);
    r.render(this.scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
