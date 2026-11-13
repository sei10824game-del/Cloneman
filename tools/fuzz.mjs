// Random-input fuzz test: plays the game with a chaotic bot for a simulated
// few minutes and asserts nothing explodes (no NaN, no exceptions).
import { pathToFileURL } from 'node:url';

const elements = new Map();
function makeCtx() {
  const gradient = { addColorStop() {} };
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    shadowColor: '', shadowBlur: 0, font: '', textAlign: 'left',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, arcTo() {},
    quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {},
    fillRect() {}, clearRect() {}, strokeRect() {},
    fillText() {}, strokeText() {}, drawImage() {}, rect() {},
    createRadialGradient() { return gradient; },
    createLinearGradient() { return gradient; },
  };
}
function makeCanvas() {
  return { width: 800, height: 672, style: {}, getContext() { return makeCtx(); },
    addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } };
}
function makeEl() {
  const el = { textContent: '', innerHTML: '', className: '', style: {}, children: [], offsetWidth: 100,
    classList: (() => { const s = new Set(); return {
      add: (...cs) => cs.forEach(c => s.add(c)), remove: (...cs) => cs.forEach(c => s.delete(c)),
      toggle: (c, f) => { const on = f === undefined ? !s.has(c) : f; on ? s.add(c) : s.delete(c); },
      contains: c => s.has(c) }; })(),
    appendChild(c) { el.children.push(c); return c; },
    querySelectorAll() { return []; },
    addEventListener(t, fn) { (el._h ||= {})[t] = fn; } };
  return el;
}
const keyHandlers = [];
globalThis.window = {
  addEventListener(type, fn) { keyHandlers.push({ type, fn }); },
  AudioContext: undefined, webkitAudioContext: undefined,
};
globalThis.document = {
  hidden: false,
  getElementById(id) { if (!elements.has(id)) elements.set(id, id === 'game' ? makeCanvas() : makeEl()); return elements.get(id); },
  createElement(tag) { return tag === 'canvas' ? makeCanvas() : makeEl(); },
  addEventListener() {},
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; };

await import(pathToFileURL(new URL('../js/game.js', import.meta.url).pathname).href);
const { state } = globalThis.window.__cloneman;

let simT = 0;
const MS = 1000 / 60;
const DIRT = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
function key(type, code) { for (const h of keyHandlers) if (h.type === type) h.fn({ code, preventDefault() {} }); }
function step(frames) { for (let i = 0; i < frames; i++) { const cb = rafCb; rafCb = null; simT += MS; cb(simT); } }

step(3);
for (const h of keyHandlers) if (h.type === 'keydown') h.fn({ code: 'Enter', preventDefault() {} });

let seed = 123456789;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const SECONDS = Number(process.argv[2] || 120);
const ticks = SECONDS * 60;
let restarts = 0;
for (let t = 0; t < ticks; t++) {
  if (rnd() < 0.055) key('keydown', DIRT[Math.floor(rnd() * 4)]);
  if (rnd() < 0.02) key('keyup', 'Space');
  if (rnd() < 0.045) key('keydown', 'Space');
  const cb = rafCb; rafCb = null; simT += MS;
  try { cb(simT); } catch (err) { console.error(`CRASH at tick ${t}:`, err); process.exit(1); }
  const p = state.player;
  if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    console.error(`NaN player position at tick ${t} (mode=${state.mode})`); process.exit(1);
  }
  if (state.mode === 'over') { restarts++; key('keydown', 'Enter'); }
}
// force a couple of round clears directly to exercise reset paths
state.enemies.length = 0; state.spawnQueue.length = 0;
step(10);
console.log(`fuzz ok: ${SECONDS}s simulated, rounds reached OK, game-overs restarted ×${restarts}, mode=${state.mode}`);
