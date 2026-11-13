// CLONEMAN — クローンマン
// Pac-Man world × straight-line bullet barrage × time-loop clones.
// Clear every enemy to reset the maze and advance; cleared rounds replay
// as friendly clones (no friendly fire). Rounds scale in enemy count & strength.

import {
  TILE, COLS, ROWS, WIDTH, HEIGHT,
  buildFreshGrid, idx, tileCX, tileCY,
} from './maze.js';
import { AudioMan } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const audio = new AudioMan();

const DT = 1 / 60;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CLONE_HUES = [187, 262, 24, 130, 330, 160, 205, 280, 95, 0, 45, 310];

// ---------------------------------------------------------------- HUD refs
const hud = {
  round: document.getElementById('hud-round'),
  score: document.getElementById('hud-score'),
  hi: document.getElementById('hud-hi'),
  lives: document.getElementById('hud-lives'),
  clones: document.getElementById('hud-clones'),
  enemies: document.getElementById('hud-enemies'),
  power: document.getElementById('hud-power'),
};
const bannerEl = document.getElementById('banner');
const bannerTitle = document.getElementById('banner-title');
const bannerSub = document.getElementById('banner-sub');
const overlayTitle = document.getElementById('overlay-title');
const overlayOver = document.getElementById('overlay-over');
const overlayPause = document.getElementById('overlay-pause');
const finalScore = document.getElementById('final-score');
const finalRound = document.getElementById('final-round');
const finalBest = document.getElementById('final-best');
const titleHi = document.getElementById('title-hi');

// ---------------------------------------------------------------- state
const state = {
  mode: 'title',       // 'title' | 'play' | 'clear' | 'over'
  paused: false,
  time: 0,
  round: 1,
  score: 0,
  lives: 3,
  hi: 0,
  grid: buildFreshGrid(),
  player: null,
  clones: [],
  enemies: [],
  spawnQueue: [],
  bullets: [],
  ebullets: [],
  particles: [],
  popups: [],
  powerT: 0,
  shakeT: 0,
  introT: 0,
  clearT: 0,
  recordings: [],
  rec: { frames: [], shots: [] },
  distField: null,
  distFieldT: 0,
};

try { state.hi = parseInt(localStorage.getItem('cloneman_hiscore') || '0', 10) || 0; } catch { state.hi = 0; }

const clampTile = (v, m) => Math.max(0, Math.min(m - 1, v));
const tileOf = (e) => ({ tx: clampTile(Math.floor(e.x / TILE), COLS), ty: clampTile(Math.floor(e.y / TILE), ROWS) });
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ---------------------------------------------------------------- grid utils
function isWall(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  return state.grid.walls[idx(tx, ty)] === 1;
}
function isDestruct(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  return state.grid.destruct.has(idx(tx, ty));
}
function moveSolid(tx, ty) { return isWall(tx, ty) || isDestruct(tx, ty); }

function circleHits(x, y, r, ignoreDestruct = false) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const solid = isWall(tx, ty) || (!ignoreDestruct && isDestruct(tx, ty));
      if (!solid) continue;
      // circle vs tile rect
      const nx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
      const ny = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r) return true;
    }
  }
  return false;
}

// BFS distance field from ALL friendly targets at once (player + active clones).
// Multi-source BFS: every friendly tile starts at distance 0, so enemies naturally
// descend the gradient toward their nearest prey — player and clones alike.
function computeDistField() {
  const d = new Int16Array(COLS * ROWS).fill(-1);
  const q = [];
  const pushTarget = (x, y) => {
    const i = idx(x, y);
    if (d[i] === -1) { d[i] = 0; q.push(i); }
  };
  const p = state.player;
  pushTarget(clampTile(Math.floor(p.x / TILE), COLS), clampTile(Math.floor(p.y / TILE), ROWS));
  for (const c of state.clones) {
    if (c._done || c.fade > 0) continue;
    pushTarget(clampTile(Math.floor(c.x / TILE), COLS), clampTile(Math.floor(c.y / TILE), ROWS));
  }
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % COLS, cy = Math.floor(cur / COLS);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (moveSolid(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (d[ni] !== -1) continue;
      d[ni] = d[cur] + 1;
      q.push(ni);
    }
  }
  state.distField = d;
}

// ---------------------------------------------------------------- round setup
function roundConfig(n) {
  const list = [];
  const chasers = Math.min(2 + n, 5);
  for (let i = 0; i < chasers; i++) list.push('chaser');
  const speedies = n >= 2 ? Math.min(n - 1, 4) : 0;
  for (let i = 0; i < speedies; i++) list.push('speedy');
  const tanks = n >= 3 ? Math.min(n - 2, 3) : 0;
  for (let i = 0; i < tanks; i++) list.push('tank');
  const shooters = n >= 4 ? Math.min(n - 3, 3) : 0;
  for (let i = 0; i < shooters; i++) list.push('shooter');
  // cap and interleave for variety
  while (list.length > 14) list.splice(list.lastIndexOf('chaser'), 1);
  // seeded-ish shuffle: keep it mixed but deterministic per round
  let seed = n * 9301 + 49297;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function enemyStats(type, round) {
  const s = Math.min(1 + 0.06 * (round - 1), 1.5);
  switch (type) {
    case 'chaser':  return { hp: 1 + Math.floor((round - 1) / 4), speed: 92 * s,  score: 100, r: 11, color: '#ff4a3d', name: 'チェイサー' };
    case 'speedy':  return { hp: 1 + Math.floor((round - 1) / 4), speed: 121 * s, score: 150, r: 10.5, color: '#ff7ad9', name: 'スピーディ' };
    case 'tank':    return { hp: 3 + Math.floor(round / 2),       speed: 60 * s,  score: 300, r: 13, color: '#3fa9ff', name: 'タンク' };
    case 'shooter': return { hp: 2 + Math.floor((round - 1) / 3), speed: 84 * s,  score: 200, r: 11, color: '#c07bff', name: 'シューター' };
    default:        return { hp: 1, speed: 90, score: 100, r: 11, color: '#ff4a3d', name: 'チェイサー' };
  }
}

function makeClone(rec, i) {
  return {
    rec,
    roundNo: rec.round,
    hue: CLONE_HUES[i % CLONE_HUES.length],
    f: 0,
    shotIdx: 0,
    x: rec.frames[0].x,
    y: rec.frames[0].y,
    dirX: rec.frames[0].dx,
    dirY: rec.frames[0].dy,
    mouth: 0,
    power: false,
    fade: 0,        // >0 → fading out after replay ends
    alpha: 0.62,
  };
}

function setupRound(n) {
  state.round = n;
  state.grid = buildFreshGrid();
  const sp = state.grid.playerSpawn;

  state.player = {
    x: tileCX(sp.x), y: tileCY(sp.y),
    dir: { x: -1, y: 0 }, nextDir: { x: -1, y: 0 },
    speed: 168, r: 11,
    mouth: 0, shootCd: 0, invT: 0,
  };

  state.enemies = [];
  state.bullets = [];
  state.ebullets = [];
  state.powerT = 0;
  state.shakeT = 0;

  // clones: one per cleared round, replaying the recorded run
  state.clones = [];
  state.recordings.forEach((rec, i) => {
    if (rec.frames.length > 0) state.clones.push(makeClone(rec, i));
  });

  // enemies for this round, spawned from the ghost house over time
  const comp = roundConfig(n);
  state.spawnQueue = comp.map((type, i) => ({ type, delay: 0.6 + i * 0.7 }));

  // fresh recording for this round
  state.rec = { frames: [], shots: [] };
  state.distField = null;
  state.distFieldT = 0;

  state.introT = 1.6;
  state.mode = 'play';
  state.paused = false;

  if (n === 1) {
    showBanner('ROUND 1', '敵をぜんぶ倒せ！ スペースで直線弾', 1.5);
  } else {
    showBanner(`ROUND ${n}`, `クローン ×${state.clones.length} 参戦！ 敵が強く・多くなる`, 1.5);
    audio.cloneSpawn();
  }
  hudUpdate();
}

function startGame() {
  state.score = 0;
  state.lives = 3;
  state.recordings = [];
  state.particles = [];
  state.popups = [];
  hideBanner();
  overlayTitle.classList.add('hidden');
  overlayOver.classList.add('hidden');
  overlayPause.classList.add('hidden');
  setupRound(1);
}

function clearRound() {
  const bonus = 500 * state.round;
  state.score += bonus;
  // store this round's replay (cap 12 recordings; oldest drops off)
  if (state.rec.frames.length > 0) {
    state.recordings.push({ round: state.round, frames: state.rec.frames, shots: state.rec.shots });
    if (state.recordings.length > 12) state.recordings.shift();
  }
  state.bullets = [];
  state.ebullets = [];
  state.powerT = 0;
  state.mode = 'clear';
  state.clearT = 2.8;
  saveHi();
  audio.roundClear();
  showBanner(`ROUND ${state.round} CLEAR!`, `+${bonus}ボーナス — このラウンドの自分がクローンになる`, 2.6);
  burst(state.player.x, state.player.y, 26, '#ffd83d', 190);
  hudUpdate();
}

function saveHi() {
  if (state.score > state.hi) {
    state.hi = state.score;
    try { localStorage.setItem('cloneman_hiscore', String(state.hi)); } catch { /* ignore */ }
  }
}

function gameOver() {
  state.mode = 'over';
  hideBanner();
  saveHi();
  audio.gameOver();
  finalScore.textContent = String(state.score);
  finalRound.textContent = String(state.round);
  finalBest.textContent = String(state.hi);
  setTimeout(() => overlayOver.classList.remove('hidden'), 650);
}

// Clone got caught by an enemy — it fights beside you, but it can die like you
function destroyClone(c) {
  if (c._done) return;
  c._done = true;
  const col = `hsl(${c.hue} 90% 62%)`;
  burst(c.x, c.y, 20, col, 210);
  addPopup(c.x, c.y, `R${c.roundNo} ダウン…`, `hsl(${c.hue} 90% 72%)`, 14);
  audio.cloneDown();
}

// Player got hit: lose a life, everyone retreats to the ghost house
function hitPlayer() {
  const p = state.player;
  if (p.invT > 0 || state.mode !== 'play') return;
  state.lives--;
  audio.playerHit();
  state.shakeT = Math.max(state.shakeT, 0.55);
  burst(p.x, p.y, 22, '#ff5a4e', 220);

  if (state.lives <= 0) {
    burst(p.x, p.y, 42, '#ffd83d', 300);
    hudUpdate();
    gameOver();
    return;
  }
  // respawn player, send surviving ghosts back to the house (staggered)
  const sp = state.grid.playerSpawn;
  p.x = tileCX(sp.x); p.y = tileCY(sp.y);
  p.dir = { x: -1, y: 0 }; p.nextDir = { x: -1, y: 0 };
  p.invT = 2.6; p.shootCd = 0;
  const alive = state.enemies.map(e => e.type);
  state.enemies = [];
  state.ebullets = [];
  state.spawnQueue = alive.map((t, i) => ({ type: t, delay: 0.9 + i * 0.55 }));
  hudUpdate();
}

// ---------------------------------------------------------------- particles & popups
function burst(x, y, n, color, speed = 160) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (0.3 + Math.random() * 0.7) * speed;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.55 + Math.random() * 0.45,
      maxLife: 1.0,
      size: 1.6 + Math.random() * 2.6,
      color,
    });
  }
}
function addPopup(x, y, text, color = '#ffe95a', size = 15) {
  state.popups.push({ x, y, text, color, size, life: 1.15, vy: -36 });
}
function updateParticles(dt) {
  for (const pt of state.particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vx *= (1 - 1.6 * dt); pt.vy *= (1 - 1.6 * dt);
  }
  state.particles = state.particles.filter(pt => pt.life > 0);
  for (const po of state.popups) { po.life -= dt; po.y += po.vy * dt; }
  state.popups = state.popups.filter(po => po.life > 0);
}

// ---------------------------------------------------------------- combat
function firePlayerBullet() {
  const p = state.player;
  const d = (p.dir.x || p.dir.y) ? p.dir : { x: -1, y: 0 };
  const power = state.powerT > 0;
  const bx = p.x + d.x * 15, by = p.y + d.y * 15;
  state.bullets.push({
    x: bx, y: by, vx: d.x * 430, vy: d.y * 430,
    r: power ? 6 : 4.5, dmg: power ? 2 : 1,
    from: 'player', hue: 52, power, life: 2.2,
  });
  p.shootCd = power ? 0.3 : 0.5; // クールタイム長め — クローンとの連携が主軸になる
  audio.shoot();
  // record for the clone replay (frame index = frames.length - 1, pushed this tick)
  if (state.rec.frames.length > 0 && state.rec.frames.length <= 60 * 60 * 6) {
    state.rec.shots.push({ f: state.rec.frames.length - 1, x: bx, y: by, dx: d.x, dy: d.y, pow: power });
  }
  state.particles.push({ x: bx, y: by, vx: d.x * 60, vy: d.y * 60, life: 0.14, maxLife: 0.14, size: 3, color: '#fff3a0' });
}

function fireCloneShot(clone, shot) {
  state.bullets.push({
    x: shot.x, y: shot.y, vx: shot.dx * 430, vy: shot.dy * 430,
    r: shot.pow ? 6 : 4.5, dmg: shot.pow ? 2 : 1,
    from: 'clone', hue: clone.hue, power: shot.pow, life: 2.2,
  });
}

function fireEnemyBullet(e, target) {
  const dx = target.x - e.x, dy = target.y - e.y;
  const len = Math.hypot(dx, dy) || 1;
  state.ebullets.push({
    x: e.x, y: e.y, vx: (dx / len) * 225, vy: (dy / len) * 225,
    r: 5, dmg: 1, life: 4.5,
  });
  audio.enemyHit();
}

function damageEnemy(e, dmg, hitX, hitY) {
  e.hp -= dmg;
  e.flashT = 0.14;
  if (e.hp <= 0) {
    state.score += e.score;
    addPopup(e.x, e.y, `+${e.score}`, '#ffe95a', 16);
    burst(e.x, e.y, e.type === 'tank' ? 22 : 14, e.color, e.type === 'tank' ? 230 : 175);
    audio.enemyDie();
    if (e.type === 'tank') state.shakeT = Math.max(state.shakeT, 0.22);
    e.dead = true;
    saveHi();
  } else {
    audio.enemyHit();
    burst(hitX, hitY, 5, '#ffffff', 120);
  }
}

// ---------------------------------------------------------------- update
function moveEntityAxis(e, dt) {
  const ignoreDestruct = false;
  // X axis
  let nx = e.x + e.vx * dt;
  if (circleHits(nx, e.y, e.r, ignoreDestruct)) { nx = e.x; e.blocked = true; }
  e.x = nx;
  // Y axis
  let ny = e.y + e.vy * dt;
  if (circleHits(e.x, ny, e.r, ignoreDestruct)) { ny = e.y; e.blocked = true; }
  e.y = ny;
}

function tryTurn(e, isPlayer) {
  // only allow direction changes near tile centers (classic feel)
  const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
  const cx = tileCX(tx), cy = tileCY(ty);
  const nd = e.nextDir;
  if (!nd || (nd.x === 0 && nd.y === 0)) return;
  // opposite direction: always allowed
  if (nd.x === -e.dir.x && nd.y === -e.dir.y && (e.dir.x || e.dir.y)) {
    e.dir = { x: nd.x, y: nd.y };
    return;
  }
  if (nd.x !== 0) {
    if (Math.abs(e.y - cy) <= 9 && !moveSolid(tx + nd.x, ty)) {
      e.dir = { x: nd.x, y: 0 };
      e.y = e.y + (cy - e.y) * 0.6;
    }
  } else {
    if (Math.abs(e.x - cx) <= 9 && !moveSolid(tx, ty + nd.y)) {
      e.dir = { x: 0, y: nd.y };
      e.x = e.x + (cx - e.x) * 0.6;
    }
  }
}

function autoCenter(e, dt) {
  const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
  const cx = tileCX(tx), cy = tileCY(ty);
  const snap = 150 * dt;
  if (e.dir.x !== 0 && e.dir.y === 0) {
    const d = cy - e.y;
    if (Math.abs(d) > 0.4) e.y += Math.max(-snap, Math.min(snap, d));
  } else if (e.dir.y !== 0 && e.dir.x === 0) {
    const d = cx - e.x;
    if (Math.abs(d) > 0.4) e.x += Math.max(-snap, Math.min(snap, d));
  }
}

function updatePlayer(dt) {
  const p = state.player;
  p.shootCd -= dt;
  p.invT -= dt;
  state.powerT = Math.max(0, state.powerT - dt);

  tryTurn(p, true);
  autoCenter(p, dt);

  const moving = p.dir.x !== 0 || p.dir.y !== 0;
  const spd = state.powerT > 0 ? 196 : p.speed;
  p.vx = p.dir.x * spd;
  p.vy = p.dir.y * spd;
  p.blocked = false;
  moveEntityAxis(p, dt);

  if (moving) p.mouth += dt * 11;

  // record this frame for the clone replay (before firing, so shot frame indices line up)
  if (state.rec.frames.length <= 60 * 60 * 6) {
    state.rec.frames.push({ x: p.x, y: p.y, dx: p.dir.x, dy: p.dir.y, m: p.mouth, pow: state.powerT > 0 });
  }

  // auto-fire while held
  if (keys.shoot && p.shootCd <= 0) firePlayerBullet();

  // eat pellets
  const tx = clampTile(Math.floor(p.x / TILE), COLS), ty = clampTile(Math.floor(p.y / TILE), ROWS);
  const pi = idx(tx, ty);
  const pellet = state.grid.pellets[pi];
  if (pellet === 1) {
    state.grid.pellets[pi] = 0;
    state.score += 10;
    audio.chomp();
  } else if (pellet === 2) {
    state.grid.pellets[pi] = 0;
    state.score += 50;
    state.powerT = 6;
    audio.power();
    addPopup(p.x, p.y - 14, 'POWER!!', '#7dff6b', 18);
    burst(p.x, p.y, 10, '#7dff6b', 150);
  }

  if (state.score > state.hi) { state.hi = state.score; }
}

function updateClones(dt) {
  const t = state.time;
  for (const c of state.clones) {
    if (c.fade > 0 || c._done) {
      c.fade -= dt * 1.3;
      c.alpha = Math.max(0, 0.62 * Math.max(0, c.fade));
      if (c.fade <= 0) c._done = true;
      continue;
    }
    c.f++;
    const frames = c.rec.frames;
    if (c.f >= frames.length) { c.fade = 1; continue; }
    const fk = frames[c.f];
    c.x = fk.x; c.y = fk.y;
    c.dirX = fk.dx; c.dirY = fk.dy;
    c.mouth = fk.m;
    c.power = fk.pow;
    c.alpha = 0.52 + 0.14 * Math.sin(t * 3 + c.roundNo);
    // fire recorded shots whose frame matches
    const shots = c.rec.shots;
    while (c.shotIdx < shots.length && shots[c.shotIdx].f === c.f) {
      fireCloneShot(c, shots[c.shotIdx]);
      c.shotIdx++;
    }
  }
  state.clones = state.clones.filter(c => !c._done);
}

function spawnEnemy(type) {
  const stats = enemyStats(type, state.round);
  state.enemies.push({
    type,
    x: tileCX(12), y: tileCY(10),   // ghost house centre
    vx: 0, vy: 0,
    dir: { x: 0, y: -1 },
    speed: stats.speed,
    hp: stats.hp, maxHp: stats.hp,
    r: stats.r,
    color: stats.color,
    score: stats.score,
    name: stats.name,
    flashT: 0,
    thinkT: Math.random() * 0.15,
    fireCd: 1.5 + Math.random() * 1.5,
    graceT: 0.7,
    dead: false,
    blocked: false,
  });
}

function chooseGhostDir(e) {
  const { tx, ty } = tileOf(e);
  const frightened = state.powerT > 0;
  const field = state.distField;
  const candidates = [];
  for (const [dx, dy] of DIRS) {
    if (moveSolid(tx + dx, ty + dy)) continue;
    const isReverse = dx === -e.dir.x && dy === -e.dir.y;
    candidates.push({ dx, dy, isReverse, d: field ? field[idx(tx + dx, ty + dy)] : -1 });
  }
  if (candidates.length === 0) return;
  let pool = candidates.filter(c => !c.isReverse);
  if (pool.length === 0) pool = candidates;

  let chosen;
  if (frightened || !field) {
    chosen = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const valid = pool.filter(c => c.d !== -1);
    const use = valid.length ? valid : pool;
    let best = Math.min(...use.map(c => (c.d === -1 ? 9999 : c.d)));
    const bestList = use.filter(c => (c.d === -1 ? 9999 : c.d) === best);
    // prefer continuing straight, then random tie-break
    const straight = bestList.find(c => c.dx === e.dir.x && c.dy === e.dir.y);
    chosen = straight && Math.random() < 0.6 ? straight : bestList[Math.floor(Math.random() * bestList.length)];
  }
  e.dir = { x: chosen.dx, y: chosen.dy };
  // snap perpendicular to center
  const cx = tileCX(tx), cy = tileCY(ty);
  if (chosen.dx !== 0) e.y += (cy - e.y) * 0.75; else e.x += (cx - e.x) * 0.75;
}

function losClear(ex, ey, tx, ty) {
  const dx = Math.sign(tx - ex), dy = Math.sign(ty - ey);
  let cx = ex, cy = ey;
  for (let i = 0; i < 12; i++) {
    cx += dx; cy += dy;
    if (cx === tx && cy === ty) return true;
    if (isWall(cx, cy) || isDestruct(cx, cy)) return false;
  }
  return false;
}

// pick the nearest friendly target (player or clone) in straight line-of-fire
function shooterLineTarget(e) {
  const ex = Math.floor(e.x / TILE), ey = Math.floor(e.y / TILE);
  const targets = [state.player];
  for (const c of state.clones) {
    if (!c._done && c.fade <= 0) targets.push(c);
  }
  let best = null, bestD = Infinity;
  for (const t of targets) {
    const tx = Math.floor(t.x / TILE), ty = Math.floor(t.y / TILE);
    if (ex !== tx && ey !== ty) continue;
    const d = Math.abs(ex - tx) + Math.abs(ey - ty);
    if (d > 9 || d >= bestD) continue;
    if (losClear(ex, ey, tx, ty)) { best = t; bestD = d; }
  }
  return best;
}

function updateEnemies(dt) {
  // spawn from ghost house
  for (const q of state.spawnQueue) q.delay -= dt;
  const ready = state.spawnQueue.filter(q => q.delay <= 0);
  state.spawnQueue = state.spawnQueue.filter(q => q.delay > 0);
  for (const q of ready) spawnEnemy(q.type);

  // refresh shared BFS field periodically
  state.distFieldT -= dt;
  if (state.distFieldT <= 0 || !state.distField) {
    state.distFieldT = 0.25;
    computeDistField();
  }

  const frightened = state.powerT > 0;
  for (const e of state.enemies) {
    e.flashT = Math.max(0, e.flashT - dt);
    e.graceT = Math.max(0, e.graceT - dt);
    e.thinkT -= dt;
    e.fireCd -= dt;

    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    const nearCenter = Math.abs(e.x - tileCX(tx)) < 7 && Math.abs(e.y - tileCY(ty)) < 7;
    if (nearCenter && e.thinkT <= 0) {
      chooseGhostDir(e);
      e.thinkT = 0.16 + Math.random() * 0.08;
    }
    autoCenter(e, dt);

    const spd = e.speed * (frightened ? 0.55 : 1);
    e.vx = e.dir.x * spd;
    e.vy = e.dir.y * spd;
    e.blocked = false;
    moveEntityAxis(e, dt);

    // shooter: fire when it has a clear straight line to any friendly target (player or clone)
    if (e.type === 'shooter' && !frightened && e.fireCd <= 0 && e.graceT <= 0) {
      const tgt = shooterLineTarget(e);
      if (tgt) {
        fireEnemyBullet(e, tgt);
        e.fireCd = 2.7;
      }
    }

    // contact with player or clones (clones are hunted just like the player)
    const p = state.player;
    if (e.graceT <= 0 && !frightened) {
      if (p.invT <= 0 && dist(e.x, e.y, p.x, p.y) < e.r + p.r - 1) hitPlayer();
      for (const c of state.clones) {
        if (c._done || c.fade > 0) continue;
        if (dist(e.x, e.y, c.x, c.y) < e.r + 10.5 - 1) destroyClone(c);
      }
    }
  }
  state.enemies = state.enemies.filter(e => !e.dead);
}

function updateBullets(dt) {
  // player & clone bullets
  for (const b of state.bullets) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) { b.life = 0; continue; }
    if (isWall(tx, ty)) {
      b.life = 0;
      burst(b.x, b.y, 3, '#7de8ff', 90);
      continue;
    }
    if (isDestruct(tx, ty)) {
      // smash the block, restore next round
      state.grid.destruct.delete(idx(tx, ty));
      b.life = 0;
      state.score += 25;
      addPopup(tx * TILE + 16, ty * TILE + 16, '+25', '#ffb84d', 12);
      burst(tx * TILE + 16, ty * TILE + 16, 12, '#ffb84d', 160);
      audio.blockBreak();
      state.shakeT = Math.max(state.shakeT, 0.08);
      continue;
    }
    // hit enemies
    for (const e of state.enemies) {
      if (e.dead || e.graceT > 0.35) continue;
      if (dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
        b.life = 0;
        damageEnemy(e, b.dmg, b.x, b.y);
        break;
      }
    }
  }
  state.bullets = state.bullets.filter(b => b.life > 0);

  // enemy bullets
  const p = state.player;
  for (const b of state.ebullets) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) { b.life = 0; continue; }
    if (isWall(tx, ty)) { b.life = 0; burst(b.x, b.y, 3, '#ff8ad8', 90); continue; }
    // destructible blocks do not stop enemy fire (they're cracked anyway)
    if (p.invT <= 0 && dist(b.x, b.y, p.x, p.y) < b.r + p.r - 1) {
      b.life = 0;
      hitPlayer();
      continue;
    }
    // enemy fire also destroys clones
    for (const c of state.clones) {
      if (c._done || c.fade > 0) continue;
      if (dist(b.x, b.y, c.x, c.y) < b.r + 10.5) {
        b.life = 0;
        destroyClone(c);
        break;
      }
    }
  }
  state.ebullets = state.ebullets.filter(b => b.life > 0);
}

function tick(dt) {
  state.time += dt;
  if (state.shakeT > 0) state.shakeT -= dt;

  if (state.mode === 'title' || state.mode === 'over') {
    updateParticles(dt);
    return;
  }
  if (state.mode === 'clear') {
    state.clearT -= dt;
    updateParticles(dt);
    if (state.clearT <= 0) {
      hideBanner();
      setupRound(state.round + 1);
    }
    return;
  }
  // play mode
  if (state.introT > 0) {
    state.introT -= dt;
    updateParticles(dt);
    if (state.introT <= 0) hideBanner();
    return;
  }

  updatePlayer(dt);
  updateClones(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateParticles(dt);

  // round clear?
  if (state.spawnQueue.length === 0 && state.enemies.length === 0 && state.mode === 'play') {
    clearRound();
  }
  hudUpdate();
}

// ---------------------------------------------------------------- rendering
let wallCache = null;
function buildWallCache() {
  const c = document.createElement('canvas');
  c.width = WIDTH; c.height = HEIGHT;
  const g = c.getContext('2d');

  // backdrop: deep space with center glow
  const bg = g.createRadialGradient(WIDTH / 2, HEIGHT / 2, 60, WIDTH / 2, HEIGHT / 2, 560);
  bg.addColorStop(0, '#0c1234');
  bg.addColorStop(0.55, '#080d24');
  bg.addColorStop(1, '#04060f');
  g.fillStyle = bg;
  g.fillRect(0, 0, WIDTH, HEIGHT);

  // wall blocks
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (state.grid.walls[idx(x, y)] !== 1) continue;
      const px = x * TILE, py = y * TILE;
      g.fillStyle = '#111b44';
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = '#0d1533';
      g.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
    }
  }
  // neon edges where wall meets open space
  g.save();
  g.strokeStyle = '#3ae2ff';
  g.shadowColor = '#1ec8ff';
  g.shadowBlur = 9;
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  const open = (x, y) => !isWall(x, y);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (state.grid.walls[idx(x, y)] !== 1) continue;
      const px = x * TILE, py = y * TILE;
      g.beginPath();
      if (open(x, y - 1)) { g.moveTo(px + 2, py + 2.5); g.lineTo(px + TILE - 2, py + 2.5); }
      if (open(x, y + 1)) { g.moveTo(px + 2, py + TILE - 2.5); g.lineTo(px + TILE - 2, py + TILE - 2.5); }
      if (open(x - 1, y)) { g.moveTo(px + 2.5, py + 2); g.lineTo(px + 2.5, py + TILE - 2); }
      if (open(x + 1, y)) { g.moveTo(px + TILE - 2.5, py + 2); g.lineTo(px + TILE - 2.5, py + TILE - 2); }
      g.stroke();
    }
  }
  g.restore();

  // ghost house gate (pink bar)
  g.save();
  g.fillStyle = '#ff9ad5';
  g.shadowColor = '#ff6ec7';
  g.shadowBlur = 8;
  g.fillRect(10 * TILE + 2, 9 * TILE + TILE / 2 - 2, 5 * TILE - 4, 4);
  g.restore();

  wallCache = c;
}

function drawDestructibles(g) {
  for (const i of state.grid.destruct) {
    const tx = i % COLS, ty = Math.floor(i / COLS);
    const px = tx * TILE, py = ty * TILE;
    g.save();
    // body
    g.fillStyle = '#3a2a10';
    g.strokeStyle = '#ffb84d';
    g.lineWidth = 2;
    g.shadowColor = '#ff9d2e';
    g.shadowBlur = 8;
    roundRect(g, px + 3, py + 3, TILE - 6, TILE - 6, 6);
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    // hazard stripes
    g.strokeStyle = 'rgba(255, 200, 90, 0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px + 8, py + TILE - 9); g.lineTo(px + TILE - 9, py + 8);
    g.moveTo(px + 14, py + TILE - 5); g.lineTo(px + TILE - 5, py + 14);
    g.stroke();
    // cracks (seeded by tile)
    let seed = (tx * 73856093) ^ (ty * 19349663);
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    g.strokeStyle = '#1c130a';
    g.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      const ax = px + 7 + rnd() * (TILE - 14), ay = py + 7 + rnd() * (TILE - 14);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ax + (rnd() - 0.5) * 16, ay + (rnd() - 0.5) * 16);
      g.lineTo(ax + (rnd() - 0.5) * 24, ay + (rnd() - 0.5) * 24);
      g.stroke();
    }
    // rivets
    g.fillStyle = '#ffd88a';
    for (const [rx, ry] of [[7, 7], [TILE - 7, 7], [7, TILE - 7], [TILE - 7, TILE - 7]]) {
      g.beginPath(); g.arc(px + rx, py + ry, 1.6, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawPellets(g, t) {
  const pellets = state.grid.pellets;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = pellets[idx(x, y)];
      if (v === 0) continue;
      const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
      if (v === 1) {
        const a = 0.7 + 0.3 * Math.sin(t * 4 + (x * 0.7 + y * 1.3));
        g.globalAlpha = a;
        g.fillStyle = '#ffcf9e';
        g.beginPath(); g.arc(cx, cy, 2.7, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      } else {
        const pulse = 1 + 0.22 * Math.sin(t * 5.5);
        g.save();
        g.shadowColor = '#ffe27a';
        g.shadowBlur = 16;
        g.fillStyle = '#ffe9a8';
        g.beginPath(); g.arc(cx, cy, 6.6 * pulse, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
  }
}

function drawPacShape(g, x, y, r, dirAngle, mouthAngle, fill, glow) {
  g.save();
  g.translate(x, y);
  g.rotate(dirAngle);
  g.shadowColor = glow;
  g.shadowBlur = 16;
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, r, mouthAngle, Math.PI * 2 - mouthAngle);
  g.closePath();
  g.fill();
  g.restore();
}

function drawPlayer(g, t) {
  const p = state.player;
  if (state.mode === 'over') return; // consumed by explosion
  const blink = p.invT > 0 ? 0.35 + 0.4 * Math.abs(Math.sin(t * 12)) : 1;
  const dirAngle = p.dir.x === 1 ? 0 : p.dir.x === -1 ? Math.PI : p.dir.y === 1 ? Math.PI / 2 : p.dir.y === -1 ? -Math.PI / 2 : 0;
  const moving = p.dir.x !== 0 || p.dir.y !== 0;
  const mouth = moving || state.mode === 'title'
    ? 0.06 + Math.abs(Math.sin((state.mode === 'title' ? t * 5 : p.mouth))) * 0.32 * Math.PI
    : 0.16 * Math.PI;
  g.save();
  g.globalAlpha = blink;
  const power = state.powerT > 0;
  drawPacShape(g, p.x, p.y, power ? p.r + 1.5 : p.r, dirAngle, mouth,
    power ? '#fff3a0' : '#ffd83d', power ? '#fff06a' : '#ffce1f');
  g.restore();
  if (power) {
    g.save();
    g.globalAlpha = blink * (0.5 + 0.3 * Math.sin(t * 10));
    g.strokeStyle = '#7dff6b';
    g.lineWidth = 2;
    g.beginPath(); g.arc(p.x, p.y, p.r + 5 + Math.sin(t * 10) * 1.5, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
}

function drawClone(g, c) {
  const fkAngle = c.dirX === 1 ? 0 : c.dirX === -1 ? Math.PI : c.dirY === 1 ? Math.PI / 2 : c.dirY === -1 ? -Math.PI / 2 : 0;
  const mouth = 0.1 + Math.abs(Math.sin(c.mouth)) * 0.3 * Math.PI;
  const color = `hsl(${c.hue} 90% 62%)`;
  g.save();
  g.globalAlpha = c.alpha;
  g.shadowColor = color;
  g.shadowBlur = 12;
  g.fillStyle = color;
  g.translate(c.x, c.y);
  g.rotate(fkAngle);
  g.beginPath();
  g.moveTo(0, 0);
  g.arc(0, 0, 10.5, mouth, Math.PI * 2 - mouth);
  g.closePath();
  g.fill();
  g.restore();
  // round tag
  g.save();
  g.globalAlpha = Math.min(1, c.alpha + 0.15);
  g.fillStyle = color;
  g.font = 'bold 9px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText(`R${c.roundNo}`, c.x, c.y - 14);
  g.restore();
}

function drawGhost(g, e, t) {
  const frightened = state.powerT > 0;
  const r = e.r;
  let color = e.color;
  if (frightened) color = '#2438ff';
  if (e.flashT > 0) color = '#ffffff';
  const spawnScale = e.graceT > 0 ? 0.6 + 0.4 * (1 - e.graceT / 0.7) : 1;

  g.save();
  g.translate(e.x, e.y);
  g.scale(spawnScale, spawnScale);
  g.shadowColor = color;
  g.shadowBlur = 12;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-r, r * 0.72);
  g.lineTo(-r, -r * 0.1);
  g.arc(0, -r * 0.1, r, Math.PI, 0);
  g.lineTo(r, r * 0.72);
  // skirt: 4 zigzag bumps
  const bumps = 4, seg = (2 * r) / bumps;
  for (let i = 0; i < bumps; i++) {
    const x0 = r - i * seg;
    const x1 = x0 - seg / 2;
    const x2 = x0 - seg;
    const wob = Math.sin(t * 9 + i * 1.7 + e.x * 0.01) * 1.6;
    g.lineTo(x1, r * 0.42 + wob);
    g.lineTo(x2, r * 0.72);
  }
  g.closePath();
  g.fill();
  g.restore();

  // face
  g.save();
  g.translate(e.x, e.y);
  g.scale(spawnScale, spawnScale);
  if (frightened) {
    // scared face: pale dots + wavy mouth
    g.fillStyle = '#ffd9c9';
    g.beginPath(); g.arc(-r * 0.36, -r * 0.12, 2.1, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(r * 0.36, -r * 0.12, 2.1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffd9c9';
    g.lineWidth = 1.6;
    g.beginPath();
    const my = r * 0.38;
    g.moveTo(-r * 0.55, my);
    for (let i = 1; i <= 6; i++) {
      g.lineTo(-r * 0.55 + (i * r * 1.1) / 6, my + (i % 2 === 0 ? 0 : -3.2));
    }
    g.stroke();
  } else {
    // eyes look toward movement direction
    const lookX = e.dir.x * 2.3, lookY = e.dir.y * 2.3;
    for (const side of [-1, 1]) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(side * r * 0.38, -r * 0.12, r * 0.24, r * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a2bff';
      g.beginPath();
      g.arc(side * r * 0.38 + lookX, -r * 0.12 + lookY, r * 0.13, 0, Math.PI * 2);
      g.fill();
    }
  }
  // tank: hp pips above
  if (e.type === 'tank' && e.maxHp > 1) {
    g.fillStyle = '#9fdcff';
    const w = e.maxHp * 5;
    for (let i = 0; i < e.hp; i++) {
      g.fillRect(-w / 2 + i * 5, -r - 7, 3.4, 2.4);
    }
  }
  g.restore();
}

function drawBullets(g) {
  for (const b of state.bullets) {
    const col = `hsl(${b.hue} 100% ${b.power ? 72 : 60}%)`;
    g.save();
    g.shadowColor = col;
    g.shadowBlur = 12;
    g.fillStyle = col;
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  for (const b of state.ebullets) {
    g.save();
    g.shadowColor = '#ff5fd2';
    g.shadowBlur = 13;
    g.fillStyle = '#ff8ae2';
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a1e6e';
    g.beginPath(); g.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

function drawParticles(g) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const pt of state.particles) {
    const a = Math.max(0, pt.life / (pt.maxLife || 1));
    g.globalAlpha = a;
    g.fillStyle = pt.color;
    g.beginPath(); g.arc(pt.x, pt.y, pt.size * a + 0.4, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  g.globalAlpha = 1;
}

function drawPopups(g) {
  g.save();
  g.textAlign = 'center';
  for (const po of state.popups) {
    g.globalAlpha = Math.max(0, Math.min(1, po.life));
    g.font = `bold ${po.size}px "Arial Black", Arial, sans-serif`;
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 3;
    g.strokeText(po.text, po.x, po.y);
    g.fillStyle = po.color;
    g.fillText(po.text, po.x, po.y);
  }
  g.restore();
  g.globalAlpha = 1;
}

function render(t) {
  if (!wallCache) buildWallCache();
  ctx.save();
  if (state.shakeT > 0) {
    const m = state.shakeT * 9;
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }
  ctx.drawImage(wallCache, 0, 0);
  drawDestructibles(ctx);
  drawPellets(ctx, t);

  for (const c of state.clones) { if (!c._done) drawClone(ctx, c); }
  for (const e of state.enemies) drawGhost(ctx, e, t);
  drawPlayer(ctx, t);
  drawBullets(ctx);
  drawParticles(ctx);
  drawPopups(ctx);

  ctx.restore();
}

// ---------------------------------------------------------------- HUD & banner
function setText(el, v) {
  if (el && el._v !== v) { el._v = v; el.textContent = v; }
}
function hudUpdate() {
  setText(hud.round, String(state.round));
  setText(hud.score, String(state.score));
  setText(hud.hi, String(Math.max(state.hi, state.score)));
  // live clones on the field (destroyed ones vanish from the count)
  setText(hud.clones, String(state.clones.filter(c => !c._done && c.fade <= 0).length));
  setText(hud.enemies, String(state.enemies.length + state.spawnQueue.length));
  const livesStr = String(Math.max(0, state.lives));
  if (hud.lives._n !== livesStr) {
    hud.lives._n = livesStr;
    hud.lives.innerHTML = '';
    for (let i = 0; i < state.lives; i++) {
      const d = document.createElement('div');
      d.className = 'life';
      hud.lives.appendChild(d);
    }
  }
  if (hud.power) hud.power.classList.toggle('hidden', state.powerT <= 0);
}

let bannerTimer = null;
function showBanner(title, sub, seconds = 1.6) {
  bannerTitle.textContent = title;
  bannerSub.textContent = sub || '';
  bannerEl.classList.remove('hidden', 'show');
  void bannerEl.offsetWidth; // restart CSS animation
  bannerEl.classList.add('show');
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, seconds * 1000);
}
function hideBanner() {
  bannerEl.classList.add('hidden');
  bannerEl.classList.remove('show');
}

// ---------------------------------------------------------------- input
const keys = { shoot: false };
const DIR_KEYS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
};
const SHOOT_KEYS = new Set(['Space', 'KeyZ', 'KeyJ', 'KeyX']);

window.addEventListener('keydown', (ev) => {
  const code = ev.code;
  if (DIR_KEYS[code] || SHOOT_KEYS.has(code)) ev.preventDefault();

  if (DIR_KEYS[code] && state.player) {
    const [x, y] = DIR_KEYS[code];
    state.player.nextDir = { x, y };
    return;
  }
  if (SHOOT_KEYS.has(code)) { keys.shoot = true; return; }
  if (code === 'KeyP' || code === 'Escape') { togglePause(); return; }
  if (code === 'KeyM') { audio.setMuted(!audio.muted); return; }
  if (code === 'Enter') {
    if (state.mode === 'title') { audio.ensure(); audio.uiStart(); startGame(); }
    else if (state.mode === 'over') { audio.ensure(); audio.uiStart(); startGame(); }
  }
});
window.addEventListener('keyup', (ev) => {
  if (SHOOT_KEYS.has(ev.code)) keys.shoot = false;
});

function togglePause() {
  if (state.mode !== 'play') return;
  state.paused = !state.paused;
  overlayPause.classList.toggle('hidden', !state.paused);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.shoot = false;
    if (state.mode === 'play' && !state.paused) togglePause();
  }
});

document.getElementById('btn-start').addEventListener('click', () => {
  audio.ensure(); audio.uiStart(); startGame();
});
document.getElementById('btn-restart').addEventListener('click', () => {
  audio.ensure(); audio.uiStart(); startGame();
});

// ---------------------------------------------------------------- main loop
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (!state.paused) {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 6) {
      tick(DT);
      acc -= DT;
      steps++;
    }
    if (steps === 6) acc = 0;
  }
  render(now / 1000);
}

// boot: prepare an idle scene behind the title overlay
state.grid = buildFreshGrid();
{
  const sp = state.grid.playerSpawn;
  state.player = {
    x: tileCX(sp.x), y: tileCY(sp.y),
    dir: { x: -1, y: 0 }, nextDir: { x: -1, y: 0 },
    speed: 168, r: 11, mouth: 0, shootCd: 0, invT: 0,
  };
}
buildWallCache();
setText(hud.hi, String(state.hi));
setText(titleHi, String(state.hi));
hudUpdate();
requestAnimationFrame(frame);

// debug / smoke-test handle (harmless in production; used by tools/smoke.mjs)
window.__cloneman = { state, startGame, setupRound, togglePause };
