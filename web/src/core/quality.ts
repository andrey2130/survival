/**
 * Graphics quality presets. "auto" starts at a sensible level for the device and steps down
 * (High -> Medium -> Low) when the frame rate stays under the target for a few seconds.
 */
export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityLevel;

export interface QualityPreset {
  /** cap for renderer pixel ratio (never above the device's) */
  pixelRatio: number;
  shadows: boolean;
  shadowMap: number;
  /** multiplier for particle bursts */
  particles: number;
  /** share of falling snow flakes drawn */
  snow: number;
  /** additive glow sprites around fire / crystals (cheap stand-in for bloom) */
  glow: boolean;
  /** dark outline around the hero and animals */
  outlines: boolean;
  /** footprints in the snow */
  footprints: boolean;
  /** HDR target + colour grading LUT pass */
  post: boolean;
  /** MSAA samples of that target */
  msaa: number;
  /** soft shadow filter radius */
  shadowRadius: number;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 1.25, shadows: false, shadowMap: 512, particles: 0.4, snow: 0.35, glow: false, outlines: false, footprints: false, post: false, msaa: 0, shadowRadius: 1 },
  medium: { pixelRatio: 1.7, shadows: true, shadowMap: 1024, particles: 0.75, snow: 0.7, glow: false, outlines: true, footprints: true, post: true, msaa: 2, shadowRadius: 2 },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, particles: 1, snow: 1, glow: true, outlines: true, footprints: true, post: true, msaa: 4, shadowRadius: 3 },
};

export const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

/** Phones / tablets start on Medium in auto mode, desktops on High. */
export function autoStartLevel(): QualityLevel {
  const touch = matchMedia('(pointer: coarse)').matches;
  return touch ? 'medium' : 'high';
}

/** Version stamped at build time (vite.config.ts). */
export const BUILD = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  date: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '',
};
