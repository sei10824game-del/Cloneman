// Verifies cloneman-standalone.html: extracts the inlined <script>, runs it in a
// stubbed VM (no DOM/canvas), and asserts the game boots and starts.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('cloneman-standalone.html', 'utf8');
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if (!m) { console.error('no inline <script> found'); process.exit(1); }
const code = m[1];

function makeCtx() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient;
      if (typeof prop === 'string' && !(prop in t)) return (...a) => {};
      return t[prop];
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}
const elements = new Map();
const makeEl = () => {
  const el = { textContent: '', innerHTML: '', className: '', style: {}, children: [], offsetWidth: 100,
    classList: (() => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !s.has(c) : f; on ? s.add(c) : s.delete(c); return on; }, contains: c => s.has(c) }; })(),
    appendChild(c) { el.children.push(c); return c; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (el._h ||= {})[type] = fn; } };
  return el;
};
const makeCanvas = () => ({ width: 800, height: 672, style: {}, getContext: () => makeCtx(), addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } });
const keyHandlers = [];
let rafCb = null;
const sandbox = {
  console, Math, JSON, Date, performance, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  requestAnimationFrame: (cb) => { rafCb = cb; },
  window: { addEventListener(type, fn) { keyHandlers.push({ type, fn }); }, AudioContext: undefined, webkitAudioContext: undefined },
  document: {
    hidden: false,
    getElementById(id) { if (!elements.has(id)) elements.set(id, id === 'game' ? makeCanvas() : makeEl()); return elements.get(id); },
    createElement(tag) { return tag === 'canvas' ? makeCanvas() : makeEl(); },
    addEventListener() {},
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: 'cloneman-standalone.inline.js' });
} catch (err) {
  console.error('STANDALONE BOOT FAILED:', err);
  process.exit(1);
}

const cloneman = sandbox.window.__cloneman;
if (!cloneman) { console.error('window.__cloneman missing — boot incomplete'); process.exit(1); }

let t = 0;
const MS = 1000 / 60;
const step = (n) => { for (let i = 0; i < n; i++) { const cb = rafCb; rafCb = null; t += MS; cb(t); } };
step(10);
console.log('boot ok, mode =', cloneman.state.mode);
for (const h of keyHandlers) if (h.type === 'keydown') h.fn({ code: 'Enter', preventDefault() {} });
step(200);
console.log('after Enter, mode =', cloneman.state.mode, '| round =', cloneman.state.round, '| enemies(queued+alive) =', cloneman.state.enemies.length + cloneman.state.spawnQueue.length);
if (cloneman.state.mode !== 'play') { console.error('game did not start from standalone build'); process.exit(1); }
console.log('STANDALONE VERIFY PASSED ✅');
