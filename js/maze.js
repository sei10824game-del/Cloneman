// CLONEMAN — maze definition & grid builder
// Legend:
//   '#' indestructible wall        '.' path with small pellet
//   ',' path without pellet        'o' power pellet
//   '%' destructible block (restored every round)
//   'P' player spawn               'G' ghost spawn (path, no pellet)

export const TILE = 32;
export const COLS = 25;
export const ROWS = 21;
export const WIDTH = COLS * TILE;   // 800
export const HEIGHT = ROWS * TILE;  // 672

export const MAZE_DEF = [
  "#########################",
  "#...........#...........#",
  "#.##.#####.###.#####.##.#",
  "#o..........%..........o#",
  "#.#.#######.#.#######.#.#",
  "#.#.#.%...#.#.#...%.#.#.#",
  "#...#.###.#.#.#.###.#...#",
  "###.#.#...#...#...#.#.###",
  "#.....#...........#.....#",
  "#.###.####.....####.###.#",
  "#.......#..GGG..#.......#",
  "#.......#########.......#",
  "#...#...#.......#...#...#",
  "#...#.%...#.#.#...%.#...#",
  "###.#.###.#.#.#.###.#.###",
  "#.....#...#.P.#...#.....#",
  "#.#####.###.#.###.#####.#",
  "#o..........%..........o#",
  "#.##.#####.###.#####.##.#",
  "#...........#...........#",
  "#########################",
];

export const idx = (x, y) => y * COLS + x;

// Ghost-house box (rows 9-10, cols 9-15): walkable but holds no pellets
const isHouseTile = (x, y) => (y === 9 || y === 10) && x >= 9 && x <= 15;

export function buildFreshGrid() {
  const walls = new Uint8Array(COLS * ROWS);
  const destruct = new Set();          // indices of remaining destructible blocks
  const pellets = new Uint8Array(COLS * ROWS); // 0 none, 1 small, 2 power
  let playerSpawn = { x: 12, y: 15 };
  const ghostSpawns = [];

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = MAZE_DEF[y][x];
      if (ch === '#') {
        walls[idx(x, y)] = 1;
      } else if (ch === '%') {
        destruct.add(idx(x, y));
      } else if (ch === 'o') {
        pellets[idx(x, y)] = 2;
      } else if (ch === '.') {
        if (!isHouseTile(x, y)) pellets[idx(x, y)] = 1;
      } else if (ch === 'P') {
        playerSpawn = { x, y };
      } else if (ch === 'G') {
        ghostSpawns.push({ x, y });
      }
      // ',' and ' ' → walkable, no pellet
    }
  }
  return { walls, destruct, pellets, playerSpawn, ghostSpawns };
}

// Tile center in pixels
export const tileCX = (tx) => tx * TILE + TILE / 2;
export const tileCY = (ty) => ty * TILE + TILE / 2;
