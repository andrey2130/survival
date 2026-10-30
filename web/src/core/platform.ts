// Native bridge (iOS WKWebView) with graceful browser fallbacks.

interface NativeHandlers {
  haptic?: { postMessage(v: unknown): void };
  save?: { postMessage(v: unknown): void };
}

const native = (): NativeHandlers | undefined => (window as any).webkit?.messageHandlers;

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning';

let hapticsOn = true;
let lastHaptic = 0;

export const Platform = {
  isNative: () => !!native()?.haptic,

  setHaptics(on: boolean) { hapticsOn = on; },

  haptic(style: HapticStyle = 'light') {
    if (!hapticsOn) return;
    const now = performance.now();
    if (style === 'light' && now - lastHaptic < 60) return; // throttle tiny taps
    lastHaptic = now;
    const h = native()?.haptic;
    if (h) { h.postMessage(style); return; }
    const ms = { light: 8, medium: 18, heavy: 35, success: [10, 40, 10], warning: [30, 50, 30] }[style];
    try { navigator.vibrate?.(ms as any); } catch { /* not supported */ }
  },

  /** Persist the save. Native side mirrors to UserDefaults (survives WKWebView storage wipes). */
  writeSave(key: string, json: string) {
    try { localStorage.setItem(key, json); } catch { /* quota / private mode */ }
    native()?.save?.postMessage(json);
  },

  readSave(key: string): string | null {
    // The iOS host injects window.__NATIVE_SAVE__ at document start.
    const nativeSave = (window as any).__NATIVE_SAVE__ as string | undefined;
    let local: string | null = null;
    try { local = localStorage.getItem(key); } catch { /* ignore */ }
    if (!nativeSave) return local;
    if (!local) return nativeSave;
    // Prefer the most recent of the two.
    try { return JSON.parse(nativeSave).savedAt > JSON.parse(local).savedAt ? nativeSave : local; } catch { return local; }
  },

  clearSave(key: string) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    (window as any).__NATIVE_SAVE__ = undefined;
    native()?.save?.postMessage('');
  },
};
