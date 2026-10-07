// UI: a setup screen for maze size and color count, and a screen showing the maze.

const setupScreen = document.getElementById("setup");
const mazeScreen = document.getElementById("maze");
const form = document.getElementById("setup-form");
const sizeInput = document.getElementById("size");
const colorsInput = document.getElementById("colors");
const colorsHint = document.getElementById("colors-hint");
const error = document.getElementById("error");
const canvas = document.getElementById("canvas");
const info = document.getElementById("info");
const movesLabel = document.getElementById("moves");
const pauseMenu = document.getElementById("pause-menu");
const winMenu = document.getElementById("win-menu");

const COLOR_HINTS = {
  1: "White only",
  2: "White + 1 random primary color",
  3: "White + 2 random primary colors",
  4: "White + all 3 primary colors",
  5: "White + 3 primaries + 1 random secondary color",
  6: "White + 3 primaries + 2 random secondary colors",
  7: "White + all primary and secondary colors",
};

let current = null;
let player = null; // [row, col]
let moves = 0;
let solved = false;
let cellSize = 0;

sizeInput.min = MIN_SIZE;
sizeInput.max = MAX_SIZE;
colorsInput.max = MAX_COLORS;
document.getElementById("size-range").textContent = `${MIN_SIZE}–${MAX_SIZE}`;

function updateHint() {
  colorsHint.textContent = COLOR_HINTS[colorsInput.value] || "";
  document.getElementById("colors-value").textContent = colorsInput.value;
}
colorsInput.addEventListener("input", updateHint);
updateHint();

function generate() {
  const size = Number(sizeInput.value);
  const colors = Number(colorsInput.value);
  try {
    current = buildGrid(colors, size);
  } catch (e) {
    error.textContent = e.message;
    return false;
  }
  error.textContent = "";
  player = corners(size)[0];
  moves = 0;
  solved = false;
  updateMoves();
  draw();
  const used = [...new Set(current.grid.flat().map(colorOf))].filter((v) => v !== WALL);
  info.innerHTML = "";
  for (const name of used.sort()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<i style="background:${RGB[name]}"></i>${name.toLowerCase()}`;
    info.append(chip);
  }
  const length = document.createElement("span");
  length.className = "meta";
  length.textContent = `${size}×${size} · shortest solution ${current.path.length} squares`;
  info.append(length);
  return true;
}

// Fit the maze to the available space, never smaller than 2px per square.
function draw() {
  if (!current) return;
  const size = current.grid.length;
  const room = Math.min(mazeScreen.clientWidth - 32, window.innerHeight - 160);
  cellSize = Math.max(2, Math.floor(room / size));
  render(current.grid, canvas, cellSize);
  drawPlayer(canvas.getContext("2d"), ...player, cellSize);
}

function updateMoves() {
  movesLabel.textContent = `Moves: ${moves}`;
}

const DIRECTIONS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

// Step one square if it isn't a wall; only the two affected squares are redrawn.
function move([dr, dc]) {
  const [r, c] = player;
  const nr = r + dr;
  const nc = c + dc;
  const grid = current.grid;
  if (nr < 0 || nr >= grid.length || nc < 0 || nc >= grid.length || grid[nr][nc] === WALL) return;
  const ctx = canvas.getContext("2d");
  drawCell(ctx, grid[r][c], r, c, cellSize);
  player = [nr, nc];
  drawPlayer(ctx, nr, nc, cellSize);
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

// Optional ?size=…&colors=… skips the setup screen, e.g. index.html?size=40&colors=3
const params = new URLSearchParams(location.search);
if (params.has("size") || params.has("colors")) {
  if (params.has("size")) sizeInput.value = params.get("size");
  if (params.has("colors")) colorsInput.value = params.get("colors");
  updateHint();
  form.requestSubmit();
}
