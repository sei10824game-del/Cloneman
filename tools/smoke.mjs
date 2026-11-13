// Headless smoke test for CLONEMAN.
// Stubs just enough DOM/canvas to run the real game loop in Node,
// then drives actual gameplay: start → shoot → death → clear round → clone replay
// (incl. re-enacted death) → clone lives & reset rules → game over → restart.
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
    measureText() { return { width: 10 }; },
  };
}

function makeCanvas() {
  return {
    width: 800, height: 672, style: {},
    getContext() { return makeCtx(); },
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}

function makeEl(tag) {
  const el = {
    tag, textContent: '', innerHTML: '', className: '',
    style: {}, children: [], offsetWidth: 100,
    _v: undefined, _n: undefined,
    classList: (() => {
      const set = new Set();
      return {
        add(...cs) { cs.forEach(c => set.add(c)); },
        remove(...cs) { cs.forEach(c => set.delete(c)); },
        toggle(c, force) {
          const on = force === undefined ? !set.has(c) : force;
          if (on) set.add(c); else set.delete(c);
          return on;
        },
        contains(c) { return set.has(c); },
      };
    })(),
    appendChild(c) { el.children.push(c); return c; },
    addEventListener(type, fn) { (el._handlers ||= {})[type] = fn; },
    removeEventListener() {},
  };
  return el;
}

const keyHandlers = { window: [], document: [] };

globalThis.window = {
  addEventListener(type, fn) { keyHandlers.window.push({ type, fn }); },
  removeEventListener() {},
  AudioContext: undefined,
  webkitAudioContext: undefined,
};
globalThis.document = {
  hidden: false,
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, id === 'game' ? makeCanvas() : makeEl('div'));
    return elements.get(id);
  },
  createElement(tag) { return tag === 'canvas' ? makeCanvas() : makeEl(tag); },
  addEventListener(type, fn) { keyHandlers.document.push({ type, fn }); },
  removeEventListener() {},
};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; };

// ---- import the real game ----
await import('../js/game.js');
const { state } = globalThis.window.__cloneman;

let simT = 0;
const MS = 1000 / 60;
function step(frames) {
  for (let i = 0; i < frames; i++) {
    const cb = rafCb; rafCb = null;
    simT += MS;
    cb(simT);
  }
}
function key(type, code) {
  for (const h of keyHandlers.window) {
    if (h.type === type) h.fn({ code, preventDefault() {} });
  }
}
const press = (code) => key('keydown', code);
const release = (code) => key('keyup', code);

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ FAIL: ${label}`); }
}

const TI = 32;
const makeChaser = (x, y, name) => ({
  type: 'chaser', x, y, vx: 0, vy: 0,
  dir: { x: 1, y: 0 }, speed: 10, hp: 99, maxHp: 99, r: 11,
  color: '#ff4a3d', score: 100, name, flashT: 0,
  thinkT: 999, fireCd: 99, graceT: 0, dead: false, blocked: false,
});

console.log('— boot & title —');
step(5);
assert(state.mode === 'title', 'boots into title mode');

console.log('— game start —');
press('Enter');
assert(state.mode === 'play', 'Enter starts the game');
assert(state.round === 1, 'round 1 begins');
assert(state.spawnQueue.length === 3, 'round 1 spawns 3 chasers');
assert(state.lives === 3, 'starts with 3 lives');

state.player.invT = 9999; // deterministic soak: contact cannot kill the player

console.log('— straight-line shot (records into replay) —');
step(105); // burn intro (1.6s = 96 ticks) + a few play ticks
state.player.x = 7 * TI + 16; state.player.y = 8 * TI + 16;
state.player.dir = { x: 1, y: 0 }; state.player.nextDir = { x: 1, y: 0 };
state.enemies.push({
  ...makeChaser(11 * TI + 16, 8 * TI + 16, 'test-target'),
  dir: { x: 0, y: -1 }, speed: 0, hp: 1, maxHp: 1,
});
const scoreBefore = state.score;
press('Space');
step(1);
assert(state.player.shootCd > 0.35, `player shot cooldown is long (~0.5s, got ${state.player.shootCd.toFixed(2)}s)`);
step(19);
release('Space');
step(20);
assert(!state.enemies.some(e => e.name === 'test-target'), 'test target destroyed by straight bullet');
assert(state.score > scoreBefore, 'score increased after kill');
assert(state.rec.shots.length >= 1, 'shot recorded into round replay buffer');

console.log('— ghost-house spawning —');
step(180); // remaining spawn delays
assert(state.enemies.length + state.spawnQueue.length === 3, `round-1 roster intact: 3 chasers (got ${state.enemies.length + state.spawnQueue.length})`);

console.log('— death & respawn get recorded for clones —');
state.lives = 3;
state.player.invT = 0;
state.enemies.push(makeChaser(state.player.x, state.player.y, 'death-recorder'));
step(5);
assert(state.lives === 2, 'losing a life on hit');
assert(state.rec.deaths.length === 1, 'death frame stamped into the recording');
assert(Math.abs(state.player.x - (12 * TI + 16)) < 40 && Math.abs(state.player.y - (15 * TI + 16)) < 40, 'player respawned at start point');
assert(state.enemies.length + state.spawnQueue.length === 4, 'unborn ghosts survive a player death (3 + test chaser)');
state.enemies.length = 0; state.spawnQueue.length = 0; // clean slate for the forced clear
state.player.invT = 9999;

console.log('— pellets & power pellets —');
let pellets = 0, power = 0;
for (const v of state.grid.pellets) { if (v === 1) pellets++; else if (v === 2) power++; }
assert(pellets > 100, `pellet maze populated (${pellets} small)`);
assert(power === 4, `4 power pellets placed (${power})`);

console.log('— destructible terrain & round reset —');
const destructBefore = state.grid.destruct.size;
const someBlock = [...state.grid.destruct][0];
state.grid.destruct.delete(someBlock); // pretend it was smashed by a bullet
state.enemies.length = 0; state.spawnQueue.length = 0;
step(3);
assert(state.mode === 'clear', 'clearing all enemies triggers round clear');
assert(state.recordings.length === 1, 'round recording saved for clone');
assert(state.recordings[0].frames.length > 0, `recording contains frames (${state.recordings[0].frames.length})`);
assert(state.recordings[0].deaths.length === 1, 'recording carries the death stamp');
step(60 * 5); // clearT (2.8s) then round-2 intro (1.6s)
assert(state.round === 2, 'advanced to round 2');
assert(state.mode === 'play', 'round 2 in play');
assert(state.clones.length === 1, 'clone from round 1 joined');
assert(state.clones[0].lives === 3, 'clone enters with 3 lives');
assert(state.grid.destruct.size === destructBefore, 'destructible terrain fully restored');
let pellets2 = 0; for (const v of state.grid.pellets) if (v) pellets2++;
assert(pellets2 > 100, 'pellets restored for round 2');
assert(state.enemies.length + state.spawnQueue.length === 5, `round 2 roster = 5 (4 chasers + 1 speedy), got ${state.enemies.length + state.spawnQueue.length}`);

console.log('— clone replays round 1 incl. death & respawn —');
state.powerT = 60; // frightened ghosts wander harmlessly — deterministic replay check
let seenAt = -1;
for (let i = 0; i < 60 * 8 && seenAt === -1; i++) {
  step(1);
  for (const c of state.clones) if (c.respawnT > 0) { seenAt = c.f; break; }
}
assert(seenAt !== -1, `clone re-enacted the recorded death (exploded near frame ${seenAt}; recorded at ${state.recordings[0].deaths[0]})`);
assert(state.clones.length === 1 && state.clones[0].lives === 3, 're-enacted death costs no clone lives');
assert(state.clones[0].f > 0, `clone is replaying (frame ${state.clones[0].f})`);
assert(state.clones[0].shotIdx > 0, `clone re-fired recorded shots (${state.clones[0].shotIdx})`);

console.log('— time-up consumes a clone life and resets —');
{
  const c = state.clones[0];
  c.f = c.rec.frames.length - 2;
  c.respawnT = 0; c.fade = 0;
  const livesBefore = c.lives;
  step(3);
  const c2 = state.clones[0];
  assert(c2.lives === livesBefore - 1, 'time-up consumed one clone life');
  assert(c2.f < 5, 'replay restarted from the beginning after time-up');
}

console.log('— clones are hunted like the player —');
state.powerT = 0;
let guard = 0;
while (state.clones.length > 0 && guard++ < 6) {
  const c = state.clones[0];
  c.respawnT = 0; // skip the regroup beat for the test
  state.enemies.push(makeChaser(c.x, c.y, 'clone-hunter'));
  step(3);
}
assert(state.clones.length === 0, 'clone vanished after losing all of its lives');

console.log('— difficulty scaling —');
assert(state.enemies.length + state.spawnQueue.length >= 5, 'round 2 enemy count > round 1');

console.log('— player death & game over —');
state.lives = 1;
state.player.invT = 0;
state.enemies.push(makeChaser(state.player.x, state.player.y, 'test-killer'));
step(5);
assert(state.mode === 'over', 'losing last life ends the game');
assert(globalThis.localStorage.getItem('cloneman_hiscore') !== null, 'hi-score persisted');

console.log('— restart —');
press('Enter');
assert(state.mode === 'play' && state.round === 1 && state.score === 0, 'restart resets to round 1');
assert(state.clones.length === 0, 'clones cleared on new run');

console.log('');
if (failures > 0) {
  console.error(`SMOKE TEST FAILED: ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log('SMOKE TEST PASSED ✅');
}
