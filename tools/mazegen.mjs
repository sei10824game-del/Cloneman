// Rebuilds the shipped maze from symmetric halves and verifies it matches
// js/maze.js exactly (run: node tools/mazegen.mjs)
const rows = [
  ["############", '#'], // 0
  ["#...........", '#'], // 1
  ["#.##.#####.#", '#'], // 2
  ["#o..........", '.'], // 3
  ["#.#.#######.", '#'], // 4
  ["#.#.#.....#.", '#'], // 5
  ["#...#.###.#.", '#'], // 6
  ["###.#.#...#.", '.'], // 7
  ["#.....#.....", '.'], // 8
  ["#.###.####..", '.'], // 9  ghost-house roof, gate cols 10-14
  ["#.......#..G", 'G'], // 10 house interior, ghosts at 11-13
  ["#.......####", '#'], // 11 house floor
  ["#...#...#...", '.'], // 12
  ["#...#.....#.", '#'], // 13
  ["###.#.###.#.", '#'], // 14
  ["#.....#...#.", '.'], // 15
  ["#.#####.###.", '#'], // 16
  ["#o..........", '.'], // 17
  ["#.##.#####.#", '#'], // 18
  ["#...........", '#'], // 19
  ["############", '#'], // 20
];
const rev = (s) => s.split('').reverse().join('');
const grid = rows.map(([l, c]) => {
  const r = l + c + rev(l);
  if (r.length !== 25) throw new Error(`bad row length ${r.length}: ${r}`);
  return r.split('');
});
for (const [x, y] of [[6, 5], [18, 5], [6, 13], [18, 13], [12, 3], [12, 17]]) grid[y][x] = '%';
grid[15][12] = 'P';

const built = grid.map(r => r.join(''));
const { MAZE_DEF } = await import('../js/maze.js');
let ok = built.length === MAZE_DEF.length;
for (let i = 0; i < built.length && ok; i++) ok = built[i] === MAZE_DEF[i];
console.log(ok ? 'MATCH: generator reproduces js/maze.js ✓' : 'MISMATCH!');
built.forEach((r, i) => console.log(String(i).padStart(2), r));
process.exit(ok ? 0 : 1);
