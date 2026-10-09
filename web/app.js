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
const movesLabel = document.getElementById("moves");
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
let player = null; // [row, col]
let playerColor = "WHITE";
let flashTick = 0;
let moves = 0;
let solved = false;
let geo = null; // row/column sizes, see geometry()

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
  updateMoves();
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
  length.textContent = `${size}×${size} · ${layoutInput.value} · shortest solution ${current.path.length} squares`;
  info.append(length);
  return true;
}

// Fit the maze to the available space, with passages at least 4px wide.
function draw() {
  if (!current) return;
  const size = current.grid.length;
  const room = Math.min(mazeScreen.clientWidth - 32, window.innerHeight - 160);
  let path = Math.max(4, Math.floor((room * 1.6) / size));
  while (path > 4 && geometry(path).pos(size) > room) path--;
  geo = geometry(path);
  render(current.grid, canvas, geo, flashTick);
  drawPlayer(canvas.getContext("2d"), ...player, geo, playerColor);
}

// Redraw a square and its neighbors, which the player's face can spill onto.
function redrawAround(ctx, r, c) {
  drawCell(ctx, current.grid, r, c, geo, flashTick);
  for (const [dr, dc] of DIRECTIONS_LIST) drawCell(ctx, current.grid, r + dr, c + dc, geo, flashTick);
}

function updateMoves() {
  movesLabel.textContent = `Moves: ${moves} · You are ${playerColor.toLowerCase()}`;
}

// Flash the COLOR_CHANGE squares by redrawing just those (and the player if on or next to one).
setInterval(() => {
  if (!current || mazeScreen.hidden) return;
  flashTick++;
  const ctx = canvas.getContext("2d");
  for (const [r, c] of current.changers) {
    drawCell(ctx, current.grid, r, c, geo, flashTick);
    if (Math.abs(r - player[0]) + Math.abs(c - player[1]) <= 1) drawPlayer(ctx, ...player, geo, playerColor);
  }
}, 400);

const DIRECTIONS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};
const DIRECTIONS_LIST = Object.values(DIRECTIONS);

// Step one square if the player's color allows it; only the squares around the
// old position are redrawn. Stepping off a COLOR_CHANGE square takes on the color of the next square.
function move([dr, dc]) {
  const [r, c] = player;
  const nr = r + dr;
  const nc = c + dc;
  const grid = current.grid;
  if (nr < 0 || nr >= grid.length || nc < 0 || nc >= grid.length) return;
  const target = grid[nr][nc];
  const nextColor = step(playerColor, grid[r][c], target);
  if (!nextColor) return;
  const ctx = canvas.getContext("2d");
  redrawAround(ctx, r, c);
  player = [nr, nc];
  playerColor = nextColor;
  drawPlayer(ctx, nr, nc, geo, playerColor);
  moves++;
  updateMoves();
  if (grid[nr][nc].marker === END) {
    solved = true;
    document.getElementById("win-text").textContent =
      `You reached the end in ${moves} moves. The shortest route is ${current.path.length - 1} moves.`;
    winMenu.showModal();
  }
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
  } else if (DIRECTIONS[e.key]) {
    e.preventDefault(); // don't scroll the page
    if (!solved) move(DIRECTIONS[e.key]);
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
