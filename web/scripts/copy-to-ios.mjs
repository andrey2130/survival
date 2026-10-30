import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = resolve(root, 'dist/index.html');
const dst = resolve(root, '../survival/game.html');
copyFileSync(src, dst);
console.log(`Copied ${src} -> ${dst}`);
