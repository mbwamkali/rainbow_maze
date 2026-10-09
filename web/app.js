// UI: a setup screen for maze size and color count, and a screen showing the maze.

const setupScreen = document.getElementById("setup");
const mazeScreen = document.getElementById("maze");
const form = document.getElementById("setup-form");
const sizeInput = document.getElementById("size");
const colorsInput = document.getElementById("colors");
const colorsHint = document.getElementById("colors-hint");
const layoutInput = document.getElementById("layout");
const layoutHint = document.getElementById("layout-hint");
const error = document.getElementById("error");
const canvas = document.getElementById("canvas");
const info = document.getElementById("info");
const statusLabel = document.getElementById("status");
const message = document.getElementById("message");
const touchControls = window.matchMedia("(pointer: coarse)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const pauseMenu = document.getElementById("pause-menu");
const winMenu = document.getElementById("win-menu");

const COLOR_HINTS = {
  1: "White only",
  2: "White + red",
  3: "White + red + a secondary containing red",
  4: "White + red + a secondary + its other primary",
  5: "White + all 3 primaries + a secondary containing red",
  6: "White + all 3 primaries + 2 secondaries",
  7: "White + all primary and secondary colors",
};

const LAYOUT_HINTS = {
  bands: "Wavy stripes from the upper left to the bottom right",
  blobs: "Patches like countries on a map; the next color can be in any direction",
  tendrils: "Colors wind through each other along the solution; hardest to read",
};

let current = null;
let player = null; // [row, col], always a passage square (odd row and column)
let playerColor = "WHITE";
let flashTick = 0;
let moves = 0;
let solved = false;
let geo = null; // row/column sizes, see geometry()
let anim = null; // the smiley's current slide or bump, see animate()
let messageTimer = 0;

sizeInput.max = MAX_SIZE;
colorsInput.max = MAX_COLORS;

// Each color needs room for its own region, so the minimum size follows the color count.
function updateHint() {
  const minSize = MIN_SIZE_FOR_COLORS[colorsInput.value];
  colorsHint.textContent = `${COLOR_HINTS[colorsInput.value] || ""} · needs a size of at least ${minSize}`;
  document.getElementById("colors-value").textContent = colorsInput.value;
  sizeInput.min = minSize;
  document.getElementById("size-range").textContent = `${minSize}–${MAX_SIZE}`;
}
colorsInput.addEventListener("input", updateHint);
const updateLayoutHint = () => (layoutHint.textContent = LAYOUT_HINTS[layoutInput.value] || "");
layoutInput.addEventListener("change", updateLayoutHint);
updateLayoutHint();
updateHint();

function generate() {
  const size = Number(sizeInput.value);
  const colors = Number(colorsInput.value);
  try {
    current = buildGrid(colors, size, layoutInput.value);
  } catch (e) {
    error.textContent = e.message;
    return false;
  }
  error.textContent = "";
  player = corners(size)[0];
  playerColor = "WHITE";
  moves = 0;
  solved = false;
  anim = null;
  showMessage("");
  updateStatus();
  draw();
  // Colors in the order the regions come, from start to end.
  info.innerHTML = "";
  for (const name of current.palette) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<i style="background:${RGB[name]}"></i>${name.toLowerCase()}`;
    info.append(chip);
  }
  const length = document.createElement("span");
  length.className = "meta";
  length.textContent = `${size}×${size} · ${layoutInput.value} · shortest route ${shortestMoves()} moves`;
  info.append(length);
  return true;
}

// The solution path steps through the thin squares between passages too; a
// move goes from one passage square to the next, so it covers two of those.
const shortestMoves = () => (current.path.length - 1) / 2;

// Fit the maze to the available space, with passages at least 4px wide. Sizes
// are in device pixels so the maze stays sharp on high-DPI screens.
function draw() {
  if (!current) return;
  finishAnimation();
  const size = visibleSize(current.grid);
  const dpr = window.devicePixelRatio || 1;
  const reserved = touchControls.matches ? 330 : 190; // toolbar, status, and the touch pad
  const room = Math.max(100, Math.min(mazeScreen.clientWidth - 32, window.innerHeight - reserved)) * dpr;
  let path = Math.max(4, Math.floor((room * 1.6) / size));
  while (path > 4 && geometry(path, dpr).pos(size) > room) path--;
  geo = geometry(path, dpr);
  render(current.grid, canvas, geo, flashTick);
  drawPlayer(canvas.getContext("2d"), ...player, geo, playerColor);
}

const title = (color) => color[0] + color.slice(1).toLowerCase();
const swatch = (color) => `<i class="swatch" style="background:${RGB[color]}" title="${title(color)}"></i>`;

// "You are red · walks on ■ ■ · Moves: 12". The swatches are the maze's colors
// this player can step onto.
function updateStatus() {
  const walkable = current.palette.filter((color) => canEnter(playerColor, color));
  statusLabel.innerHTML =
    `<span>You are ${swatch(playerColor)} <b>${playerColor.toLowerCase()}</b></span>` +
    `<span>Walks on ${walkable.map(swatch).join("")}</span>` +
    `<span>Moves: <b>${moves}</b></span>`;
}

function showMessage(text) {
  clearTimeout(messageTimer);
  message.textContent = text;
  if (text) messageTimer = setTimeout(() => (message.textContent = ""), 2500);
}

// Why the player can't step onto `target`, or "" for plain walls.
function blockedReason(target) {
  if (target === WALL || target === undefined) return "";
  const color = colorOf(target);
  if (playerColor === "WHITE") return `White can only walk on white. Find a flashing doorway to take on a color.`;
  return `${title(playerColor)} can't walk on ${color.toLowerCase()}.`;
}

// Flash the COLOR_CHANGE squares by redrawing just those, then the player on top
// in case their face spills onto one.
setInterval(() => {
  if (!current || mazeScreen.hidden) return;
  flashTick++;
  const ctx = canvas.getContext("2d");
  for (const [r, c] of current.changers) drawCell(ctx, current.grid, r, c, geo, flashTick);
  if (!anim) drawPlayer(ctx, ...player, geo, playerColor);
}, 400);

const DIRECTIONS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  w: [-1, 0],
  s: [1, 0],
  a: [0, -1],
  d: [0, 1],
};

// Move to the next passage square, through the thin square in between, if the
// player's color allows both steps. Stepping off a COLOR_CHANGE square takes on
// the color of the next square. A blocked move bumps the smiley and says why.
function move([dr, dc]) {
  if (solved) return;
  finishAnimation();
  const grid = current.grid;
  const [r, c] = player;
  const mid = [r + dr, c + dc];
  const next = [r + 2 * dr, c + 2 * dc];
  const midSquare = grid[mid[0]]?.[mid[1]];
  const nextSquare = grid[next[0]]?.[next[1]];
  const midColor = midSquare === undefined ? null : step(playerColor, grid[r][c], midSquare);
  const nextColor = midColor && nextSquare !== undefined ? step(midColor, midSquare, nextSquare) : null;
  if (!nextColor) {
    showMessage(blockedReason(midColor ? nextSquare : midSquare));
    animate({ from: player, to: player, toward: [dr, dc], color: playerColor, cells: [player, mid], bump: true });
    return;
  }
  showMessage("");
  animate({ from: player, to: next, color: nextColor, cells: [player, mid, next] });
  player = next;
  playerColor = nextColor;
  moves++;
  updateStatus();
  if (nextSquare.marker === END) solved = true;
}

// Slide the smiley between squares (or bump it toward a wall and back), blending
// to its new color. Each frame redraws only the squares it passes over.
function animate({ from, to, toward = [0, 0], color, cells, bump = false }) {
  anim = {
    start: performance.now(),
    duration: reducedMotion.matches ? 0 : bump ? 160 : 90,
    from: geo.center(...from),
    to: geo.center(...to),
    toward,
    fromFill: RGB[anim?.color ?? playerColor],
    toFill: RGB[color],
    color,
    cells,
    bump,
  };
  requestAnimationFrame(frame);
}

function frame(now) {
  if (!anim) return;
  const t = anim.duration ? Math.min(1, (now - anim.start) / anim.duration) : 1;
  const ctx = canvas.getContext("2d");
  for (const [r, c] of anim.cells) drawCell(ctx, current.grid, r, c, geo, flashTick);
  const ease = 1 - (1 - t) ** 3;
  let [x, y] = anim.from.map((v, k) => v + (anim.to[k] - v) * ease);
  if (anim.bump) {
    const push = Math.sin(Math.PI * t) * geo.path * 0.15; // out and back
    x += anim.toward[1] * push;
    y += anim.toward[0] * push;
  }
  // Only paint inside the squares just redrawn, so no part of the face is left behind.
  ctx.save();
  ctx.beginPath();
  for (const [r, c] of anim.cells) ctx.rect(geo.pos(c), geo.pos(r), geo.span(c), geo.span(r));
  ctx.clip();
  drawPlayerAt(ctx, x, y, geo, mixColor(anim.fromFill, anim.toFill, ease), anim.bump && t < 1 ? "oops" : "happy");
  ctx.restore();
  if (t < 1) {
    requestAnimationFrame(frame);
    return;
  }
  anim = null;
  if (solved && !winMenu.open) {
    document.getElementById("win-text").textContent =
      `You reached the end in ${moves} moves. The shortest route is ${shortestMoves()} moves.`;
    winMenu.showModal();
  }
}

// Jump to the end of the current animation, so quick key presses never lag behind.
function finishAnimation() {
  if (!anim) return;
  anim.duration = 0;
  frame(performance.now());
}

function mainMenu() {
  pauseMenu.close();
  winMenu.close();
  show(setupScreen);
}

function show(screen) {
  setupScreen.hidden = screen !== setupScreen;
  mazeScreen.hidden = screen !== mazeScreen;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  show(mazeScreen);
  if (!generate()) show(setupScreen);
});
document.getElementById("again").addEventListener("click", (e) => {
  e.currentTarget.blur(); // so Enter/Space don't keep regenerating while playing
  generate();
});
document.getElementById("back").addEventListener("click", mainMenu);
document.getElementById("resume").addEventListener("click", () => pauseMenu.close());
document.getElementById("pause-main").addEventListener("click", mainMenu);
document.getElementById("win-again").addEventListener("click", () => {
  winMenu.close();
  generate();
});
document.getElementById("win-main").addEventListener("click", mainMenu);

window.addEventListener("keydown", (e) => {
  // Open dialogs handle their own keys; Esc closes them (i.e. resumes) natively.
  if (mazeScreen.hidden || pauseMenu.open || winMenu.open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    pauseMenu.showModal();
  } else if (DIRECTIONS[e.key] || DIRECTIONS[e.key.toLowerCase()]) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); // don't scroll the page
    move(DIRECTIONS[e.key] || DIRECTIONS[e.key.toLowerCase()]);
  }
});
document.getElementById("download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(current.grid)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "grid.json";
  link.click();
  URL.revokeObjectURL(link.href);
});
window.addEventListener("resize", draw);

// Touch: swipe on the maze, or hold a button on the direction pad to keep moving.
let swipeStart = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse") swipeStart = [e.clientX, e.clientY];
});
canvas.addEventListener("pointerup", (e) => {
  if (!swipeStart || pauseMenu.open || winMenu.open) return;
  const dx = e.clientX - swipeStart[0];
  const dy = e.clientY - swipeStart[1];
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return; // a tap, not a swipe
  move(Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0]);
});
let repeatTimer = 0;
const stopRepeat = () => clearTimeout(repeatTimer);
for (const button of document.querySelectorAll("#dpad button")) {
  const dir = DIRECTIONS[button.dataset.dir];
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    stopRepeat();
    move(dir);
    const again = (delay) => (repeatTimer = setTimeout(() => (move(dir), again(130)), delay));
    again(300);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(type, stopRepeat);
}

// Optional ?size=…&colors=…&layout=… skips the setup screen, e.g. index.html?size=40&colors=3&layout=blobs
const params = new URLSearchParams(location.search);
if (params.has("layout")) layoutInput.value = params.get("layout");
updateLayoutHint();
if (params.has("size") || params.has("colors") || params.has("layout")) {
  if (params.has("size")) sizeInput.value = params.get("size");
  if (params.has("colors")) colorsInput.value = params.get("colors");
  updateHint();
  form.requestSubmit();
}
