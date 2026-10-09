/**
 * @file Maze logic: a grid of walls and colored regions with a guaranteed path
 * from START (upper left) to END (bottom right), plus the drawing code shared by
 * the game and the "How to play" icons. Loaded by the page and by worker.js.
 *
 * Light rules:
 * - The player starts WHITE, which counts as "no color".
 * - A player can always walk on WHITE squares. A colored player can also walk on
 *   any color made only of their own primaries: RED walks on red; MAGENTA
 *   (red + blue) walks on magenta, red and blue, but not green.
 * - COLOR_CHANGE squares are the doorways between regions, placed far from
 *   where the player enters a region. Anyone can step onto one (keeping their
 *   color while on it), and step off it onto any square, in any direction,
 *   taking on that square's color. The new color replaces the old one.
 *   TODO(expert mode): mix instead of replace (red + blue = magenta).
 * - Each non-white color is one connected region, and the player must become
 *   every color to finish.
 * - Each pair of neighboring regions touches in exactly floor(log10(size × size))
 *   places: one COLOR_CHANGE doorway, and openings that the color rules block.
 *   So there are several ways between two colors, but following the color
 *   rules there is exactly one route through the maze.
 */

/**
 * One square of the grid: WALL, COLOR_CHANGE, a color name such as "RED", or a
 * start/end marker object.
 * @typedef {string | {color: string, marker: string}} Square
 */

/**
 * A grid position as [row, col]. Passages sit on odd rows and columns; the
 * squares between them are walls or openings.
 * @typedef {[number, number]} Cell
 */

/**
 * A finished maze, as returned by buildGrid().
 * @typedef {object} Maze
 * @property {Square[][]} grid Rows of squares.
 * @property {string[]} palette The colors in the order their regions come, from start to end.
 * @property {Cell[]} path The shortest solution, square by square.
 * @property {Cell[]} changers Every COLOR_CHANGE doorway.
 */

/**
 * Row and column sizes at one zoom level, in device pixels. Made by geometry().
 * @typedef {object} Geometry
 * @property {number} path Width of a passage row or column.
 * @property {number} wall Width of a wall row or column.
 * @property {number} dpr Device pixels per CSS pixel.
 * @property {function(number): number} pos Left/top edge of row or column k.
 * @property {function(number): number} span Width of row or column k.
 * @property {function(number, number): [number, number]} center Center [x, y] of the square at (r, c).
 */

/**
 * A lattice of `m` × `m` region numbers, one per passage square; region 0 holds
 * the start and region count - 1 the end.
 * @typedef {number[][]} RegionMap
 */

/**
 * Splits the passage lattice into color regions. All layouts share this shape.
 * @callback RegionStyle
 * @param {number} m Lattice nodes per side.
 * @param {number} count How many regions.
 * @param {[number, number]} start The start's lattice node.
 * @param {[number, number]} end The end's lattice node.
 * @param {number} minTouch How many places each pair of neighboring regions must touch.
 * @returns {?RegionMap} The regions, or null if this random attempt didn't work out.
 */

/** A wall square. */
const WALL = "WALL";
/** A doorway between two regions. Flashes between the colors of the squares it touches. */
const COLOR_CHANGE = "COLOR_CHANGE";
// Start and end keep their region color and carry a marker:
//   {color: "WHITE", marker: "START"}   drawn as a doorway arch
//   {color: "BLUE", marker: "END"}      drawn as a star
/** Marker for the start square. */
const START = "START";
/** Marker for the end square. */
const END = "END";

/**
 * Each color's on-screen value. Additive (light) model: primaries red/green/blue,
 * secondaries cyan/magenta/yellow, and white = all primaries combined.
 * Slightly softened from pure #ff0000 etc., which is harsh next to white.
 * @type {Object<string, string>}
 */
const RGB = {
  RED: "#e63946",
  GREEN: "#2fbf71",
  BLUE: "#3a6ff7",
  CYAN: "#22c3d6",
  MAGENTA: "#d64fc9",
  YELLOW: "#f5cc2a",
  WHITE: "#ffffff",
};
/**
 * Which primaries make up each color, as bits: red = 1, green = 2, blue = 4.
 * @type {Object<string, number>}
 */
const MASK = { RED: 1, GREEN: 2, BLUE: 4, YELLOW: 3, MAGENTA: 5, CYAN: 6, WHITE: 7 };
const PRIMARY = ["RED", "GREEN", "BLUE"];
const SECONDARY = ["CYAN", "MAGENTA", "YELLOW"];
const COLOR_NAMES = Object.keys(RGB);
/** White plus every primary and secondary. */
const MAX_COLORS = 1 + PRIMARY.length + SECONDARY.length;
/** Smallest maze size (squares per side). */
const MIN_SIZE = 5;
/**
 * Smallest maze that reliably fits one region per color (measured, plus a little margin).
 * @type {Object<number, number>}
 */
const MIN_SIZE_FOR_COLORS = { 1: 5, 2: 5, 3: 9, 4: 15, 5: 21, 6: 25, 7: 31 };
/** Largest maze size (squares per side). */
const MAX_SIZE = 250;

// TODO: seeded randomness (?seed=…) so a maze can be replayed and shared. Every
// random draw goes through Math.random, here and in the region layouts below.
/**
 * Pick a random item.
 *
 * @template T
 * @param {T[]} items The items to choose from; must not be empty.
 * @returns {T} One of them.
 */
function choice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Shuffle a copy of a list (Fisher–Yates).
 *
 * @template T
 * @param {T[]} items The items to shuffle; left unchanged.
 * @returns {T[]} A new array with the same items in random order.
 */
function shuffle(items) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * Choose which colors a maze uses: the first `count` colors of this sequence:
 *   1. white
 *   2. red (P1)
 *   3. a secondary containing P1 (S1)
 *   4. the other primary in S1 (P2)
 *   5. the last primary (P3)
 *   6. a secondary containing P3 (S2)
 *   7. the last secondary (S3)
 * regionOrder() then decides the order of the regions.
 *
 * @param {number} count How many colors, white included (1 to MAX_COLORS).
 * @returns {string[]} The colors, starting with "WHITE".
 * @throws {RangeError} If `count` is out of range.
 */
function pickPalette(count) {
  if (!(count >= 1 && count <= MAX_COLORS)) {
    throw new RangeError(`number of colors must be between 1 and ${MAX_COLORS}`);
  }
  const contains = (secondary, primary) => (MASK[secondary] & MASK[primary]) !== 0;
  const p1 = "RED";
  const s1 = choice(SECONDARY.filter((s) => contains(s, p1)));
  const p2 = PRIMARY.find((p) => p !== p1 && contains(s1, p));
  const p3 = PRIMARY.find((p) => p !== p1 && p !== p2);
  const s2 = choice(SECONDARY.filter((s) => s !== s1 && contains(s, p3)));
  const s3 = SECONDARY.find((s) => s !== s1 && s !== s2);
  return ["WHITE", p1, s1, p2, p3, s2, s3].slice(0, count);
}

/**
 * The color of a square, looking inside start/end marker objects.
 *
 * @param {Square} value The square.
 * @returns {string} Its color, or WALL / COLOR_CHANGE as they are.
 */
function colorOf(value) {
  return typeof value === "object" ? value.color : value;
}

/**
 * The player's color after moving from one square to the next.
 *
 * @param {string} player The player's current color, e.g. "RED".
 * @param {Square} from The square being left.
 * @param {Square} to The square being entered.
 * @param {?string} [forbid=null] A color the player may not take on; used to
 *     check that every color is needed.
 * @returns {?string} The new color, or null if the move isn't allowed.
 */
function step(player, from, to, forbid = null) {
  if (to === WALL) return null;
  if (to === COLOR_CHANGE) return player;
  if (from === COLOR_CHANGE) return colorOf(to) === forbid ? null : colorOf(to);
  return canEnter(player, colorOf(to)) ? player : null;
}

/**
 * Whether a player of one color may step onto a square of another.
 *
 * @param {string} player The player's color.
 * @param {string} square The square's color.
 * @returns {boolean} True if the move is allowed.
 */
function canEnter(player, square) {
  if (square === "WHITE") return true;
  if (player === "WHITE") return false; // white is "no color"
  return (MASK[square] & ~MASK[player]) === 0;
}

/**
 * The start and end squares: the upper-left and bottom-right open cells.
 * Passages sit on odd coordinates, so the outermost usable index is the largest odd one.
 *
 * @param {number} size Squares per side.
 * @returns {[Cell, Cell]} [start, end].
 */
function corners(size) {
  const last = size % 2 ? size - 2 : size - 3;
  return [[1, 1], [last, last]];
}

/**
 * Order the non-white colors so each region needs a new color.
 *
 * A color that sits right after one containing it (red after magenta) could be
 * walked through without changing. The first color (red) always comes right
 * after white. Primaries before secondaries always works; shuffling a few times
 * first gives more variety.
 *
 * @param {string[]} colors The non-white colors from pickPalette(), red first.
 * @returns {string[]} The same colors in region order.
 */
function regionOrder(colors) {
  const [first, ...rest] = colors;
  if (first === undefined) return [];
  for (let i = 0; i < 20; i++) {
    const order = [first, ...shuffle(rest)];
    if (order.every((c, j) => j === 0 || !canEnter(order[j - 1], c))) return order;
  }
  return [first, ...rest.filter((c) => PRIMARY.includes(c)), ...rest.filter((c) => SECONDARY.includes(c))];
}

/**
 * The "bands" layout: split the lattice into `count` equal-size bands running
 * diagonally from the upper left to the bottom right, with wavy edges.
 * TODO(expert mode): allow several separate regions per color.
 *
 * @type {RegionStyle}
 */
function bandLattice(m, count, start, end, minTouch) {
  const wave = () => ({ amp: (0.35 / count) * Math.random(), freq: 1 + Math.random() * 2, phase: Math.random() * 2 * Math.PI });
  const waves = [wave(), wave()];
  const span = Math.max(1, 2 * (m - 1));
  const nodes = [];
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const along = (i + j) / span; // 0 at upper left, 1 at bottom right
      const across = (i - j) / span;
      let t = along;
      for (const w of waves) t += w.amp * Math.sin(2 * Math.PI * w.freq * across + w.phase);
      nodes.push({ i, j, t });
    }
  }
  nodes.sort((a, b) => a.t - b.t);
  const band = Array.from({ length: m }, () => Array(m).fill(0));
  nodes.forEach((n, rank) => (band[n.i][n.j] = Math.floor((rank * count) / nodes.length)));
  return band;
}

/**
 * The lattice nodes next to (i, j), up/down/left/right, inside the lattice.
 *
 * @param {number} m Lattice nodes per side.
 * @param {number} i Row.
 * @param {number} j Column.
 * @returns {Array<[number, number]>} The neighbors.
 */
function latticeNeighbors(m, i, j) {
  return STEPS.map(([di, dj]) => [i + di, j + dj]).filter(([a, b]) => a >= 0 && a < m && b >= 0 && b < m);
}

/**
 * How many lattice-neighbor pairs join each pair of regions.
 *
 * @param {number} m Lattice nodes per side.
 * @param {RegionMap} region The regions.
 * @returns {Map<string, number>} Counts keyed "a,b" with a < b.
 */
function touching(m, region) {
  const touch = new Map();
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (const [ni, nj] of [[i + 1, j], [i, j + 1]]) {
        if (ni < m && nj < m && region[i][j] !== region[ni][nj]) {
          const key = [region[i][j], region[ni][nj]].sort((a, b) => a - b).join();
          touch.set(key, (touch.get(key) || 0) + 1);
        }
      }
    }
  }
  return touch;
}

/**
 * Every ordering of a list.
 *
 * @template T
 * @param {T[]} items The items; keep this short, since there are n! orderings.
 * @returns {T[][]} All permutations.
 */
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((x, k) => permutations([...items.slice(0, k), ...items.slice(k + 1)]).map((p) => [x, ...p]));
}

/**
 * The "blobs" layout: regions grown outward from scattered seed points, like
 * countries on a map. The start's blob comes first and the end's blob last; the
 * blobs in between are put in any order where each blob touches the next in at
 * least `minTouch` places. Returns null if no such order exists.
 *
 * @type {RegionStyle}
 */
function blobLattice(m, count, start, end, minTouch) {
  if (count === 1) return Array.from({ length: m }, () => Array(m).fill(0));
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  // Spread the seeds out: each new seed is the farthest of a few random candidates.
  const seeds = [start];
  while (seeds.length < count) {
    const candidates = Array.from({ length: 12 }, () => [Math.floor(Math.random() * m), Math.floor(Math.random() * m)]);
    const score = (n) => Math.min(...seeds.map((s) => dist(n, s)));
    seeds.push(candidates.reduce((best, n) => (score(n) > score(best) ? n : best)));
  }
  if (new Set(seeds.map((s) => s.join())).size < count) return null;
  const region = Array.from({ length: m }, () => Array(m).fill(-1));
  const frontier = seeds.map(([i, j], k) => {
    region[i][j] = k;
    return latticeNeighbors(m, i, j);
  });
  const sizes = Array(count).fill(1);
  // Always grow the smallest blob that still can, so sizes stay even.
  for (;;) {
    const growing = [...Array(count).keys()].filter((k) => frontier[k].length);
    if (!growing.length) break;
    const k = growing.reduce((a, b) => (sizes[b] < sizes[a] || (sizes[b] === sizes[a] && Math.random() < 0.5) ? b : a));
    const f = frontier[k];
    const pick = Math.floor(Math.random() * f.length);
    [f[pick], f[f.length - 1]] = [f[f.length - 1], f[pick]];
    const [i, j] = f.pop();
    if (region[i][j] !== -1) continue;
    region[i][j] = k;
    sizes[k]++;
    for (const n of latticeNeighbors(m, i, j)) if (region[n[0]][n[1]] === -1) f.push(n);
  }

  const first = region[start[0]][start[1]];
  const last = region[end[0]][end[1]];
  if (first === last) return null;
  const touch = touching(m, region);
  const middle = [...Array(count).keys()].filter((k) => k !== first && k !== last);
  for (const mid of shuffle(permutations(middle))) {
    const chain = [first, ...mid, last];
    const linked = chain.slice(1).every((k, n) => (touch.get([chain[n], k].sort((a, b) => a - b).join()) || 0) >= minTouch);
    if (linked) {
      const position = new Map(chain.map((k, n) => [k, n]));
      return region.map((row) => row.map((k) => position.get(k)));
    }
  }
  return null;
}

/**
 * The "tendrils" layout: regions that follow the solution of one big maze, so
 * colors interlock like fingers. Carve a maze over the whole lattice, cut its
 * start-to-end path into `count` stretches of about equal weight, and give every
 * dead-end branch the region of the path square it hangs off.
 *
 * @type {RegionStyle}
 */
function tendrilLattice(m, count, start, end, minTouch) {
  const key = (i, j) => i * m + j;
  // One big maze (randomized depth-first search), remembering each square's parent.
  const parent = new Map([[key(...start), -1]]);
  const stack = [start];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const next = latticeNeighbors(m, ...cur).filter(([i, j]) => !parent.has(key(i, j)));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const n = choice(next);
    parent.set(key(...n), key(...cur));
    stack.push(n);
  }
  const path = [key(...end)];
  while (parent.get(path[path.length - 1]) !== -1) path.push(parent.get(path[path.length - 1]));
  path.reverse();
  const onPath = new Map(path.map((n, k) => [n, k]));

  // Which path square each branch hangs off, and how much hangs off each.
  const children = new Map();
  for (const [n, p] of parent) if (p !== -1) children.set(p, [...(children.get(p) || []), n]);
  const attach = new Int32Array(m * m);
  const weight = Array(path.length).fill(0);
  path.forEach((p, k) => {
    const todo = [p];
    while (todo.length) {
      const n = todo.pop();
      attach[n] = k;
      weight[k]++;
      for (const c of children.get(n) || []) if (!onPath.has(c)) todo.push(c);
    }
  });

  // Cut the path where the running total passes each 1/count share.
  const total = m * m;
  const cuts = [];
  let running = 0;
  weight.forEach((w, k) => {
    running += w;
    if (cuts.length < count - 1 && running >= (total * (cuts.length + 1)) / count && k < path.length - 1) cuts.push(k);
  });
  if (cuts.length < count - 1) return null;
  const segment = path.map((_, k) => cuts.filter((c) => k > c).length);
  const region = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => segment[attach[key(i, j)]]));
  const sizes = Array(count).fill(0);
  region.forEach((row) => row.forEach((k) => sizes[k]++));
  if (Math.min(...sizes) < (0.5 * total) / count) return null; // one branch was too big to split evenly
  const touch = touching(m, region);
  for (let k = 0; k + 1 < count; k++) if ((touch.get(`${k},${k + 1}`) || 0) < minTouch) return null;
  return region;
}

/**
 * How the board is split into color regions, by layout name.
 * @type {Object<string, RegionStyle>}
 */
const REGION_STYLES = { bands: bandLattice, blobs: blobLattice, tendrils: tendrilLattice };

/** The four moves as [row, col] steps: up, down, left, right. */
const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * One attempt at a full layout: split the board into regions, carve each region
 * as its own maze, and place a COLOR_CHANGE doorway from each region to the next.
 *
 * @param {number} size Squares per side.
 * @param {string[]} order The non-white colors in region order.
 * @param {string} [style="bands"] A key of REGION_STYLES.
 * @returns {?{grid: Square[][], changers: Cell[]}} The grid and its doorways, or
 *     null if this random layout doesn't work out.
 */
function layout(size, order, style = "bands") {
  const [start, end] = corners(size);
  const m = (end[1] + 1) / 2; // lattice nodes per side
  const colors = ["WHITE", ...order];
  const count = colors.length;
  const node = ([r, c]) => [(r - 1) / 2, (c - 1) / 2];
  const cell = (i, j) => [2 * i + 1, 2 * j + 1];
  const [si, sj] = node(start);
  const [ei, ej] = node(end);
  const band = REGION_STYLES[style](m, count, [si, sj], [ei, ej], connectionsPerPair(size));
  if (!band || band[si][sj] !== 0 || band[ei][ej] !== count - 1) return null;

  const inside = (i, j) => i >= 0 && i < m && j >= 0 && j < m;
  const grid = Array.from({ length: size }, () => Array(size).fill(WALL));
  const entries = [[si, sj]];
  const changers = [];

  for (let b = 0; b < count; b++) {
    const members = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (band[i][j] === b) members.push([i, j]);
    if (!members.length) return null;

    // Carve this region as its own maze (randomized depth-first search).
    const seen = new Set();
    const key = (i, j) => i * m + j;
    const [ri, rj] = b === 0 ? [si, sj] : entries[b];
    seen.add(key(ri, rj));
    grid[2 * ri + 1][2 * rj + 1] = colors[b];
    const stack = [[ri, rj]];
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const next = latticeNeighbors(m, i, j).filter(([ni, nj]) => band[ni][nj] === b && !seen.has(key(ni, nj)));
      if (!next.length) {
        stack.pop();
        continue;
      }
      const [ni, nj] = choice(next);
      seen.add(key(ni, nj));
      grid[i + ni + 1][j + nj + 1] = colors[b];
      grid[2 * ni + 1][2 * nj + 1] = colors[b];
      stack.push([ni, nj]);
    }
    if (seen.size !== members.length) return null; // region came out in pieces

    if (b === count - 1) break;

    // Distance of every square in this region from where the player comes in.
    const from = cell(...entries[b]);
    const dist = new Map([[from.join(), 0]]);
    const queue = [from];
    for (let h = 0; h < queue.length; h++) {
      const [r, c] = queue[h];
      for (const [dr, dc] of STEPS) {
        const nxt = [r + dr, c + dc];
        if (grid[nxt[0]][nxt[1]] === colors[b] && !dist.has(nxt.join())) {
          dist.set(nxt.join(), dist.get(queue[h].join()) + 1);
          queue.push(nxt);
        }
      }
    }

    // The doorway into the next region is a COLOR_CHANGE, picked from the 10% of
    // possible doorways farthest from the entrance so the region has to be explored.
    const doors = [];
    for (const [i, j] of members) {
      for (const [di, dj] of STEPS) {
        const [ni, nj] = [i + di, j + dj];
        if (inside(ni, nj) && band[ni][nj] === b + 1) doors.push({ i, j, ni, nj, d: dist.get(cell(i, j).join()) });
      }
    }
    if (!doors.length) return null;
    doors.sort((x, y) => y.d - x.d);
    const { i, j, ni, nj } = choice(doors.slice(0, Math.max(1, Math.ceil(doors.length / 10))));
    grid[i + ni + 1][j + nj + 1] = COLOR_CHANGE;
    changers.push([i + ni + 1, j + nj + 1]);
    entries[b + 1] = [ni, nj];
  }

  grid[start[0]][start[1]] = { color: "WHITE", marker: START };
  grid[end[0]][end[1]] = { color: colors[count - 1], marker: END };
  return { grid, changers };
}

/**
 * The shortest route that follows the color rules: a breadth-first search over
 * (square, player color), so a route may pass a square twice in different colors.
 *
 * @param {Square[][]} grid The maze.
 * @param {Cell} start Where to start.
 * @param {Cell} end Where to finish.
 * @param {?string} [forbid=null] A color the player may never take on.
 * @param {string} [startColor="WHITE"] The player's color at `start`.
 * @returns {?Cell[]} The squares from start to end, or null if there's no way.
 */
function solve(grid, start, end, forbid = null, startColor = "WHITE") {
  const size = grid.length;
  const n = COLOR_NAMES.length;
  const key = (r, c, color) => (r * size + c) * n + COLOR_NAMES.indexOf(color);
  const startState = [start[0], start[1], startColor];
  const prev = new Map([[key(...startState), null]]);
  const queue = [startState];
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    const [r, c, color] = state;
    if (r === end[0] && c === end[1]) {
      const path = [];
      for (let s = state; s; s = prev.get(key(...s))) path.push([s[0], s[1]]);
      return path.reverse();
    }
    for (const [dr, dc] of STEPS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const nextColor = step(color, grid[r][c], grid[nr][nc], forbid);
      if (!nextColor) continue;
      const k = key(nr, nc, nextColor);
      if (!prev.has(k)) {
        prev.set(k, state);
        queue.push([nr, nc, nextColor]);
      }
    }
  }
  return null;
}

/**
 * How many places each pair of neighboring regions must touch.
 *
 * @param {number} size Squares per side.
 * @returns {number} floor(log10(size × size)).
 */
function connectionsPerPair(size) {
  return Math.floor(Math.log10(size * size));
}

/**
 * The squares that could be on a route: everything except dead-end branches,
 * which are trimmed leaf by leaf (start and end are never trimmed).
 *
 * @param {Square[][]} grid The maze.
 * @param {Cell} start The start square.
 * @param {Cell} end The end square.
 * @returns {{keep: Uint8Array, degree: Uint8Array, neighbors: function(number, number): Cell[],
 *     fixed: function(number, number): boolean}} `keep` and `degree` are indexed by
 *     row * size + col; `neighbors` lists a square's kept neighbors and `fixed`
 *     says whether it's the start or end.
 */
function routeSquares(grid, start, end) {
  const size = grid.length;
  const id = (r, c) => r * size + c;
  const isOpen = (r, c) => r >= 0 && r < size && c >= 0 && c < size && grid[r][c] !== WALL;
  const keep = new Uint8Array(size * size);
  const degree = new Uint8Array(size * size);
  const neighbors = (r, c) => STEPS.map(([dr, dc]) => [r + dr, c + dc]).filter(([nr, nc]) => keep[id(nr, nc)]);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (isOpen(r, c)) keep[id(r, c)] = 1;
  const leaves = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!keep[id(r, c)]) continue;
      degree[id(r, c)] = neighbors(r, c).length;
      if (degree[id(r, c)] <= 1) leaves.push([r, c]);
    }
  }
  const fixed = (r, c) => (r === start[0] && c === start[1]) || (r === end[0] && c === end[1]);
  while (leaves.length) {
    const [r, c] = leaves.pop();
    if (fixed(r, c) || !keep[id(r, c)]) continue;
    keep[id(r, c)] = 0;
    for (const [nr, nc] of neighbors(r, c)) if (--degree[id(nr, nc)] <= 1) leaves.push([nr, nc]);
  }
  return { keep, degree, neighbors, fixed };
}

/**
 * Count routes from start to end that never revisit a square, stopping at `limit`.
 *
 * Squares in dead-end branches can't be on any route, so they're trimmed first.
 * What's left is junctions joined by corridors, and routes are counted over those.
 *
 * @param {Square[][]} grid The maze.
 * @param {Cell} start The start square.
 * @param {Cell} end The end square.
 * @param {boolean} colored Whether a route must also follow the color rules.
 * @param {number} limit Stop counting once this many routes are found.
 * @returns {number} The number of routes, at most `limit`.
 */
function countSolutions(grid, start, end, colored, limit) {
  const size = grid.length;
  const id = (r, c) => r * size + c;
  const { keep, degree, neighbors, fixed } = routeSquares(grid, start, end);
  if (!keep[id(...end)]) return 0;

  // Corridors between junctions, each walked square by square so colors can be checked.
  const junction = (r, c) => fixed(r, c) || degree[id(r, c)] !== 2;
  const corridors = new Map();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!keep[id(r, c)] || !junction(r, c)) continue;
      const list = [];
      for (const first of neighbors(r, c)) {
        const cells = [];
        let prev = [r, c];
        let cur = first;
        while (!junction(...cur)) {
          cells.push(cur);
          const next = neighbors(...cur).find(([nr, nc]) => nr !== prev[0] || nc !== prev[1]);
          prev = cur;
          cur = next;
        }
        cells.push(cur);
        if (cur[0] !== r || cur[1] !== c) list.push({ cells, to: id(...cur) });
      }
      corridors.set(id(r, c), list);
    }
  }

  let count = 0;
  const visited = new Set([id(...start)]);
  const walk = (at, color) => {
    if (at === id(...end)) {
      count++;
      return;
    }
    for (const { cells, to } of corridors.get(at)) {
      if (count >= limit) return;
      if (visited.has(to)) continue;
      let p = color;
      if (colored) {
        let from = grid[Math.floor(at / size)][at % size];
        for (const [r, c] of cells) {
          p = step(p, from, grid[r][c]);
          if (!p) break;
          from = grid[r][c];
        }
      }
      if (!p) continue;
      visited.add(to);
      walk(to, p);
      visited.delete(to);
    }
  };
  walk(id(...start), "WHITE");
  return count;
}

/**
 * Open walls along the boundary between each pair of neighboring regions until
 * they touch in `connections` places (counting the COLOR_CHANGE doorway).
 *
 * An opening is only kept if there is still exactly one route under the color
 * rules. An opened square takes the color of one side so every color stays one
 * region. Changes `grid` in place.
 *
 * @param {Square[][]} grid The maze; changed in place.
 * @param {Cell} start The start square.
 * @param {Cell} end The end square.
 * @param {string[]} colors All colors in region order, white first.
 * @param {number} connections How many places each pair must touch.
 * @returns {boolean} False if a boundary can't get enough openings.
 */
function addOpenings(grid, start, end, colors, connections) {
  const size = grid.length;
  for (let b = 0; b + 1 < colors.length; b++) {
    const pair = new Set([colors[b], colors[b + 1]]);
    const boundary = [];
    for (let r = 1; r < size - 1; r++) {
      for (let c = 1; c < size - 1; c++) {
        if (grid[r][c] !== WALL || (r % 2) === (c % 2)) continue; // only walls between two passages
        const [a, z] = r % 2 ? [grid[r][c - 1], grid[r][c + 1]] : [grid[r - 1][c], grid[r + 1][c]];
        if (a === WALL || z === WALL || colorOf(a) === colorOf(z)) continue;
        if (pair.has(colorOf(a)) && pair.has(colorOf(z))) boundary.push([r, c]);
      }
    }
    let made = 1; // the doorway
    for (const [r, c] of shuffle(boundary)) {
      if (made === connections) break;
      for (const color of shuffle([...pair])) {
        grid[r][c] = color;
        if (countSolutions(grid, start, end, true, 2) === 1) {
          made++;
          break;
        }
        grid[r][c] = WALL;
      }
    }
    if (made < connections) return false;
  }
  return true;
}

/**
 * Build a maze with START in the upper left and END in the bottom right.
 *
 * A layout is only accepted if every pair of neighboring regions touches in the
 * required number of places, there's exactly one route under the color rules,
 * and it can't be solved without taking on every color.
 *
 * @param {number} [colorCount=MAX_COLORS] How many colors, white included (1 to MAX_COLORS).
 * @param {number} [size=100] Squares per side (MIN_SIZE to MAX_SIZE).
 * @param {string} [style="bands"] How the color regions are laid out: a key of REGION_STYLES.
 * @param {number} [maxAttempts=200] Random layouts to try before giving up.
 * @returns {Maze} The finished maze.
 * @throws {RangeError} If the layout, size or color count is out of range.
 * @throws {Error} If no layout worked within `maxAttempts`.
 */
function buildGrid(colorCount = MAX_COLORS, size = 100, style = "bands", maxAttempts = 200) {
  if (!REGION_STYLES[style]) throw new RangeError(`layout must be one of: ${Object.keys(REGION_STYLES).join(", ")}`);
  if (!(Number.isInteger(size) && size >= MIN_SIZE && size <= MAX_SIZE)) {
    throw new RangeError(`maze size must be between ${MIN_SIZE} and ${MAX_SIZE}`);
  }
  if (size < MIN_SIZE_FOR_COLORS[colorCount]) {
    throw new RangeError(`${colorCount} colors need a maze size of at least ${MIN_SIZE_FOR_COLORS[colorCount]}`);
  }
  const palette = pickPalette(colorCount);
  const [start, end] = corners(size);
  for (let i = 0; i < maxAttempts; i++) {
    const order = regionOrder(palette.slice(1));
    const result = layout(size, order, style);
    if (!result) continue;
    const { grid, changers } = result;
    if (!addOpenings(grid, start, end, ["WHITE", ...order], connectionsPerPair(size))) continue;
    const path = solve(grid, start, end);
    if (!path) continue;
    if (order.some((color) => solve(grid, start, end, color))) continue;
    return { grid, palette: ["WHITE", ...order], path, changers };
  }
  throw new Error(`a ${size}×${size} maze is too small for ${colorCount} colors; try a larger size`);
}

/**
 * Row and column sizes for drawing at one zoom level.
 *
 * Passages sit on odd rows/columns and walls on even ones. Walls are drawn about
 * a quarter as thick as passages, so each row/column has its own size.
 *
 * @param {number} path Passage width in device pixels.
 * @param {number} [dpr=1] Device pixels per CSS pixel, so high-DPI screens stay sharp.
 * @returns {Geometry} The sizes and position helpers.
 */
function geometry(path, dpr = 1) {
  const wall = Math.max(1, Math.round(path / 4));
  const pos = (k) => Math.ceil(k / 2) * wall + Math.floor(k / 2) * path; // left/top edge of row/column k
  const span = (k) => (k % 2 ? path : wall);
  return { path, wall, dpr, pos, span, center: (r, c) => [pos(c) + span(c) / 2, pos(r) + span(r) / 2] };
}

/**
 * How many rows/columns are worth drawing.
 *
 * An even-sized grid ends in two all-wall rows and columns, and the second sits
 * on an odd (passage-width) index, which would make the right and bottom borders
 * much thicker than the other walls; leave it out.
 *
 * @param {Square[][]} grid The maze.
 * @returns {number} Rows (and columns) to draw.
 */
function visibleSize(grid) {
  return grid.length % 2 ? grid.length : grid.length - 1;
}

/**
 * The colors a COLOR_CHANGE square flashes between: those of the squares it touches.
 *
 * @param {Square[][]} grid The maze.
 * @param {number} r The doorway's row.
 * @param {number} c The doorway's column.
 * @returns {string[]} The distinct colors next to it.
 */
function touchingColors(grid, r, c) {
  const colors = STEPS.map(([dr, dc]) => grid[r + dr]?.[c + dc])
    .filter((v) => v !== undefined && v !== WALL && v !== COLOR_CHANGE)
    .map(colorOf);
  return [...new Set(colors)];
}

/**
 * Draw one square. COLOR_CHANGE squares are striped in the colors they join, and
 * the stripes swap places each tick.
 *
 * @param {CanvasRenderingContext2D} ctx Where to draw.
 * @param {Square[][]} grid The maze.
 * @param {number} r Row.
 * @param {number} c Column.
 * @param {Geometry} geo Sizes at the current zoom.
 * @param {number} [tick=0] How many times the doorways have flashed.
 */
function drawCell(ctx, grid, r, c, geo, tick = 0) {
  const value = grid[r]?.[c];
  if (value === undefined) return;
  const x = geo.pos(c);
  const y = geo.pos(r);
  const w = geo.span(c);
  const h = geo.span(r);
  if (value === WALL) {
    ctx.fillStyle = "black";
    ctx.fillRect(x, y, w, h);
    return;
  }
  if (value === COLOR_CHANGE) {
    drawDoorway(ctx, touchingColors(grid, r, c), x, y, w, h, tick);
    return;
  }
  // No outline, so neighboring squares of one color merge into a single corridor.
  ctx.fillStyle = RGB[colorOf(value)];
  ctx.fillRect(x, y, w, h);
  if (value.marker) drawMarker(ctx, value.marker, x, y, w);
}

/**
 * Blend two colors.
 *
 * @param {string} a A "#rrggbb" color, returned when t = 0.
 * @param {string} b A "#rrggbb" color, returned when t = 1.
 * @param {number} t How far from `a` to `b`, 0 to 1.
 * @returns {string} The blend as "#rrggbb".
 */
function mixColor(a, b, t) {
  const channel = (hex, k) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
  const mixed = [0, 1, 2].map((k) => Math.round(channel(a, k) + (channel(b, k) - channel(a, k)) * t));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Draw a doorway: a checkerboard of the colors on either side, two squares deep,
 * so both colors always show and the texture stands out from the solid squares
 * around it.
 *
 * @param {CanvasRenderingContext2D} ctx Where to draw.
 * @param {string[]} colors The colors it joins; the first and last are used.
 * @param {number} x Left edge in device pixels.
 * @param {number} y Top edge in device pixels.
 * @param {number} w Width in device pixels.
 * @param {number} h Height in device pixels.
 * @param {number} tick How many times it has flashed; odd ticks swap the colors.
 */
function drawDoorway(ctx, colors, x, y, w, h, tick) {
  const [first, second] = [colors[0], colors[colors.length - 1]];
  const deep = Math.min(w, h) >= 4 ? 2 : 1; // squares across the doorway's thin side
  const q = Math.min(w, h) / deep;
  const count = Math.max(2, Math.round(Math.max(w, h) / q));
  const step = Math.max(w, h) / count;
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < deep; j++) {
      ctx.fillStyle = RGB[(i + j + tick) % 2 ? second : first];
      const a = Math.round(i * step);
      const b = Math.round((i + 1) * step);
      const c = Math.round(j * q);
      const d = Math.round((j + 1) * q);
      if (w >= h) ctx.fillRect(x + a, y + c, b - a, d - c);
      else ctx.fillRect(x + c, y + a, d - c, b - a);
    }
  }
}

/**
 * Draw the player on a square: a smiley face in their current color, clipped to
 * that square so it never paints outside it.
 *
 * @param {CanvasRenderingContext2D} ctx Where to draw.
 * @param {number} r Row.
 * @param {number} c Column.
 * @param {Geometry} geo Sizes at the current zoom.
 * @param {string} [color="WHITE"] The player's color name.
 * @param {string} [mood="happy"] "happy", or "oops" after a blocked move.
 * @param {number} [scale=1] Shrinks the face, e.g. so the start and end icons show around it.
 */
function drawPlayer(ctx, r, c, geo, color = "WHITE", mood = "happy", scale = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.pos(c), geo.pos(r), geo.span(c), geo.span(r));
  ctx.clip(); // never paint outside the player's own square
  drawPlayerAt(ctx, ...geo.center(r, c), geo, RGB[color], mood, scale);
  ctx.restore();
}

/**
 * Draw the smiley face at any point, e.g. partway through a slide. It's as wide
 * as most of the path and outlined black then white so it reads on every square.
 *
 * @param {CanvasRenderingContext2D} ctx Where to draw.
 * @param {number} cx Center x in device pixels.
 * @param {number} cy Center y in device pixels.
 * @param {{path: number}} geo Sizes at the current zoom; only `path` is used.
 * @param {string} fill The face color (any CSS color).
 * @param {string} [mood="happy"] "happy" smiles; "oops" (a blocked move) makes a small round mouth.
 * @param {number} [scale=1] Shrinks the face.
 */
function drawPlayerAt(ctx, cx, cy, geo, fill, mood = "happy", scale = 1) {
  // Keep the face and its outline (1.5 lines past the radius, plus a pixel of
  // anti-aliasing) inside the path, or it leaves marks on the walls beside it.
  const line = Math.max(0.5, geo.path / 16);
  const radius = scale * Math.max(1, Math.min(geo.path * 0.4, geo.path / 2 - 1.5 * line - 1));
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3 * line;
  ctx.strokeStyle = "white";
  ctx.stroke();
  ctx.lineWidth = line;
  ctx.strokeStyle = "black";
  ctx.stroke();
  if (radius < 3) return; // too small for a face
  ctx.fillStyle = "black";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * radius * 0.35, cy - radius * 0.25, Math.max(0.75, radius * 0.13), 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, radius * 0.12);
  if (mood === "oops") {
    ctx.arc(cx, cy + radius * 0.4, radius * 0.16, 0, 2 * Math.PI);
  } else {
    ctx.arc(cx, cy + radius * 0.05, radius * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
  }
  ctx.stroke();
}

/**
 * Draw the start (a doorway arch) or end (a star) icon on its square.
 *
 * Each is drawn twice: a wider white stroke underneath gives the black stroke a
 * white outline so it stands out on every color. Both are wider than the
 * player's face is when standing on them.
 *
 * @param {CanvasRenderingContext2D} ctx Where to draw.
 * @param {string} marker START or END.
 * @param {number} x Left edge in device pixels.
 * @param {number} y Top edge in device pixels.
 * @param {number} cell The square's width in device pixels.
 */
function drawMarker(ctx, marker, x, y, cell) {
  const width = Math.max(1, cell / 12);
  const halo = Math.max(1, width / 2);
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  ctx.beginPath();
  if (marker === START) {
    const half = cell * 0.3;
    const top = y + cell * 0.42;
    ctx.moveTo(cx - half, y + cell * 0.88);
    ctx.lineTo(cx - half, top);
    ctx.arc(cx, top, half, Math.PI, 0);
    ctx.lineTo(cx + half, y + cell * 0.88);
    ctx.closePath();
  } else {
    for (let k = 0; k < 10; k++) {
      const radius = (k % 2 ? 0.19 : 0.42) * cell;
      const angle = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle) + cell * 0.03);
    }
    ctx.closePath();
    ctx.fillStyle = "#ffd447";
    ctx.fill();
  }
  ctx.lineJoin = "round";
  ctx.strokeStyle = "white";
  ctx.lineWidth = width + 2 * halo;
  ctx.stroke();
  ctx.strokeStyle = "black";
  ctx.lineWidth = width;
  ctx.stroke();
}
