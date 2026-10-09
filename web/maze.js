// Maze logic: a grid of walls and colored regions with a guaranteed path from
// START (upper left) to END (bottom right).
//
// Light rules:
// - The player starts WHITE, which counts as "no color".
// - A player can always walk on WHITE squares. A colored player can also walk on
//   any color made only of their own primaries: RED walks on red; MAGENTA
//   (red + blue) walks on magenta, red and blue, but not green.
// - COLOR_CHANGE squares are the doorways between regions, placed far from
//   where the player enters a region. Anyone can step onto one (keeping their
//   color while on it), and step off it onto any square, in any direction,
//   taking on that square's color. The new color replaces the old one.
//   TODO(expert mode): mix instead of replace (red + blue = magenta).
// - Each non-white color is one connected region, and the player must become
//   every color to finish.
// - Each pair of neighboring regions touches in exactly floor(log10(size × size))
//   places: one COLOR_CHANGE doorway, and openings that the color rules block.
//   So there are several ways between two colors, but following the color
//   rules there is exactly one route through the maze. A route never visits
//   the same square twice.

const WALL = "WALL";
// Flashes between the colors of the squares it touches.
const COLOR_CHANGE = "COLOR_CHANGE";
// Start and end keep their region color and carry a marker:
//   {color: "WHITE", marker: "START"}   drawn as an X
//   {color: "BLUE", marker: "END"}      drawn as a circle
const START = "START";
const END = "END";

// Additive (light) model: primaries red/green/blue, secondaries cyan/magenta/yellow,
// and white = all primaries combined.
const RGB = {
  RED: "#ff0000",
  GREEN: "#00ff00",
  BLUE: "#0000ff",
  CYAN: "#00ffff",
  MAGENTA: "#ff00ff",
  YELLOW: "#ffff00",
  WHITE: "#ffffff",
};
// Which primaries make up each color, as bits: red = 1, green = 2, blue = 4.
const MASK = { RED: 1, GREEN: 2, BLUE: 4, YELLOW: 3, MAGENTA: 5, CYAN: 6, WHITE: 7 };
const PRIMARY = ["RED", "GREEN", "BLUE"];
const SECONDARY = ["CYAN", "MAGENTA", "YELLOW"];
const COLOR_NAMES = Object.keys(RGB);
const MAX_COLORS = 1 + PRIMARY.length + SECONDARY.length;
const MIN_SIZE = 5;
// Smallest maze that reliably fits one region per color (measured, plus a little margin).
const MIN_SIZE_FOR_COLORS = { 1: 5, 2: 5, 3: 9, 4: 15, 5: 21, 6: 25, 7: 31 };
const MAX_SIZE = 250;

// TODO: seeded randomness (?seed=…) so a maze can be replayed and shared. Every
// random draw goes through Math.random, here and in the region layouts below.
function choice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// Choose the first `count` colors of this sequence:
//   1. white
//   2. red (P1)
//   3. a secondary containing P1 (S1)
//   4. the other primary in S1 (P2)
//   5. the last primary (P3)
//   6. a secondary containing P3 (S2)
//   7. the last secondary (S3)
// This picks which colors are used; regionOrder() decides the order of the regions.
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

function colorOf(value) {
  return typeof value === "object" ? value.color : value;
}

// The player's color after moving from square `from` to square `to`, or null
// if the move isn't allowed. `forbid` names a color the player may not take on
// (used to check that every color is needed).
function step(player, from, to, forbid = null) {
  if (to === WALL) return null;
  if (to === COLOR_CHANGE) return player;
  if (from === COLOR_CHANGE) return colorOf(to) === forbid ? null : colorOf(to);
  return canEnter(player, colorOf(to)) ? player : null;
}

// Can a player of color `player` step onto a square of color `square`?
function canEnter(player, square) {
  if (square === "WHITE") return true;
  if (player === "WHITE") return false; // white is "no color"
  return (MASK[square] & ~MASK[player]) === 0;
}

// Start is the upper-left open cell, end is the bottom-right open cell.
// Passages sit on odd coordinates, so the outermost usable index is the largest odd one.
function corners(size) {
  const last = size % 2 ? size - 2 : size - 3;
  return [[1, 1], [last, last]];
}

// Order the non-white colors so each region needs a new color: a color that sits
// right after one containing it (red after magenta) could be walked through
// without changing. The first color (red) always comes right after white.
// Primaries before secondaries always works; shuffling a few times first gives
// more variety.
function regionOrder(colors) {
  const [first, ...rest] = colors;
  if (first === undefined) return [];
  for (let i = 0; i < 20; i++) {
    const order = [first, ...shuffle(rest)];
    if (order.every((c, j) => j === 0 || !canEnter(order[j - 1], c))) return order;
  }
  return [first, ...rest.filter((c) => PRIMARY.includes(c)), ...rest.filter((c) => SECONDARY.includes(c))];
}

// Split the passage lattice (odd cells) into `count` equal-size bands running
// diagonally from the upper left to the bottom right, with wavy edges.
// TODO(expert mode): allow several separate regions per color.
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

function latticeNeighbors(m, i, j) {
  return STEPS.map(([di, dj]) => [i + di, j + dj]).filter(([a, b]) => a >= 0 && a < m && b >= 0 && b < m);
}

// How many lattice-neighbor pairs join each pair of regions, keyed "a,b" with a < b.
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

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((x, k) => permutations([...items.slice(0, k), ...items.slice(k + 1)]).map((p) => [x, ...p]));
}

// Regions grown outward from scattered seed points, like countries on a map.
// The start's blob comes first and the end's blob last; the blobs in between
// are put in any order where each blob touches the next in at least `minTouch`
// places. Returns null if no such order exists.
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

// Regions that follow the solution of one big maze, so colors interlock like
// fingers: carve a maze over the whole lattice, cut its start-to-end path into
// `count` stretches of about equal weight, and give every dead-end branch the
// region of the path square it hangs off.
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

// How the board is split into color regions.
const REGION_STYLES = { bands: bandLattice, blobs: blobLattice, tendrils: tendrilLattice };

const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// One attempt at a full layout; returns null if this random layout doesn't work out.
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
      const next = STEPS.map(([di, dj]) => [i + di, j + dj])
        .filter(([ni, nj]) => inside(ni, nj) && band[ni][nj] === b && !seen.has(key(ni, nj)));
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

// Breadth-first search over (square, player color). Returns the shortest list of
// squares from start to end, or null. With `forbid`, the player may never take
// on that color.
function solve(grid, start, end, forbid = null) {
  const size = grid.length;
  const n = COLOR_NAMES.length;
  const key = (r, c, color) => (r * size + c) * n + COLOR_NAMES.indexOf(color);
  const startState = [start[0], start[1], "WHITE"];
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

// How many places each pair of neighboring regions must touch.
function connectionsPerPair(size) {
  return Math.floor(Math.log10(size * size));
}

// Squares that could be on a route: everything except dead-end branches, which
// are trimmed leaf by leaf (start and end are never trimmed).
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

// Count routes from start to end that never revisit a square, stopping at `limit`.
// With `colored`, a route must also follow the color rules.
//
// Squares in dead-end branches can't be on any route, so they're trimmed first.
// What's left is junctions joined by corridors, and routes are counted over those.
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

// Open walls along the boundary between each pair of neighboring regions until
// they touch in `connections` places (counting the COLOR_CHANGE doorway). An
// opening is only kept if there is still exactly one route under the color
// rules. An opened square takes the color of one side so every color stays one
// region. Returns false if a boundary can't get enough openings.
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

// Build a maze with START in the upper left and END in the bottom right.
// A layout is only accepted if every pair of neighboring regions touches in the
// required number of places, there's exactly one route under the color rules,
// and it can't be solved without taking on every color.
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

// Passages sit on odd rows/columns and walls on even ones. Walls are drawn about
// a quarter as thick as passages, so each row/column has its own size. Sizes are
// in device pixels; `dpr` (device pixels per CSS pixel) keeps high-DPI screens sharp.
function geometry(path, dpr = 1) {
  const wall = Math.max(1, Math.round(path / 4));
  return {
    path,
    wall,
    dpr,
    pos: (k) => Math.ceil(k / 2) * wall + Math.floor(k / 2) * path, // left/top edge of row/column k
    span: (k) => (k % 2 ? path : wall),
    center: (r, c) => [Math.ceil(c / 2) * wall + Math.floor(c / 2) * path + (c % 2 ? path : wall) / 2,
                       Math.ceil(r / 2) * wall + Math.floor(r / 2) * path + (r % 2 ? path : wall) / 2],
  };
}

// Rows/columns worth drawing. An even-sized grid ends in two all-wall rows and
// columns, and the second sits on an odd (passage-width) index, which would make
// the right and bottom borders much thicker than the other walls; leave it out.
function visibleSize(grid) {
  return grid.length % 2 ? grid.length : grid.length - 1;
}

function render(grid, canvas, geo, tick = 0) {
  const size = visibleSize(grid);
  canvas.width = canvas.height = geo.pos(size);
  canvas.style.width = `${geo.pos(size) / geo.dpr}px`;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) drawCell(ctx, grid, r, c, geo, tick);
}

// The colors a COLOR_CHANGE square flashes between: those of the squares it touches.
function touchingColors(grid, r, c) {
  const colors = STEPS.map(([dr, dc]) => grid[r + dr]?.[c + dc])
    .filter((v) => v !== undefined && v !== WALL && v !== COLOR_CHANGE)
    .map(colorOf);
  return [...new Set(colors)];
}

// `tick` counts flashes; COLOR_CHANGE squares show the next touching color each tick.
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
  let fill = colorOf(value);
  if (value === COLOR_CHANGE) {
    const colors = touchingColors(grid, r, c);
    fill = colors[tick % colors.length];
  }
  // No outline, so neighboring squares of one color merge into a single corridor.
  ctx.fillStyle = RGB[fill];
  ctx.fillRect(x, y, w, h);
  if (value.marker) drawMarker(ctx, value.marker, x, y, w);
}

// Blend two "#rrggbb" colors; t = 0 gives `a`, t = 1 gives `b`.
function mixColor(a, b, t) {
  const channel = (hex, k) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
  const mixed = [0, 1, 2].map((k) => Math.round(channel(a, k) + (channel(b, k) - channel(a, k)) * t));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// The player is a smiley face in their current color, as wide as most of the
// path and outlined black then white so it reads on every square.
function drawPlayer(ctx, r, c, geo, color = "WHITE", mood = "happy") {
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.pos(c), geo.pos(r), geo.span(c), geo.span(r));
  ctx.clip(); // never paint outside the player's own square
  drawPlayerAt(ctx, ...geo.center(r, c), geo, RGB[color], mood);
  ctx.restore();
}

// Draw the face centered on pixel (cx, cy) with fill `fill` (a CSS color).
// mood "happy" smiles; "oops" (a blocked move) makes a small round mouth.
function drawPlayerAt(ctx, cx, cy, geo, fill, mood = "happy") {
  // Keep the face and its outline (1.5 lines past the radius, plus a pixel of
  // anti-aliasing) inside the path, or it leaves marks on the walls beside it.
  const line = Math.max(0.5, geo.path / 16);
  const radius = Math.max(1, Math.min(geo.path * 0.4, geo.path / 2 - 1.5 * line - 1));
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

// Draw each marker twice: a wider white stroke underneath gives the black
// stroke a white outline so it stands out on every color.
function drawMarker(ctx, marker, x, y, cell) {
  const pad = cell / 6;
  const width = Math.max(1, cell / 10);
  const halo = Math.max(1, width / 2);
  const x0 = x + pad, y0 = y + pad, x1 = x + cell - pad, y1 = y + cell - pad;
  const strokes = [["white", width + 2 * halo, "square"], ["black", width, "butt"]];
  for (const [color, lineWidth, lineCap] of strokes) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = lineCap; // square caps extend the white stroke past each tip
    ctx.beginPath();
    if (marker === START) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.moveTo(x0, y1);
      ctx.lineTo(x1, y0);
    } else {
      ctx.arc(x + cell / 2, y + cell / 2, cell / 2 - pad, 0, 2 * Math.PI);
    }
    ctx.stroke();
  }
}
