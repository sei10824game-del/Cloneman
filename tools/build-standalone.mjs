// Builds cloneman-standalone.html — a single self-contained file (JS + CSS inlined)
// that runs from file:// (double-click) or any static host. Built from the same sources.
import { readFile, writeFile } from 'node:fs/promises';

const html = await readFile('index.html', 'utf8');
const css = await readFile('style.css', 'utf8');
const maze = await readFile('js/maze.js', 'utf8');
const audio = await readFile('js/audio.js', 'utf8');
const game = await readFile('js/game.js', 'utf8');

const strip = (src, { exports = [], imports = [] } = {}) => {
  let s = src;
  for (const name of exports) s = s.replace(new RegExp(`export\\s+(const|function|class|let)\\s`, 'g'), '$1 ');
  for (const re of imports) s = s.replace(re, '');
  return s;
};

const mazeJs = strip(maze, { exports: ['const', 'function'] });
const audioJs = audio.replace(/export\s+class\s/, 'class ');
const gameJs = game
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/maze\.js';?/s, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\/audio\.js';?/s, '');

for (const [name, src] of [['maze', mazeJs], ['audio', audioJs], ['game', gameJs]]) {
  if (/(^|\n)\s*(import|export)\s/.test(src)) {
    console.error(`leftover ESM statement in ${name}.js:\n`, src.match(/(^|\n)\s*(import|export)[^\n]*/)?.[0]);
    process.exit(1);
  }
}

const bundled = `// CLONEMAN standalone build — do not edit directly (rebuild with: node tools/build-standalone.mjs)\n${mazeJs}\n${audioJs}\n${gameJs}`;

const out = html
  .replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="js/game.js"></script>', () => `<script>\n${bundled}\n</script>`);

if (out.includes('js/game.js') || out.includes('style.css')) {
  console.error('failed to inline assets (pattern mismatch in index.html)');
  process.exit(1);
}

await writeFile('cloneman-standalone.html', out);
console.log(`cloneman-standalone.html written (${(out.length / 1024).toFixed(1)} KB)`);
