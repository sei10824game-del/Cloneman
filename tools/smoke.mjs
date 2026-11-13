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
    style: { setProperty() {} }, children: [], offsetWidth: 100,
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
    querySelectorAll() { return []; },
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
state.lives = 3; // pin: clone-life inheritance is tested separately
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

console.log('— gold & reinforcement-learning shop —');
assert(state.gold >= 124, `gold awarded for round-clear + kills (got ${state.gold}G)`);
assert(globalThis.localStorage.getItem('cloneman_gold') === String(state.gold), 'gold persisted to localStorage');

const goldBefore = state.gold;
state.gold = 100;
window.__cloneman.buyRL(0); // not enough gold
assert(!state.recordings[0].rl, 'purchase blocked when gold is insufficient');
assert(state.gold === 100, 'no gold spent on a failed purchase');

state.gold = goldBefore + 300;
const goldFieldBefore = state.gold;
window.__cloneman.buyRL(0);
assert(state.gold === goldFieldBefore - 300, 'RL purchase deducted exactly 300G');
assert(state.recordings[0].rl === true, 'recording marked as reinforcement-learned');
assert(state.recordings[0].learn && state.recordings[0].learn.aggro > 0.5, `style parameters learned from replay (aggro=${state.recordings[0].learn ? state.recordings[0].learn.aggro.toFixed(2) : 'n/a'})`);
assert(state.clones[0].rl === true, 'on-field clone awakened into a pseudo-player');
assert(globalThis.localStorage.getItem('cloneman_gold') === String(state.gold), 'post-purchase gold persisted');

console.log('— shop toggle via B key —');
assert(state.shopOpen === false, 'shop starts closed');
press('KeyB');
assert(state.shopOpen === true, 'B opens the shop');
press('KeyB');
assert(state.shopOpen === false, 'B closes the shop');

console.log('— RL pseudo-player plays autonomously —');
state.powerT = 120; // keep ghosts frightened so the check is deterministic
const rlClone = state.clones[0];
rlClone.respawnT = 0;
const rlx0 = rlClone.x, rly0 = rlClone.y, rframe0 = rlClone.f;
step(90); // 1.5s
const rlClone2 = state.clones[0];
const drift = Math.hypot(rlClone2.x - rlx0, rlClone2.y - rly0);
assert(drift > 15, `RL clone moves by itself (${drift.toFixed(0)}px in 1.5s)`);
assert(rlClone2.f === rframe0, 'RL clone does not advance the replay cursor');
assert(rlClone2.lives >= 1, 'RL clone still lives on the field');

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

console.log('— enemy mode: 天敵ゴースト vs genius Pac-Man —');
window.__cloneman.startGame('ghost');
assert(state.gameMode === 'ghost', 'enemy mode selected');
assert(state.mode === 'play' && state.round === 1, 'ghost mode starts at round 1 (lives: unlimited)');
assert(state.spawnQueue.length === 1 && state.pacCount === 1, 'round 1 spawns exactly one Pac-Man');
step(60 * 3); // intro + spawn
assert(state.pacmans.length === 1, 'genius Pac-Man entered the maze');

// touch (unpowered) defeats Pac-Man
{
  const m = state.pacmans[0];
  m.graceT = 0; // spawn grace does not protect him from being hunted
  state.player.x = m.x; state.player.y = m.y; state.player.invT = 0;
  const scoreB = state.score;
  step(2);
  assert(state.pacmans.length === 0, 'touch defeats an unpowered Pac-Man');
  assert(state.score > scoreB, 'Pac-Man kill scored');
}
assert(state.mode === 'clear', 'clearing the last Pac-Man clears the round');
assert(state.pacCount === 2, 'next round will have +1 Pac-Man');
step(60 * 5); // clearT + intro
assert(state.gameMode === 'ghost' && state.round === 2, 'advanced to round 2 in enemy mode');
assert(state.pacmans.length + state.spawnQueue.length === 2, `round 2 fields two Pac-Men (got ${state.pacmans.length + state.spawnQueue.length})`);
assert(state.recordings.length === 1 && state.recordings[0].mode === 'ghost', 'ghost attempt recorded (mode=ghost)');

// RL purchase blocked for enemy-mode replays
state.gold = 9999;
const rlMark = state.recordings[0].rl;
window.__cloneman.buyRL(0);
assert(!state.recordings[0].rl || state.recordings[0].rl === rlMark, 'RL purchase blocked for enemy-mode replays');

// powered Pac-Man kills the ghost → death advances the round, previous self becomes clone
step(60 * 2); // let both Pac-Men spawn; keep the ghost invulnerable during setup
state.player.invT = 9999;
for (const pm of state.pacmans) { pm.powerT = 99; pm.graceT = 0; } // powered = item in use
const livesB = state.lives;
const roundB = state.round;
state.player.invT = 0; // now vulnerable — it is the predator
const pm = state.pacmans[0];
state.player.x = pm.x; state.player.y = pm.y;
step(2);
assert(state.lives === livesB, 'enemy mode lives are unlimited — a powered Pac-Man hit costs nothing');
assert(state.mode !== 'over', 'the ghost can never game-over in enemy mode');
assert(state.round === roundB + 1, 'death advances the round in enemy mode');
assert(state.clones.length >= 1, 'the dead run reborn as a ghost clone');

console.log('');
console.log('— copy me mode: 自立学習クローン —');
window.__cloneman.startGame('copyme');
assert(state.gameMode === 'copyme', 'copyme mode selected');
assert(state.mode === 'play' && state.round === 1, 'copyme starts at round 1');
const goldAtStart = state.gold;
step(110);
state.player.invT = 9999;
state.enemies.length = 0; state.spawnQueue.length = 0; // force round-1 clear
step(3);
assert(state.mode === 'clear', 'round 1 cleared in copyme');
assert(state.gold === goldAtStart, 'copyme has no gold economy (shop-less)');
step(60 * 5); // clearT + intro → round 2
assert(state.round === 2 && state.clones.length === 1, 'clone joins for round 2');
assert(state.clones[0].rl === true, 'every clone is an always-on pseudo-player — no purchase needed');
assert(state.clones[0].learn === state.recordings[0].learn, 'clone carries the model trained on ITS OWN round — not a shared model');
assert(state.clones[0].learn.trainedAt === state.recordings[0].frames.length, `clone's dataset is its own round's replay (trainedAt=${state.clones[0].learn ? state.clones[0].learn.trainedAt : 0} frames)`);

{
  const c0 = state.clones[0];
  c0.respawnT = 0;
  const px = c0.x, py = c0.y, f0 = c0.f;
  step(90);
  const c1 = state.clones[0];
  assert(Math.hypot(c1.x - px, c1.y - py) > 15, 'copyme clone moves by itself');
  assert(c1.f === f0, 'copyme clone never replays frames');
}

press('KeyB');
assert(state.shopOpen === false, 'B key does nothing in copyme (no shop)');
window.__cloneman.buyRL(0);
assert(state.gold === goldAtStart, 'buying RL is impossible in copyme');

state.enemies.length = 0; state.spawnQueue.length = 0; // force round-2 clear
step(3);
step(60 * 6); // clearT + intro → round 3
assert(state.round === 3 && state.clones.length === 2, 'round 3 fields two self-learning clones');
assert(state.clones[0].learn === state.recordings[0].learn && state.clones[1].learn === state.recordings[1].learn, 'every copyme clone is trained on its own round only');
assert(state.clones[0].learn.trainedAt === state.recordings[0].frames.length, 'round-1 clone keeps its own birth model (no cumulative retrain)');

console.log('');
console.log('— enemy mode: Pac-Man fights back like the normal player —');
window.__cloneman.startGame('ghost');
step(60 * 3); // intro + Pac-Man spawn
{
  const TI = 32;
  const pm = state.pacmans[0];
  pm.graceT = 0; pm.powerT = 0; pm.thinkT = 999; // hold a steady line for determinism
  state.player.x = 7 * TI + 16; state.player.y = 8 * TI + 16; state.player.invT = 0;
  pm.x = 11 * TI + 16; pm.y = 8 * TI + 16; // same row, clear line of sight
  pm.dir = { x: -1, y: 0 }; // facing the ghost — like a human lining up the shot
  let sawBullet = false;
  for (let i = 0; i < 70 && !sawBullet; i++) { step(1); if (state.ebullets.length > 0) sawBullet = true; }
  assert(sawBullet, 'the programmed Pac-Man fired a straight shot at the ghost (same rules as normal play)');
  pm.graceT = 999; // keep its body out of the way — only the bullet matters now
  step(60 * 3); // let the straight bullet land
  assert(state.lives === 2 || state.round === 2, `Pac-Man bullet hit the ghost (lives=${state.lives}, round=${state.round}) — death advances the round`);
}

console.log('');
console.log('— RL / copyme clones only shoot where they face —');
window.__cloneman.startGame('copyme');
step(110);
state.player.invT = 9999;
state.enemies.length = 0; state.spawnQueue.length = 0;
step(3);
step(60 * 5); // → round 2 with one self-learning clone
assert(state.clones.length === 1 && state.clones[0].rl, 'copyme clone is an always-on pseudo-player');
{
  const TI = 32;
  const c = state.clones[0];
  c.respawnT = 0; c.fade = 0; c.fireCd = 0;
  const enemy = {
    ...makeChaser(12 * TI + 16, 8 * TI + 16, 'rl-facing-target'),
    dir: { x: 0, y: 1 }, speed: 0, thinkT: 999, fireCd: 999, graceT: 0,
  };
  state.enemies.push(enemy);
  // facing AWAY from the aligned enemy — must NOT shoot
  c.x = 8 * TI + 16; c.y = 8 * TI + 16;
  c.dir = { x: -1, y: 0 }; c.thinkT = 999; c.fireCd = 0;
  const b0 = state.bullets.length;
  step(20);
  assert(state.bullets.length === b0, 'clone does NOT shoot at an enemy behind it (faces matter)');
  // facing TOWARD the aligned enemy — must shoot, along its facing axis
  c.dir = { x: 1, y: 0 }; c.fireCd = 0;
  step(3);
  assert(state.bullets.length > b0, 'clone shoots the aligned enemy while facing it');
  const fb = state.bullets[state.bullets.length - 1];
  assert(fb.vx > 0 && fb.vy === 0, 'clone bullet flies along the facing direction');
}

console.log('');
console.log('— expanded enemy roster —');
window.__cloneman.startGame('player');
step(110);
state.player.invT = 9999;
state.enemies.length = 0; state.spawnQueue.length = 0;

// roster check: round 6 fields all new types
window.__cloneman.setupRound(6);
const roster = state.spawnQueue.map(q => q.type);
assert(roster.includes('warp'), 'round 6 roster includes Warp');
assert(roster.includes('phantom'), 'round 6 roster includes Phantom');
assert(roster.includes('splitter'), 'round 6 roster includes Splitter');
assert(roster.includes('healer'), 'round 6 roster includes Healer');

// round 1 stays classic
window.__cloneman.setupRound(1);
assert(!state.spawnQueue.some(q => ['warp', 'phantom', 'splitter', 'healer'].includes(q.type)), 'round 1 stays classic chasers-only');
step(110);
state.player.invT = 9999;
state.enemies.length = 0; state.spawnQueue.length = 0;

// splitter splits into two snitches on death
{
  const TI = 32, COLS = 25;
  const idxC = (x, y) => y * COLS + x;
  // guarantee a clean shooting lane: carve walls & destructibles on row 8, tiles 7..11
  for (let tx = 7; tx <= 11; tx++) {
    const i = idxC(tx, 8);
    state.grid.walls[i] = 0;
    state.grid.destruct.delete(i);
    state.grid.pellets[i] = 0;
  }
  const sp = { ...makeChaser(11 * TI + 16, 8 * TI + 16, 'splitter-test'), type: 'splitter', speed: 0, hp: 2, maxHp: 2, thinkT: 999, fireCd: 999 };
  state.enemies.push(sp);
  state.player.x = 7 * TI + 16; state.player.y = sp.y; state.player.dir = { x: 1, y: 0 }; state.player.nextDir = { x: 1, y: 0 };
  const before = state.enemies.length;
  // Pac-Man-style movement never stops on its own — pin the shooter in place
  const pin = () => { state.player.x = 7 * TI + 16; state.player.y = sp.y; };
  const stepPin = (n) => { for (let i = 0; i < n; i++) { pin(); step(1); } };
  pin();
  press('Space'); stepPin(1); release('Space');
  stepPin(60); // first shot lands
  press('Space'); stepPin(1); release('Space');
  stepPin(90); // second shot lands → death → split
  const snitches = state.enemies.filter(e => e.type === 'snitch').length;
  assert(state.enemies.length - before >= 1, 'splitter died and snitches replaced it');
  assert(snitches === 2, `splitter split into two snitches (got ${snitches})`);
}

// warp teleports near the player
{
  const TI = 32;
  const w = { ...makeChaser(6 * TI + 16, 6 * TI + 16, 'warp-test'), type: 'warp', speed: 0, teleCd: 0.3, graceT: 0 };
  state.enemies.push(w);
  const wx = w.x, wy = w.y;
  step(60);
  assert(Math.hypot(w.x - wx, w.y - wy) > TI, `warp teleported (${Math.round(Math.hypot(w.x - wx, w.y - wy))}px away)`);
}

// healer mends a damaged ally nearby
{
  const TI = 32;
  const h = { ...makeChaser(6 * TI + 16, 10 * TI + 16, 'healer-test'), type: 'healer', speed: 0, hp: 2, maxHp: 2, healCd: 0.2, thinkT: 999, fireCd: 999 };
  const buddy = { ...makeChaser(7 * TI + 16, 10 * TI + 16, 'buddy-test'), hp: 1, maxHp: 3, thinkT: 999, fireCd: 999 };
  state.enemies.push(h, buddy);
  step(30);
  assert(buddy.hp === 2, `healer restored an ally's HP to ${buddy.hp}`);
}

// phantom phase-cycles into invisibility
{
  const ph = { ...makeChaser(10 * TI + 16, 10 * TI + 16, 'phantom-test'), type: 'phantom', speed: 0, phaseCd: 0.2, invisibleT: 0, thinkT: 999, fireCd: 999 };
  state.enemies.push(ph);
  step(30);
  assert(ph.invisibleT > 0, 'phantom turned invisible on its cycle');
}

console.log('');
console.log('— clone inherits remaining lives at clear time —');
window.__cloneman.startGame('player');
step(110);
state.player.invT = 9999;
step(60 * 10); // 10s of real play — a recording actually worth cloning
state.lives = 1;
state.enemies.length = 0; state.spawnQueue.length = 0;
step(3); // forced clear with 1 life left
step(60 * 5);
assert(state.clones.length === 1, 'clone spawned from the 1-life clear');
assert(state.clones[0].lives === 1 && state.clones[0].maxLives === 1, 'clone inherited the 1 life you had at clear (maxLives=1)');
window.__cloneman.startGame('player');
step(110);
state.player.invT = 9999;
step(60 * 10);
state.lives = 2;
state.enemies.length = 0; state.spawnQueue.length = 0;
step(3); // clear with 2 lives
step(60 * 5);
assert(state.clones[0].lives === 2 && state.clones[0].maxLives === 2, 'clone inherited 2 lives');

console.log('— shop upgrades: permanent character build —');
state.upgrades = { lives: 0, attack: 0, multishot: 0, speed: 0, gold: 0, pierce: 0, bspeed: 0, bsize: 0, crit: 0, magnet: 0, ptime: 0 };
try { globalThis.localStorage.removeItem('cloneman_upgrades'); } catch { /* ignore */ }
window.__cloneman.startGame('player');
step(110);
state.player.invT = 9999;
state.gold = 5000;
assert(state.lives === 3, 'starts at 3 lives with no upgrades');
window.__cloneman.buyUpgrade('lives');
assert(state.lives === 4, 'buying 上限残機 grants an immediate +1 life');
assert(state.upgrades.lives === 1, 'upgrade level recorded');
assert((globalThis.localStorage.getItem('cloneman_upgrades') || '').includes('"lives":1'), 'upgrade persisted to localStorage');
window.__cloneman.buyUpgrade('multishot');
assert(state.upgrades.multishot === 1, 'multishot level 1 purchased');

{
  const TI = 32, COLS = 25;
  const idxC = (x, y) => y * COLS + x;
  for (let tx = 7; tx <= 12; tx++) { const i = idxC(tx, 8); state.grid.walls[i] = 0; state.grid.destruct.delete(i); state.grid.pellets[i] = 0; }
  const tanky = { ...makeChaser(11 * TI + 16, 8 * TI + 16, 'tank-test'), hp: 5, maxHp: 5, speed: 0, thinkT: 999, fireCd: 999 };
  state.enemies.push(tanky);
  const pin = () => { state.player.x = 7 * TI + 16; state.player.y = tanky.y; state.player.dir = { x: 1, y: 0 }; state.player.nextDir = { x: 1, y: 0 }; };
  pin();
  press('Space'); step(1); release('Space');
  assert(state.bullets.length === 2, `multishot fires two parallel bullets (got ${state.bullets.length})`);
  assert(state.bullets[0].dmg === 1, 'base damage is 1 before the attack upgrade');
  step(60); // wait out the cooldown
  pin();
  window.__cloneman.buyUpgrade('attack');
  assert(state.upgrades.attack === 1, 'attack upgrade purchased');
  press('Space'); step(1); release('Space');
  const lastDmg = state.bullets[state.bullets.length - 1].dmg;
  assert(lastDmg === 2, `attack upgrade raises damage to 2 (got ${lastDmg})`);
}
window.__cloneman.buyUpgrade('speed');
assert(state.player.speed === 178, `speed upgrade applies +6% immediately (got ${state.player.speed})`);

state.gold = 100;
window.__cloneman.buyUpgrade('gold'); // costs 300 — must fail
assert(state.upgrades.gold === 0, 'upgrade blocked when gold is insufficient');
state.gold = 300;
window.__cloneman.buyUpgrade('gold');
assert(state.upgrades.gold === 1 && state.gold === 0, 'gold upgrade purchased at 300G');

{
  const TI = 32, COLS = 25;
  const idxC = (x, y) => y * COLS + x;
  for (let tx = 7; tx <= 12; tx++) { const i = idxC(tx, 8); state.grid.walls[i] = 0; state.grid.destruct.delete(i); state.grid.pellets[i] = 0; }
  state.gold = 0;
  const prey = { ...makeChaser(10 * TI + 16, 8 * TI + 16, 'gold-target'), hp: 1, maxHp: 1, speed: 0, thinkT: 999, fireCd: 999 };
  state.enemies.push(prey);
  const pin = () => { state.player.x = 7 * TI + 16; state.player.y = prey.y; state.player.dir = { x: 1, y: 0 }; state.player.nextDir = { x: 1, y: 0 }; };
  const stepPin = (n) => { for (let i = 0; i < n; i++) { pin(); step(1); } };
  pin();
  press('Space'); stepPin(1); release('Space');
  stepPin(120);
  assert(state.gold === 5, `gold upgrade turns a kill into 5G (4G x 1.25, got ${state.gold}G)`);
}

// upgrade cost grows geometrically with level (multishot Lv2 = 750G)
{
  state.gold = 10000;
  window.__cloneman.buyUpgrade('multishot'); // currently Lv1 -> cost 750
  assert(state.upgrades.multishot === 2 && state.gold === 9250, `upgrade cost grows with level (Lv2 multishot costs 750G, gold=${state.gold})`);
}

// Park the firing lane: older sub-tests left enemies on row 8 — remove any that
// could be blockers, and keep a bystander far off the lane so the round can't clear.
const parkLane = () => {
  state.enemies = state.enemies.filter(e => e.y < 6 * 32 || e.y > 10 * 32 || e.x > 14 * 32 || e.x < 6 * 32);
  state.enemies.push({ ...makeChaser(3 * 32 + 16, 2 * 32 + 16, 'bystander'), speed: 0, thinkT: 999, fireCd: 999 });
  state.bullets.length = 0;
};

// caps really are big now — multishot Lv4 fires a 5-way volley
{
  const TI = 32, COLS = 25;
  const idxC = (x, y) => y * COLS + x;
  for (let ty = 6; ty <= 10; ty++) for (let tx = 6; tx <= 14; tx++) { const i = idxC(tx, ty); state.grid.walls[i] = 0; state.grid.destruct.delete(i); state.grid.pellets[i] = 0; }
  state.upgrades.multishot = 4;
  state.upgrades.attack = 0;
  state.player.shootCd = 0;
  parkLane();
  const pin = () => { state.player.x = 7 * TI + 16; state.player.y = 8 * TI + 16; state.player.dir = { x: 1, y: 0 }; state.player.nextDir = { x: 1, y: 0 }; };
  pin();
  press('Space'); step(1); release('Space');
  assert(state.bullets.length === 5, `multishot at max fires a 5-way volley (got ${state.bullets.length})`);
  state.upgrades.multishot = 0;
}

// crit: pin the RNG low so every shot is a CRIT (3x damage)
{
  const TI = 32, COLS = 25;
  const idxC = (x, y) => y * COLS + x;
  for (let tx = 7; tx <= 13; tx++) { const i = idxC(tx, 8); state.grid.walls[i] = 0; state.grid.destruct.delete(i); state.grid.pellets[i] = 0; }
  state.upgrades.attack = 0;
  state.upgrades.crit = 1;
  parkLane();
  const tanky = { ...makeChaser(12 * TI + 16, 8 * TI + 16, 'crit-target'), hp: 5, maxHp: 5, speed: 0, thinkT: 999, fireCd: 999 };
  state.enemies.push(tanky);
  state.player.shootCd = 0;
  const pin = () => { state.player.x = 7 * TI + 16; state.player.y = tanky.y; state.player.dir = { x: 1, y: 0 }; state.player.nextDir = { x: 1, y: 0 }; };
  pin();
  const oldRand = Math.random;
  Math.random = () => 0; // pin RNG through the hit (crit rolls at impact, not at fire)
  press('Space'); step(1); release('Space');
  let guard = 0;
  while (tanky.hp === 5 && guard++ < 120) { pin(); step(1); }
  Math.random = oldRand;
  assert(tanky.hp === 2, `crit deals 3x damage (hp=${tanky.hp})`);
  state.upgrades.crit = 0;
}

// pierce: a wall stops a normal shot, a pierce-1 bullet breaks through
{
  const TI = 32, COLS = 25;
  const idxC = (x, y) => y * COLS + x;
  for (let tx = 7; tx <= 13; tx++) { const i = idxC(tx, 8); state.grid.walls[i] = 0; state.grid.destruct.delete(i); state.grid.pellets[i] = 0; }
  state.grid.walls[idxC(9, 8)] = 1;
  state.upgrades.attack = 0;
  state.upgrades.pierce = 0;
  parkLane();
  const tanky = { ...makeChaser(12 * TI + 16, 8 * TI + 16, 'pierce-target'), hp: 5, maxHp: 5, speed: 0, thinkT: 999, fireCd: 999 };
  state.enemies.push(tanky);
  const pin = () => { state.player.x = 7 * TI + 16; state.player.y = tanky.y; state.player.dir = { x: 1, y: 0 }; state.player.nextDir = { x: 1, y: 0 }; };
  pin();
  state.player.shootCd = 0;
  press('Space'); step(1); release('Space');
  let guard = 0;
  while (state.bullets.length && guard++ < 90) { pin(); step(1); }
  assert(tanky.hp === 5, `without pierce, a wall eats the shot (hp=${tanky.hp})`);
  state.upgrades.pierce = 1; // one pierce = one wall OR one enemy
  pin();
  state.player.shootCd = 0;
  press('Space'); step(1); release('Space');
  guard = 0;
  while (tanky.hp === 5 && guard++ < 120) { pin(); step(1); }
  assert(tanky.hp === 4, `piercing bullet crossed the wall and damaged the enemy behind it (hp=${tanky.hp})`);
  state.upgrades.pierce = 2; // one for the enemy, one to fly through
  pin();
  state.player.shootCd = 0;
  press('Space'); step(1); release('Space');
  guard = 0;
  const hpBefore = tanky.hp;
  while (tanky.hp === hpBefore && guard++ < 120) { pin(); step(1); }
  assert(tanky.hp === hpBefore - 1, 'piercing bullet kept flying and hit the enemy');
  assert(state.bullets.length > 0, 'piercing bullet is still alive after flying through the enemy');
  state.upgrades.pierce = 0;
}

// data reset wipes gold + upgrades without refund and persists
{
  state.gold = 1234;
  state.upgrades.lives = 2;
  state.upgrades.multishot = 3;
  window.__cloneman.resetData();
  assert(state.gold === 0, 'data reset wipes gold without refund');
  assert(Object.values(state.upgrades).every(v => v === 0), 'data reset wipes every upgrade level');
  const stored = JSON.parse(globalThis.localStorage.getItem('cloneman_upgrades') || '{}');
  assert(Object.values(stored).every(v => !v), 'data reset persisted to localStorage');
}

console.log('');
console.log('');
if (failures > 0) {
  console.error(`SMOKE TEST FAILED: ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log('SMOKE TEST PASSED ✅');
}
