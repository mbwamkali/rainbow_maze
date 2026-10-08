// Maze logic: a grid of walls and colored regions with a guaranteed path from
// START (upper right) to END (bottom left).
//
// Light rules:
// - The player starts WHITE, which counts as "no color".
// - A player can always walk on WHITE squares. A colored player can also walk on
//   any color made only of their own primaries: RED walks on red; MAGENTA
//   (red + blue) walks on magenta, red and blue, but not green.
// - Flashing color blocks (changers) set the player's color. The new color
//   replaces the old one. Because a new color can't walk back over the old
//   region, each changer is the one doorway from its region into the next,
//   placed far from where the player enters that region.
//   TODO(expert mode): mix instead of replace (red + blue block = magenta).
// - Each non-white color is one connected region, and every color must be
//   used to finish.
// - Ignoring colors, there are exactly floor(log10(size × size)) routes from start
//   to end (just one for a single-color maze). Following the color rules, there
//   is exactly one. A route never visits the same square twice.

const WALL = "WALL";
// Special squares keep their region color and carry extra fields:
//   {color: "WHITE", marker: "START"}   start, drawn as an X
//   {color: "BLUE", marker: "END"}      end, drawn as a circle
//   {color: "RED", changer: "MAGENTA"}  flashing doorway that turns the player magenta
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

// Choose `count` colors: white first, then primaries, then secondaries, picked at random.
function pickPalette(count) {
  if (!(count >= 1 && count <= MAX_COLORS)) {
    throw new RangeError(`number of colors must be between 1 and ${MAX_COLORS}`);
  }
  const primaries = shuffle(PRIMARY).slice(0, Math.min(count - 1, PRIMARY.length));
  const secondaries = shuffle(SECONDARY).slice(0, Math.max(count - 1 - PRIMARY.length, 0));
  return ["WHITE", ...primaries, ...secondaries];
}

function colorOf(value) {
  return typeof value === "object" ? value.color : value;
}

// Can a player of color `player` step onto a square of color `square`?
function canEnter(player, square) {
  if (square === "WHITE") return true;
  if (player === "WHITE") return false; // white is "no color"
  return (MASK[square] & ~MASK[player]) === 0;
}

// Start is the upper-right open cell, end is the bottom-left open cell.
// Passages sit on odd coordinates, so the outermost usable index is the largest odd one.
function corners(size) {
  const last = size % 2 ? size - 2 : size - 3;
  return [[1, last], [last, 1]];
}

// Order the non-white colors so each region needs a new color: a color that sits
// right after one containing it (red after magenta) could be walked through
// without changing. Primaries before secondaries always works; shuffling a few
// times first gives more variety.
function regionOrder(colors) {
  for (let i = 0; i < 20; i++) {
    const order = shuffle(colors);
    if (order.every((c, j) => j === 0 || !canEnter(order[j - 1], c))) return order;
  }
  return [...colors.filter((c) => PRIMARY.includes(c)), ...colors.filter((c) => SECONDARY.includes(c))];
}

// Split the passage lattice (odd cells) into `count` equal-size bands running
// diagonally from the upper right to the bottom left, with wavy edges.
// TODO(expert mode): allow several separate regions per color.
function bandLattice(m, count) {
  const wave = () => ({ amp: (0.35 / count) * Math.random(), freq: 1 + Math.random() * 2, phase: Math.random() * 2 * Math.PI });
  const waves = [wave(), wave()];
  const span = Math.max(1, 2 * (m - 1));
  const nodes = [];
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const along = (i + (m - 1 - j)) / span; // 0 at upper right, 1 at bottom left
      const across = (i - (m - 1 - j)) / span;
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

const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// One attempt at a full layout; returns null if this random layout doesn't work out.
function layout(size, order) {
  const [start, end] = corners(size);
  const m = (start[1] + 1) / 2; // lattice nodes per side
  const colors = ["WHITE", ...order];
  const count = colors.length;
  const band = bandLattice(m, count);
  const node = ([r, c]) => [(r - 1) / 2, (c - 1) / 2];
  const cell = (i, j) => [2 * i + 1, 2 * j + 1];
  const [si, sj] = node(start);
  const [ei, ej] = node(end);
  if (band[si][sj] !== 0 || band[ei][ej] !== count - 1) return null;

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

    // The doorway into the next region is a changer, picked from the 10% of
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
    grid[i + ni + 1][j + nj + 1] = { color: colors[b], changer: colors[b + 1] };
    changers.push([i + ni + 1, j + nj + 1]);
    entries[b + 1] = [ni, nj];
  }

  grid[start[0]][start[1]] = { color: "WHITE", marker: START };
  grid[end[0]][end[1]] = { color: colors[count - 1], marker: END };
  return { grid, changers };
}

// Breadth-first search over (square, player color). Returns the shortest list of
// squares from start to end, or null. Changers listed in `disabled` don't work.
function solve(grid, start, end, disabled = []) {
  const size = grid.length;
  const off = new Set(disabled.map((p) => p.join()));
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
      const value = grid[nr][nc];
      if (value === WALL || !canEnter(color, colorOf(value))) continue;
      const nextColor = value.changer && !off.has(`${nr},${nc}`) ? value.changer : color;
      const k = key(nr, nc, nextColor);
      if (!prev.has(k)) {
        prev.set(k, state);
        queue.push([nr, nc, nextColor]);
      }
    }
  }
  return null;
}

// How many routes the maze must have when colors are ignored.
function targetSolutions(size, colorCount) {
  return colorCount === 1 ? 1 : Math.floor(Math.log10(size * size));
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
      let blocked = false;
      if (colored) {
        for (const [r, c] of cells) {
          const value = grid[r][c];
          if (!canEnter(p, colorOf(value))) {
            blocked = true;
            break;
          }
          if (value.changer) p = value.changer;
        }
      }
      if (blocked) continue;
      visited.add(to);
      walk(to, p);
      visited.delete(to);
    }
  };
  walk(id(...start), "WHITE");
  return count;
}

// Open walls to make loops until there are exactly `target` routes ignoring
// colors, while keeping exactly one route under the color rules. An opened
// square takes the color of a neighbor so every color stays one region.
// Returns false if the target can't be reached in this layout.
function addLoops(grid, start, end, target) {
  const size = grid.length;
  let routes = 1;

  // For every square, the route square its dead-end branch hangs off. A new
  // opening between two squares that hang off the same point only makes a
  // side loop, so it can't add a route and isn't worth counting.
  let attach;
  const findAttachments = () => {
    const { keep } = routeSquares(grid, start, end);
    attach = new Int32Array(size * size).fill(-1);
    const queue = [];
    for (let i = 0; i < size * size; i++) if (keep[i]) (attach[i] = i), queue.push(i);
    for (let h = 0; h < queue.length; h++) {
      const r = Math.floor(queue[h] / size);
      const c = queue[h] % size;
      for (const [dr, dc] of STEPS) {
        const n = (r + dr) * size + c + dc;
        if (grid[r + dr][c + dc] !== WALL && attach[n] === -1) (attach[n] = attach[queue[h]]), queue.push(n);
      }
    }
  };
  findAttachments();

  const walls = [];
  for (let r = 1; r < size - 1; r++) {
    for (let c = 1; c < size - 1; c++) {
      if (grid[r][c] !== WALL || (r % 2) === (c % 2)) continue; // only walls between two passages
      const [a, b] = r % 2 ? [[r, c - 1], [r, c + 1]] : [[r - 1, c], [r + 1, c]];
      if (grid[a[0]][a[1]] !== WALL && grid[b[0]][b[1]] !== WALL) walls.push([r, c, a, b]);
    }
  }
  for (const [r, c, a, b] of shuffle(walls)) {
    if (routes === target) break;
    if (attach[a[0] * size + a[1]] === attach[b[0] * size + b[1]]) continue;
    const options = shuffle([...new Set([colorOf(grid[a[0]][a[1]]), colorOf(grid[b[0]][b[1]])])]);
    for (const color of options) {
      grid[r][c] = color;
      const total = countSolutions(grid, start, end, false, target + 1);
      if (total > routes && total <= target && countSolutions(grid, start, end, true, 2) === 1) {
        routes = total;
        findAttachments();
        break;
      }
      grid[r][c] = WALL;
    }
  }
  return routes === target;
}

// Build a maze with START in the upper right and END in the bottom left.
// A layout is only accepted if it has the required number of routes, and can't
// be solved with any single changer switched off, so every color has to be used.
function buildGrid(colorCount = MAX_COLORS, size = 100, maxAttempts = 200) {
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
    const result = layout(size, order);
    if (!result) continue;
    const { grid, changers } = result;
    if (!addLoops(grid, start, end, targetSolutions(size, colorCount))) continue;
    const path = solve(grid, start, end);
    if (!path) continue;
    if (changers.some((ch) => solve(grid, start, end, [ch]))) continue;
    return { grid, palette: ["WHITE", ...order], path, changers };
  }
  throw new Error(`a ${size}×${size} maze is too small for ${colorCount} colors; try a larger size`);
}

function render(grid, canvas, cell, flashOn = true) {
  const size = grid.length;
  canvas.width = canvas.height = size * cell;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  grid.forEach((row, r) => row.forEach((value, c) => drawCell(ctx, value, r, c, cell, flashOn)));
}

// Changers flash between their own color and the region color around them.
function drawCell(ctx, value, r, c, cell, flashOn = true) {
  const x = c * cell;
  const y = r * cell;
  if (value === WALL) {
    ctx.fillStyle = "black";
    ctx.fillRect(x, y, cell, cell);
    return;
  }
  const fill = value.changer && flashOn ? value.changer : colorOf(value);
  // No outline, so neighboring squares of one color merge into a single corridor.
  ctx.fillStyle = RGB[fill];
  ctx.fillRect(x, y, cell, cell);
  if (value.marker) drawMarker(ctx, value.marker, x, y, cell);
}

// The player is a diamond in their current color, outlined black then white so
// it reads on every square and can't be mistaken for the X or the circle.
function drawPlayer(ctx, r, c, cell, color = "WHITE") {
  const cx = c * cell + cell / 2;
  const cy = r * cell + cell / 2;
  const half = Math.max(1, cell * 0.36);
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx + half, cy);
  ctx.lineTo(cx, cy + half);
  ctx.lineTo(cx - half, cy);
  ctx.closePath();
  ctx.fillStyle = RGB[color];
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, cell / 8);
  ctx.strokeStyle = "white";
  ctx.stroke();
  ctx.lineWidth = Math.max(1, cell / 16);
  ctx.strokeStyle = "black";
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
