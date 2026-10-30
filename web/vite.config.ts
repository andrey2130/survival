import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file output so the iOS WKWebView can load one bundled HTML without path issues.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 4000 },
});
