/** Injected by vite.config.ts at build time. */
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

/** Vite asset URL imports (inlined as data URIs in the single-file build). */
declare module '*?url' {
  const url: string;
  export default url;
}
