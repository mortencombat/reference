/**
 * Copy third-party browser libraries from node_modules into the theme so the
 * built site does not load anything from public CDNs.
 */
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'themes/coo/source/vendor');

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, 'katex'), { recursive: true });

const files = [
  [join(pkgDir('@popperjs/core'), 'dist/umd/popper.min.js'), 'popper.min.js'],
  [join(pkgDir('tippy.js'), 'dist/tippy-bundle.umd.min.js'), 'tippy.min.js'],
  [join(pkgDir('katex'), 'dist/katex.min.js'), 'katex/katex.min.js'],
  [join(pkgDir('katex'), 'dist/katex.min.css'), 'katex/katex.min.css'],
  [join(pkgDir('katex'), 'dist/fonts'), 'katex/fonts']
];

for (const [src, dest] of files) {
  cpSync(src, join(target, dest), { recursive: true });
}
console.log(`vendored ${files.length} entries into themes/coo/source/vendor`);
