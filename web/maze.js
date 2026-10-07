// Maze logic, ported from maze.py: build a grid of walls and colors with a
// guaranteed path from START (upper right) to END (bottom left).

const WALL = "WALL";
// Start/end squares keep their color and carry a marker: {color: "RED", marker: "START"}.
const START = "START"; // drawn as an X
const END = "END"; // drawn as a circle

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
const PRIMARY = ["RED", "GREEN", "BLUE"];
const SECONDARY = ["CYAN", "MAGENTA", "YELLOW"];
const MAX_COLORS = 1 + PRIMARY.length + SECONDARY.length;
const MIN_SIZE = 5;
const MAX_SIZE = 250;

function choice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function sample(items, count) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Choose `count` colors: white first, then primaries, then secondaries, picked at random.
function pickPalette(count) {
  if (!(count >= 1 && count <= MAX_COLORS)) {
    throw new RangeError(`number of colors must be between 1 and ${MAX_COLORS}`);
  }
  const primaries = sample(PRIMARY, Math.min(count - 1, PRIMARY.length));
  const secondaries = sample(SECONDARY, Math.max(count - 1 - PRIMARY.length, 0));
  return ["WHITE", ...primaries, ...secondaries];
}

// Start is the upper-right open cell, end is the bottom-left open cell.
// Passages sit on odd coordinates, so the outermost usable index is the largest odd one.
function corners(size) {
  const last = size % 2 ? size - 2 : size - 3;
  return [[1, last], [last, 1]];
}

// Carve a maze with a randomized depth-first search; open cells get random colors.
function carve(size, start, palette) {
  const grid = Array.from({ length: size }, () => Array(size).fill(WALL));

  // Carve on odd coordinates so walls sit between passages.
  grid[start[0]][start[1]] = choice(palette);
  const stack = [start];
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const neighbors = [[-2, 0], [2, 0], [0, -2], [0, 2]]
      .map(([dr, dc]) => [r + dr, c + dc, r + dr / 2, c + dc / 2])
      .filter(([nr, nc]) => nr > 0 && nr < size - 1 && nc > 0 && nc < size - 1 && grid[nr][nc] === WALL);
    if (!neighbors.length) {
      stack.pop();
      continue;
    }
    const [nr, nc, mr, mc] = choice(neighbors);
    grid[mr][mc] = choice(palette);
    grid[nr][nc] = choice(palette);
    stack.push([nr, nc]);
  }
  return grid;
}

// Breadth-first search; returns the shortest path from start to end, or null.
function solve(grid, start, end) {
  const size = grid.length;
  const key = ([r, c]) => r * size + c;
  const prev = new Map([[key(start), null]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    let cell = queue[head];
    if (cell[0] === end[0] && cell[1] === end[1]) {
      const path = [];
      while (cell) {
        path.push(cell);
        cell = prev.get(key(cell));
      }
      return path.reverse();
    }
    const [r, c] = cell;
    for (const next of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const [nr, nc] = next;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] !== WALL && !prev.has(key(next))) {
        prev.set(key(next), cell);
        queue.push(next);
      }
    }
  }
  return null;
}

// Build a maze with START in the upper right and END in the bottom left.
// Every attempt is checked with a solver and only a solvable maze is returned.
function buildGrid(colorCount = MAX_COLORS, size = 100, maxAttempts = 100) {
  if (!(Number.isInteger(size) && size >= MIN_SIZE && size <= MAX_SIZE)) {
    throw new RangeError(`maze size must be between ${MIN_SIZE} and ${MAX_SIZE}`);
  }
  const palette = pickPalette(colorCount);
  const [start, end] = corners(size);
  for (let i = 0; i < maxAttempts; i++) {
    const grid = carve(size, start, palette);
    const path = solve(grid, start, end);
    if (path) {
      for (const [[r, c], marker] of [[start, START], [end, END]]) {
        grid[r][c] = { color: grid[r][c], marker };
      }
      return { grid, palette, path };
    }
  }
  throw new Error(`no solvable maze after ${maxAttempts} attempts`);
}

function colorOf(value) {
  return typeof value === "object" ? value.color : value;
}

function render(grid, canvas, cell) {
  const size = grid.length;
  canvas.width = canvas.height = size * cell;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  grid.forEach((row, r) => row.forEach((value, c) => drawCell(ctx, value, r, c, cell)));
}

function drawCell(ctx, value, r, c, cell) {
  const x = c * cell;
  const y = r * cell;
  if (value === WALL) {
    ctx.fillStyle = "black";
    ctx.fillRect(x, y, cell, cell);
    return;
  }
  // Grey outline keeps adjacent white squares distinguishable, when there's room for it.
  const outline = cell >= 6;
  ctx.fillStyle = outline ? "#cccccc" : RGB[colorOf(value)];
  ctx.fillRect(x, y, cell, cell);
  if (outline) {
    ctx.fillStyle = RGB[colorOf(value)];
    ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
  }
  if (typeof value === "object") drawMarker(ctx, value.marker, x, y, cell);
}

// The player is a filled black dot with a white ring, distinct from the hollow END circle.
function drawPlayer(ctx, r, c, cell) {
  const radius = Math.max(1, cell * 0.3);
  ctx.beginPath();
  ctx.arc(c * cell + cell / 2, r * cell + cell / 2, radius, 0, 2 * Math.PI);
  ctx.fillStyle = "black";
  ctx.fill();
  ctx.lineWidth = Math.max(1, cell / 12);
  ctx.strokeStyle = "white";
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
