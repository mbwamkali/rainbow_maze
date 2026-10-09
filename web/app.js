/**
 * @file The game: the setup screen, the maze screen and everything on it — input
 * (keys, swipes, pinch, the arrow pad), the camera and zoom, the smiley's
 * animation, undo, hints, the route, sound, vibration, menus and the win screen.
 * Uses the rules and drawing code from maze.js.
 */

/**
 * A move as a [row, col] step, e.g. [0, 1] for right.
 * @typedef {[number, number]} Direction
 */

/**
 * The part of the maze shown on the canvas, in device pixels.
 * @typedef {object} View
 * @property {number} x Left edge, from the maze's left edge.
 * @property {number} y Top edge, from the maze's top edge.
 * @property {number} w Width (the canvas width).
 * @property {number} h Height (the canvas height).
 */

/**
 * The result of trying one move: the squares and colors on the way, or why it's blocked.
 * @typedef {object} MoveTry
 * @property {Cell} mid The thin square between the two passage squares.
 * @property {Cell} [next] The passage square landed on, if allowed.
 * @property {string} [midColor] The player's color on `mid`.
 * @property {string} [nextColor] The player's color on `next`.
 * @property {string} [blocked] Why the move isn't allowed ("" for a plain wall).
 */

const setupScreen = document.getElementById("setup");
const mazeScreen = document.getElementById("maze");
const form = document.getElementById("setup-form");
const sizeInput = document.getElementById("size");
const colorsInput = document.getElementById("colors");
const colorsHint = document.getElementById("colors-hint");
const layoutInput = document.getElementById("layout");
const layoutHint = document.getElementById("layout-hint");
const error = document.getElementById("error");
const stage = document.getElementById("stage");
const canvas = document.getElementById("canvas");
const minimap = document.getElementById("minimap");
const buildingNote = document.getElementById("building");
const dpad = document.getElementById("dpad");
const info = document.getElementById("info");
const statusLabel = document.getElementById("status");
const message = document.getElementById("message");
const touchControls = window.matchMedia("(pointer: coarse)");
// Phones get a menu instead of some toolbar buttons; keep in sync with index.html.
const MOBILE_VIEW = "(pointer: coarse) and (max-width: 760px), (pointer: coarse) and (max-height: 500px)";
const mobileView = window.matchMedia(MOBILE_VIEW);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const pauseMenu = document.getElementById("pause-menu");
const winMenu = document.getElementById("win-menu");
const routeButton = document.getElementById("route");
const confettiCanvas = document.getElementById("confetti");
const muteButton = document.getElementById("mute");
const mapShow = document.getElementById("map-show");
const volumeInput = document.getElementById("volume");

const COLOR_HINTS = {
  1: "White only",
  2: "White + red",
  3: "White + red + a secondary containing red",
  4: "White + red + a secondary + its other primary",
  5: "White + all 3 primaries + a secondary containing red",
  6: "White + all 3 primaries + 2 secondaries",
  7: "White + all primary and secondary colors",
};

// Difficulty presets fill in the advanced settings; changing those picks "Custom".
const PRESETS = {
  easy: { size: 31, colors: 3, layout: "bands" },
  medium: { size: 61, colors: 5, layout: "blobs" },
  hard: { size: 101, colors: 7, layout: "tendrils" },
  huge: { size: 201, colors: 7, layout: "blobs" },
};

const LAYOUT_HINTS = {
  bands: "Wavy stripes from the upper left to the bottom right",
  blobs: "Patches like countries on a map; the next color can be in any direction",
  tendrils: "Colors wind through each other along the solution; hardest to read",
};

// Passage widths in CSS pixels. New mazes open zoomed in to COMFORT_PATH when the
// whole maze would be smaller than that; zooming goes from "fit" up to MAX_PATH.
const COMFORT_PATH = 20;
const MAX_PATH = 64;
const ZOOM_STEP = 1.5;

/** @type {?Maze} The maze being played. */
let current = null;
/** @type {?Cell} Where the player is; always a passage square (odd row and column). */
let player = null;
/** @type {string} The player's color. */
let playerColor = "WHITE";
/** @type {number} How many times the doorways have flashed. */
let flashTick = 0;
/** @type {number} Moves this round; a run counts each square. */
let moves = 0;
/** @type {boolean} Whether the player has reached the end. */
let solved = false;
/** @type {?Geometry} Row/column sizes at the current zoom. */
let geo = null;
/** @type {number} Passage width (device pixels) that fits the whole maze on screen. */
let fitPath = 0;
/** @type {View} The part of the maze on the canvas. */
let view = { x: 0, y: 0, w: 0, h: 0 };
/** @type {?HTMLCanvasElement} The whole maze at one pixel per square, for the minimap. */
let minimapBase = null;
/** @type {?object} The smiley's current slide or bump; see animate(). */
let anim = null;
let messageTimer = 0;
/** @type {boolean} Whether a maze is being built. */
let building = false;
/** @type {number} Counts builds, so a build abandoned via the main menu is ignored. */
let buildId = 0;
/** @type {?Worker} The worker building the current maze. */
let activeWorker = null;
/** @type {boolean} Set once workers turn out not to work here; then mazes build on the page. */
let workerBroken = false;
// One round of play, reset by newRound().
/**
 * The state before each move, for undo.
 * @type {Array<{player: Cell, color: string, moves: number, trailLength: number}>}
 */
let history = [];
/** @type {number[]} Squares visited, in order (keys from squareKey). */
let trail = [];
/** @type {Map<number, number>} Square key -> times on the trail. */
let visits = new Map();
/** @type {Set<number>} Squares marked by a hint or the shown route. */
let overlay = new Set();
/** @type {?string} What `overlay` shows: "hint" or "route". */
let overlayKind = null;
/** @type {Cell[]} The shown route, for the minimap. */
let routeCells = [];
let hintTimer = 0;
/** @type {number} Timeout while waiting for a second Restart press. */
let restartArmed = 0;
/**
 * This round's numbers, for the win screen.
 * @type {?{presses: number, hints: number, undos: number, routeShown: boolean}}
 */
let stats = null;
/** @type {{started: boolean, since: ?number, elapsed: number}} Play time in ms; `since` is null while paused. */
let timer = { started: false, since: null, elapsed: 0 };

/** "RED" -> "Red". @param {string} color @returns {string} */
const title = (color) => color[0] + color.slice(1).toLowerCase();
/** A small colored square, as HTML. @param {string} color @returns {string} */
const swatch = (color) => `<i class="swatch" style="background:${RGB[color]}" title="${title(color)}"></i>`;

sizeInput.max = MAX_SIZE;
colorsInput.max = MAX_COLORS;

/**
 * Update the color count's hint and the size limits. Each color needs room for
 * its own region, so the minimum size follows the color count.
 */
function updateHint() {
  const minSize = MIN_SIZE_FOR_COLORS[colorsInput.value];
  colorsHint.textContent = `${COLOR_HINTS[colorsInput.value] || ""} · needs a size of at least ${minSize}`;
  document.getElementById("colors-value").textContent = colorsInput.value;
  sizeInput.min = minSize;
  document.getElementById("size-range").textContent = `${minSize}–${MAX_SIZE}`;
}
colorsInput.addEventListener("input", updateHint);
/** Describe the chosen layout under its menu. */
const updateLayoutHint = () => (layoutHint.textContent = LAYOUT_HINTS[layoutInput.value] || "");
layoutInput.addEventListener("change", updateLayoutHint);
updateLayoutHint();
updateHint();

const advanced = document.getElementById("advanced");
const presetInputs = [...document.querySelectorAll("input[name=preset]")];
/**
 * Fill in the advanced settings from a difficulty preset.
 *
 * @param {string} name A key of PRESETS, or "custom" to open the settings instead.
 */
function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    advanced.open = true; // "Custom": show the settings to choose
    return;
  }
  sizeInput.value = preset.size;
  colorsInput.value = preset.colors;
  layoutInput.value = preset.layout;
  updateHint();
  updateLayoutHint();
}
for (const input of presetInputs) input.addEventListener("change", () => applyPreset(input.value));
/** Select the "Custom" preset (after the settings were edited by hand). */
const pickCustom = () => (presetInputs.find((input) => input.value === "custom").checked = true);
for (const input of [sizeInput, colorsInput, layoutInput]) input.addEventListener("input", pickCustom);

// The "How to play" chart and icons come from the same rules and drawing code as the game.
const CHART_ORDER = ["WHITE", "RED", "GREEN", "BLUE", "YELLOW", "CYAN", "MAGENTA"];
document.getElementById("walk-chart").innerHTML = CHART_ORDER.map((color) => {
  const walks = CHART_ORDER.filter((square) => canEnter(color, square));
  return `<tr><td>${swatch(color)}${color.toLowerCase()}</td><td>${walks.map(swatch).join("")}</td></tr>`;
}).join("");
for (const icon of document.querySelectorAll("canvas[data-icon]")) {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.round(40 * dpr);
  icon.width = icon.height = size;
  const ctx = icon.getContext("2d");
  const kind = icon.dataset.icon;
  ctx.fillStyle = RGB[kind === "end" ? "BLUE" : "WHITE"];
  ctx.fillRect(0, 0, size, size);
  if (kind === "player") {
    drawPlayerAt(ctx, size / 2, size / 2, { path: size }, RGB.WHITE);
  } else if (kind === "doorway") {
    // White on the left, red on the right, and the doorway between them.
    const bar = Math.round(size / 4);
    ctx.fillStyle = RGB.RED;
    ctx.fillRect((size + bar) / 2, 0, size, size);
    drawDoorway(ctx, ["WHITE", "RED"], Math.round((size - bar) / 2), 0, bar, size, 0);
  } else {
    drawMarker(ctx, kind === "start" ? START : END, 0, 0, size);
  }
}

/**
 * The release version query (e.g. "?v=1.0.0") from this script's own URL in
 * index.html, passed on to the worker so every script comes from the same release.
 * @type {string}
 */
const ASSET_VERSION = new URL(document.currentScript.src).search;

/**
 * Build a maze in a Web Worker so big mazes don't freeze the page.
 *
 * If workers aren't allowed here (some sandboxed pages), build on the main
 * thread instead, after a short pause so the "Building maze…" note gets painted first.
 *
 * @param {number} colors How many colors, white included.
 * @param {number} size Squares per side.
 * @param {string} style The layout: "bands", "blobs" or "tendrils".
 * @returns {Promise<Maze>} The maze; rejects with buildGrid()'s error if it can't be built.
 */
function buildMaze(colors, size, style) {
  return new Promise((resolve, reject) => {
    const onMainThread = () =>
      setTimeout(() => {
        try {
          resolve(buildGrid(colors, size, style));
        } catch (e) {
          reject(e);
        }
      }, 50);
    if (workerBroken) return onMainThread();
    let worker;
    try {
      worker = new Worker(`worker.js${ASSET_VERSION}`);
    } catch {
      workerBroken = true;
      return onMainThread();
    }
    activeWorker = worker;
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = (e) => {
      // buildGrid's own errors come back as messages, so this means the worker couldn't load.
      e.preventDefault();
      worker.terminate();
      workerBroken = true;
      onMainThread();
    };
    worker.postMessage({ colors, size, style });
  });
}

/**
 * Show or hide the "Building maze…" note, and disable the buttons that need a maze.
 *
 * @param {boolean} on Whether a maze is being built.
 */
function setBuilding(on) {
  building = on;
  buildingNote.hidden = !on;
  stage.classList.toggle("busy", on);
  for (const id of ["again", "undo", "restart", "hint", "route", "m-undo", "m-restart", "m-route"]) {
    document.getElementById(id).disabled = on;
  }
}

/**
 * Build a new maze from the settings and start playing it. On failure, go back
 * to the setup screen and show the error there.
 *
 * @returns {Promise<void>}
 */
async function generate() {
  if (building) return;
  const id = ++buildId;
  const size = Number(sizeInput.value);
  const colors = Number(colorsInput.value);
  const style = layoutInput.value;
  finishAnimation();
  setBuilding(true);
  let result;
  try {
    result = await buildMaze(colors, size, style);
  } catch (e) {
    if (id !== buildId) return;
    setBuilding(false);
    error.textContent = e.message;
    show(setupScreen);
    return;
  }
  if (id !== buildId) return; // abandoned via the main menu
  setBuilding(false);
  current = result;
  error.textContent = "";
  newRound();
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
  length.textContent = `${size}×${size} · ${style} · shortest route ${shortestMoves()} moves`;
  info.append(length);
  document.getElementById("m-info").innerHTML = info.innerHTML; // the phone menu's copy
  minimapBase = drawMinimapBase(current.grid);
  layoutView(null);
  centerOn(...geo.center(...player));
  paint();
}

// Sound effects, synthesized with Web Audio so there are no files to load. Sound
// starts muted; the viewer's mute and volume choices are remembered in this browser.
const SOUND_KEY = "rainbow-maze-sound";
const sound = { muted: true, volume: 60 }; // volume 0-100
try {
  Object.assign(sound, JSON.parse(localStorage.getItem(SOUND_KEY)) || {});
} catch {}
let audio = null; // { ctx, master }, created on the first sound after unmuting

/** Remember the mute and volume choices in this browser. */
function saveSound() {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(sound));
  } catch {}
}

/**
 * The output gain for the chosen volume. Perceived loudness grows roughly with
 * the square of the gain.
 *
 * @returns {number} 0 to 1.
 */
const masterGain = () => (sound.volume / 100) ** 2;

/**
 * The audio context and master volume, created on first use and resumed if the
 * browser suspended it.
 *
 * @returns {?{ctx: AudioContext, master: GainNode}} Null if this browser has no Web Audio.
 */
function getAudio() {
  if (!audio) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    const ctx = new Context();
    const master = ctx.createGain();
    master.gain.value = masterGain();
    master.connect(ctx.destination);
    audio = { ctx, master };
  }
  // Browsers can refuse to resume (e.g. autoplay rules); then the game just stays quiet.
  if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
  return audio;
}

/**
 * Play one note.
 *
 * @param {{ctx: AudioContext, master: GainNode}} a From getAudio().
 * @param {object} note
 * @param {number} note.freq Starting pitch in Hz.
 * @param {number} [note.to=freq] Pitch to glide to, in Hz.
 * @param {OscillatorType} [note.type="sine"] Waveform.
 * @param {number} [note.at=0] Seconds from now to start.
 * @param {number} [note.length=0.1] Seconds long.
 * @param {number} [note.gain=0.2] Peak loudness, 0 to 1.
 */
function tone(a, { freq, to = freq, type = "sine", at = 0, length = 0.1, gain = 0.2 }) {
  const start = a.ctx.currentTime + at;
  const osc = a.ctx.createOscillator();
  const env = a.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + length);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(a.master);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

// Each color has its own note (semitones above C5), so color changes sound different.
const COLOR_NOTES = { WHITE: 0, RED: 2, YELLOW: 4, GREEN: 5, CYAN: 7, BLUE: 9, MAGENTA: 11 };
/** The pitch in Hz a number of semitones above C5. @param {number} semitones @returns {number} */
const note = (semitones) => 523.25 * 2 ** (semitones / 12);

/**
 * Play a sound effect, unless muted.
 *
 * @param {string} name "step" (one tick per square as the smiley passes it),
 *     "bump", "color" or "win".
 * @param {object} [options]
 * @param {number} [options.steps=1] For "step": how many squares the slide covers.
 * @param {number} [options.duration=0] For "step": how long the slide takes, in ms.
 * @param {string} [options.color="WHITE"] For "color": the new color, which picks the note.
 * @param {number} [options.delay=0] Milliseconds from now to start.
 */
function playSound(name, { steps = 1, duration = 0, color = "WHITE", delay = 0 } = {}) {
  if (sound.muted || !sound.volume) return;
  const a = getAudio();
  if (!a) return;
  const at = delay / 1000;
  if (name === "step") {
    // A run eases in and out (see frame), so square k is reached at
    // acos(1 - 2k/steps) / π of the way. A single step ticks right away.
    const ticks = Math.min(steps, 16);
    for (let k = 0; k < ticks; k++) {
      const when = (Math.acos(1 - (2 * k) / ticks) / Math.PI) * duration / 1000;
      tone(a, { freq: 700, to: 560, type: "triangle", at: at + when, length: 0.045, gain: 0.12 });
    }
  } else if (name === "bump") {
    tone(a, { freq: 150, to: 60, at, length: 0.16, gain: 0.3 });
    tone(a, { freq: 95, to: 55, type: "square", at, length: 0.05, gain: 0.04 });
  } else if (name === "color") {
    const f = note(COLOR_NOTES[color] ?? 0);
    tone(a, { freq: f, at, length: 0.25, gain: 0.16 });
    tone(a, { freq: f * 1.5, at: at + 0.08, length: 0.3, gain: 0.13 });
  } else if (name === "win") {
    [0, 4, 7, 12].forEach((semitones, k) =>
      tone(a, { freq: note(semitones), type: "triangle", at: at + k * 0.11, length: k === 3 ? 0.7 : 0.3, gain: 0.24 }),
    );
  }
}

/**
 * Change the sound settings, save them, and update the controls.
 *
 * @param {{muted?: boolean, volume?: number}} changes Volume is 0 to 100.
 */
function setSound(changes) {
  Object.assign(sound, changes);
  saveSound();
  if (audio) audio.master.gain.setTargetAtTime(masterGain(), audio.ctx.currentTime, 0.02);
  updateSoundControls();
}

/** Make the mute buttons and volume sliders match the sound settings. */
function updateSoundControls() {
  const on = !sound.muted && sound.volume > 0;
  for (const button of [muteButton, document.getElementById("m-mute")]) {
    button.setAttribute("aria-pressed", String(!on));
    button.textContent = on ? "🔊" : "🔇";
    button.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    button.title = `${on ? "Sound on" : "Sound off"} (M)`;
  }
  volumeInput.value = document.getElementById("m-volume").value = sound.volume;
}

/** Go back to the start of the current maze with a clean slate. */
function newRound() {
  player = corners(current.grid.length)[0];
  playerColor = "WHITE";
  moves = 0;
  solved = false;
  anim = null;
  history = [];
  trail = [squareKey(...player)];
  visits = new Map([[trail[0], 1]]);
  overlay = new Set();
  overlayKind = null;
  routeCells = [];
  clearTimeout(hintTimer);
  setRouteButton(false);
  stats = { presses: 0, hints: 0, undos: 0, routeShown: false };
  timer = { started: false, since: null, elapsed: 0 };
  showMessage("");
  updateStatus();
}

/** A square as one number, for sets and maps. @param {number} r @param {number} c @returns {number} */
const squareKey = (r, c) => r * current.grid.length + c;
/** The square for a key from squareKey(). @param {number} key @returns {Cell} */
const squareOf = (key) => [Math.floor(key / current.grid.length), key % current.grid.length];

/** Start or resume the timer. It starts with the first move and stops while paused or after winning. */
function startTimer() {
  if (!timer.started) timer.started = true;
  if (timer.since === null) timer.since = performance.now();
}
/** Pause the timer, keeping the time so far. */
function pauseTimer() {
  if (timer.since === null) return;
  timer.elapsed += performance.now() - timer.since;
  timer.since = null;
}
/** Play time so far, in ms. @returns {number} */
const elapsed = () => timer.elapsed + (timer.since === null ? 0 : performance.now() - timer.since);
/**
 * Format a time as minutes and seconds.
 *
 * @param {number} ms The time in ms.
 * @returns {string} E.g. "2:05".
 */
function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** Show the current play time in the status line. */
function updateTime() {
  const label = document.getElementById("time");
  if (label) label.textContent = formatTime(elapsed());
}

/**
 * The fewest moves that solve the maze. The solution path steps through the thin
 * squares between passages too; a move goes from one passage square to the next,
 * so it covers two of those.
 *
 * @returns {number}
 */
const shortestMoves = () => (current.path.length - 1) / 2;

/**
 * Size the canvas to the space left on screen and pick the passage width. All
 * sizes are in device pixels so the maze stays sharp on high-DPI screens.
 *
 * @param {?number} path The wanted passage width in device pixels, or null for a
 *     new maze's default: the whole maze if that's comfortable to play, else zoomed in.
 */
function layoutView(path) {
  const size = visibleSize(current.grid);
  const dpr = window.devicePixelRatio || 1;
  const top = stage.getBoundingClientRect().top + window.scrollY;
  // Room to leave under the maze: the exit button in full screen, else the arrow
  // pad, unless the pad sits beside the maze (touch screens held sideways).
  const exitButton = document.getElementById("exit-fullscreen");
  const padBeside = getComputedStyle(document.querySelector(".play-area")).display === "flex";
  const below = fullScreen()
    ? exitButton.offsetHeight + 16
    : touchControls.matches && !padBeside ? dpad.offsetHeight + 32 : 16;
  const beside = padBeside && dpad.offsetWidth ? dpad.offsetWidth + 16 : 0;
  // The card's padding and border around the canvas (none on phones).
  const box = getComputedStyle(stage);
  const edge = (a, b) => parseFloat(box[`padding${a}`]) + parseFloat(box[`padding${b}`]) +
    parseFloat(box[`border${a}Width`]) + parseFloat(box[`border${b}Width`]);
  const roomW = Math.max(160, mazeScreen.clientWidth - edge("Left", "Right") - beside) * dpr;
  const roomH = Math.max(160, window.innerHeight - top - below - edge("Top", "Bottom")) * dpr;
  const room = Math.min(roomW, roomH);
  fitPath = Math.max(2, Math.floor((room * 1.6) / size));
  while (fitPath > 2 && geometry(fitPath, dpr).pos(size) > room) fitPath--;
  if (path === null) path = Math.max(fitPath, Math.round(COMFORT_PATH * dpr));
  geo = geometry(Math.min(Math.max(path, fitPath), Math.round(MAX_PATH * dpr)), dpr);
  const mazePx = geo.pos(size);
  view.w = Math.floor(Math.min(mazePx, roomW));
  view.h = Math.floor(Math.min(mazePx, roomH));
  canvas.width = view.w;
  canvas.height = view.h;
  canvas.style.width = `${view.w / dpr}px`;
  canvas.style.height = `${view.h / dpr}px`;
}

/**
 * Keep a view offset inside the maze.
 *
 * @param {{x: number, y: number}} spot A view offset in device pixels.
 * @returns {{x: number, y: number}} The nearest offset that stays inside the maze, in whole pixels.
 */
function clampSpot({ x, y }) {
  const mazePx = geo.pos(visibleSize(current.grid));
  return {
    x: Math.round(Math.min(Math.max(x, 0), mazePx - view.w)),
    y: Math.round(Math.min(Math.max(y, 0), mazePx - view.h)),
  };
}
/** Keep the view inside the maze. */
function clampView() {
  Object.assign(view, clampSpot(view));
}

/**
 * Jump the view so a point is in the middle (as far as the maze edges allow).
 *
 * @param {number} x Device pixels from the maze's left edge.
 * @param {number} y Device pixels from the maze's top edge.
 */
function centerOn(x, y) {
  camTarget = null; // a jump, not a glide
  view.x = x - view.w / 2;
  view.y = y - view.h / 2;
  clampView();
}

// On phones the view glides toward the smiley and keeps it nearer the middle;
// elsewhere it moves in step with the smiley.
/** @type {?{x: number, y: number}} Where a gliding view is heading, or null when it's still. */
let camTarget = null;
/** @type {number} When the glide last moved (a frame timestamp). */
let camTime = 0;
/** Whether the view glides (phones, unless reduced motion is asked for). @returns {boolean} */
const glideCamera = () => mobileView.matches && !reducedMotion.matches;

/**
 * Keep a point away from the canvas edges: the view only moves once the smiley
 * gets within 30% of an edge (35% on phones, where it glides there).
 *
 * @param {number} x Device pixels from the maze's left edge.
 * @param {number} y Device pixels from the maze's top edge.
 * @param {number} [now=performance.now()] The frame's timestamp, for gliding.
 * @returns {boolean} Whether the view moved.
 */
function follow(x, y, now = performance.now()) {
  const glide = glideCamera();
  const aim = glide ? { ...(camTarget || view) } : view;
  const { x: oldX, y: oldY } = view;
  const share = glide ? 0.35 : 0.3;
  const mx = view.w * share;
  const my = view.h * share;
  if (x - aim.x < mx) aim.x = x - mx;
  if (x - aim.x > view.w - mx) aim.x = x - (view.w - mx);
  if (y - aim.y < my) aim.y = y - my;
  if (y - aim.y > view.h - my) aim.y = y - (view.h - my);
  if (!glide) {
    clampView();
    return view.x !== oldX || view.y !== oldY;
  }
  camTarget = clampSpot(aim);
  return glideStep(now);
}

/**
 * Move a gliding view part of the way to its target: about 60% of the way in
 * 150ms, and at least a pixel, so it eases in without stalling.
 *
 * @param {number} now The frame's timestamp.
 * @returns {boolean} Whether the view moved.
 */
function glideStep(now) {
  if (!camTarget) return false;
  const dt = Math.min(64, Math.max(0, now - camTime) || 16);
  camTime = now;
  const k = 1 - Math.exp(-dt / 160);
  const { x: oldX, y: oldY } = view;
  for (const axis of ["x", "y"]) {
    const gap = camTarget[axis] - view[axis];
    const step = Math.round(gap * k);
    view[axis] += Math.abs(step) >= 1 ? step : Math.sign(gap);
  }
  if (view.x === camTarget.x && view.y === camTarget.y) camTarget = null;
  return view.x !== oldX || view.y !== oldY;
}

/**
 * Keep a gliding view moving after the smiley stops (the slide draws its own frames).
 *
 * @param {number} now The frame's timestamp.
 */
function glideFrame(now) {
  if (!camTarget || anim || !current) return;
  if (glideStep(now)) paint();
  if (camTarget) requestAnimationFrame(glideFrame);
}
/** Start gliding frames if the view still has somewhere to go. */
function startGlide() {
  if (!camTarget) return;
  camTime = performance.now();
  requestAnimationFrame(glideFrame);
}

/**
 * The row or column at a pixel offset (the inverse of geo.pos).
 *
 * @param {number} px Device pixels from the maze's top or left edge.
 * @returns {number} The row or column, kept inside the maze.
 */
function indexAt(px) {
  const pair = geo.path + geo.wall;
  const n = Math.floor(px / pair);
  return Math.min(visibleSize(current.grid) - 1, Math.max(0, 2 * n + (px - n * pair >= geo.wall ? 1 : 0)));
}

/**
 * Redraw every square in view (but not the player). The canvas keeps a
 * translation by the view offset, so everything else draws in maze coordinates.
 */
function paintSquares() {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(1, 0, 0, 1, -view.x, -view.y);
  const [r0, r1] = [indexAt(view.y), indexAt(view.y + view.h - 1)];
  const [c0, c1] = [indexAt(view.x), indexAt(view.x + view.w - 1)];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) drawSquare(ctx, r, c);
}

/**
 * Draw a maze square plus what this round adds on top: trail dots where the
 * player has been, and white dots for a hint or the shown route. Dots stay inside
 * the square so redrawing one square never leaves marks on another.
 *
 * @param {CanvasRenderingContext2D} ctx The maze canvas.
 * @param {number} r Row.
 * @param {number} c Column.
 */
function drawSquare(ctx, r, c) {
  drawCell(ctx, current.grid, r, c, geo, flashTick);
  if (current.grid[r]?.[c] === undefined) return;
  const key = squareKey(r, c);
  const room = Math.min(geo.span(r), geo.span(c)) / 2 - 0.5;
  const [x, y] = geo.center(r, c);
  if (visits.get(key)) {
    const radius = Math.min(geo.path * 0.1, room);
    if (radius >= 0.75) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = "rgb(0 0 0 / 0.3)";
      ctx.fill();
    }
  }
  if (overlay.has(key)) {
    const radius = Math.min(geo.path * 0.17, room);
    if (radius >= 1) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = "black";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.6, 0, 2 * Math.PI);
      ctx.fillStyle = "white";
      ctx.fill();
    }
  }
}

/**
 * How big the face is on a square: smaller on the start and end so their icons show around it.
 * @param {number} r @param {number} c @returns {number}
 */
const faceScale = (r, c) => (current.grid[r]?.[c]?.marker ? 0.65 : 1);
/** Draw the player, standing still, where they are. @param {CanvasRenderingContext2D} ctx */
const drawPlayerNow = (ctx) => drawPlayer(ctx, ...player, geo, playerColor, "happy", faceScale(...player));

/** Redraw the view, the player (unless mid-slide) and the minimap. */
function paint() {
  if (!current) return;
  paintSquares();
  if (!anim) drawPlayerNow(canvas.getContext("2d"));
  updateMinimap();
}

/**
 * Draw the whole maze at one pixel per square, once per maze, for the minimap.
 *
 * @param {Square[][]} grid The maze.
 * @returns {HTMLCanvasElement} An offscreen canvas.
 */
function drawMinimapBase(grid) {
  const size = visibleSize(grid);
  const base = document.createElement("canvas");
  base.width = base.height = size;
  const ctx = base.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const value = grid[r][c];
      const hex = value === WALL ? "#000000" : value === COLOR_CHANGE ? "#808080" : RGB[colorOf(value)];
      const k = 4 * (r * size + c);
      for (let ch = 0; ch < 3; ch++) image.data[k + ch] = parseInt(hex.slice(1 + 2 * ch, 3 + 2 * ch), 16);
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return base;
}

/**
 * When zoomed in, show the whole maze in a corner with the visible part
 * outlined, the route if shown, and the player. When folded, show the Map button instead.
 */
function updateMinimap() {
  const size = visibleSize(current.grid);
  const mazePx = geo.pos(size);
  const zoomed = mazePx > view.w || mazePx > view.h;
  // Clicking or tapping the map folds it away to a Map button. On phones it's smaller.
  const phone = mobileView.matches;
  const folded = zoomed && minimapFolded;
  minimap.hidden = !zoomed || folded;
  mapShow.hidden = !folded;
  if (minimap.hidden) {
    if (folded) placeMap(mapShow);
    return;
  }
  const dpr = geo.dpr;
  const share = phone ? 4 : 3;
  const side = Math.round(Math.min(phone ? 120 : 160, view.w / dpr / share, view.h / dpr / share) * dpr);
  if (minimap.width !== side) {
    minimap.width = minimap.height = side;
    minimap.style.width = minimap.style.height = `${side / dpr}px`;
  }
  const ctx = minimap.getContext("2d");
  ctx.imageSmoothingEnabled = side < size;
  ctx.drawImage(minimapBase, 0, 0, side, side);
  const scale = side / mazePx;
  ctx.lineWidth = Math.max(1, dpr * 1.5);
  ctx.strokeStyle = "#2563eb";
  ctx.strokeRect(view.x * scale, view.y * scale, view.w * scale, view.h * scale);
  if (overlayKind === "route" && routeCells.length > 1) {
    ctx.beginPath();
    for (const cell of routeCells) ctx.lineTo(...geo.center(...cell).map((v) => v * scale));
    ctx.lineJoin = "round";
    for (const [color, width] of [["black", 3 * dpr], ["white", 1.5 * dpr]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }
  const [x, y] = geo.center(...player);
  ctx.beginPath();
  ctx.arc(x * scale, y * scale, Math.max(2.5 * dpr, side / 40), 0, 2 * Math.PI);
  ctx.fillStyle = RGB[playerColor];
  ctx.fill();
  ctx.lineWidth = dpr;
  ctx.strokeStyle = "black";
  ctx.stroke();
  placeMap(minimap);
}

/** The corners the minimap can sit in, as values of the stage's data-map-corner. */
const MAP_CORNERS = ["top-right", "top-left", "bottom-right", "bottom-left"];
/**
 * Keep the map (or the Map button) clear of the smiley: when the smiley comes
 * near it, it moves to the corner farthest from the smiley. Otherwise it stays
 * put, so it doesn't jump back and forth.
 *
 * @param {HTMLElement} el The minimap, or the Map button when the map is folded.
 */
function placeMap(el) {
  const box = canvas.getBoundingClientRect();
  const own = el.getBoundingClientRect();
  const corner = stage.dataset.mapCorner || "top-right";
  // The gaps between the map and the canvas edges it sits against (CSS pixels).
  const gapX = corner.endsWith("left") ? own.left - box.left : box.right - own.right;
  const gapY = corner.startsWith("bottom") ? box.bottom - own.bottom : own.top - box.top;
  const spot = (name) => ({
    x: name.endsWith("left") ? gapX : box.width - gapX - own.width,
    y: name.startsWith("bottom") ? box.height - gapY - own.height : gapY,
  });
  // The smiley's square and some room around it, on the canvas in CSS pixels.
  const [cx, cy] = geo.center(...player);
  const [x, y] = [(cx - view.x) / geo.dpr, (cy - view.y) / geo.dpr];
  const path = geo.path / geo.dpr;
  const reach = path / 2 + Math.max(24, path * 1.5);
  const near = (s) => x + reach > s.x && x - reach < s.x + own.width && y + reach > s.y && y - reach < s.y + own.height;
  if (!near(spot(corner))) return;
  const distance = (s) => Math.hypot(s.x + own.width / 2 - x, s.y + own.height / 2 - y);
  stage.dataset.mapCorner = MAP_CORNERS.reduce((a, b) => (distance(spot(b)) > distance(spot(a)) ? b : a));
}

/**
 * Zoom, keeping the player in view.
 *
 * @param {number} path The new passage width in device pixels; kept between "fit" and MAX_PATH.
 */
function zoomTo(path) {
  if (!current || building) return;
  finishAnimation();
  layoutView(path);
  centerOn(...geo.center(...player));
  paint();
}
/** Zoom in one step. */
const zoomIn = () => geo && zoomTo(Math.round(geo.path * ZOOM_STEP));
/** Zoom out one step. */
const zoomOut = () => geo && zoomTo(Math.round(geo.path / ZOOM_STEP));
/** Zoom out to show the whole maze. */
const zoomFit = () => zoomTo(fitPath);

/**
 * Update the status line: "You are red · walks on ■ ■ · Moves: 12 · Time: 0:42".
 * The swatches are the maze's colors this player can step onto.
 */
function updateStatus() {
  const walkable = current.palette.filter((color) => canEnter(playerColor, color));
  statusLabel.innerHTML =
    `<span>You are ${swatch(playerColor)} <b>${playerColor.toLowerCase()}</b></span>` +
    `<span class="walks">Walks on ${walkable.map(swatch).join("")}</span>` +
    `<span>Moves: <b>${moves}</b></span>` +
    `<span>Time: <b id="time">${formatTime(elapsed())}</b></span>`;
}

/**
 * Show a message under the status line for a few seconds.
 *
 * @param {string} text The message, or "" to clear it.
 */
function showMessage(text) {
  clearTimeout(messageTimer);
  message.textContent = text;
  if (text) messageTimer = setTimeout(() => (message.textContent = ""), 2500);
}

/**
 * Explain why a move is blocked.
 *
 * @param {string} color The player's color.
 * @param {Square} [target] The square they couldn't step onto.
 * @returns {string} The reason, or "" for plain walls and the maze's edge.
 */
function blockedReason(color, target) {
  if (target === WALL || target === undefined) return "";
  if (color === "WHITE") return `White can only walk on white. Find a flashing doorway to take on a color.`;
  return `${title(color)} can't walk on ${colorOf(target).toLowerCase()}.`;
}

// Swap the stripes on the COLOR_CHANGE squares by redrawing just those, then the
// player on top in case their face spills onto one. Also ticks the timer.
// The stripes hold still when the browser asks for reduced motion.
setInterval(() => {
  if (!current || mazeScreen.hidden || building) return;
  updateTime();
  if (reducedMotion.matches) return;
  flashTick++;
  const ctx = canvas.getContext("2d");
  for (const [r, c] of current.changers) drawSquare(ctx, r, c);
  if (!anim) drawPlayerNow(ctx);
}, 400);

/** @type {Object<string, Direction>} Keys (and pad buttons) to directions. */
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
/** @type {Direction[]} Up, down, left, right. */
const DIRECTION_LIST = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * Try one move from a passage square, through the thin square in between.
 * Stepping off a COLOR_CHANGE square takes on the color of the next square.
 *
 * @param {Cell} at The passage square to move from.
 * @param {string} color The player's color there.
 * @param {Direction} dir The way to go.
 * @returns {MoveTry} The squares and the colors after each, or why it's blocked.
 */
function tryMove(at, color, [dr, dc]) {
  const grid = current.grid;
  const mid = [at[0] + dr, at[1] + dc];
  const next = [at[0] + 2 * dr, at[1] + 2 * dc];
  const midSquare = grid[mid[0]]?.[mid[1]];
  const nextSquare = grid[next[0]]?.[next[1]];
  const midColor = midSquare === undefined ? null : step(color, grid[at[0]][at[1]], midSquare);
  if (!midColor) return { blocked: blockedReason(color, midSquare), mid };
  const nextColor = nextSquare === undefined ? null : step(midColor, midSquare, nextSquare);
  if (!nextColor) return { blocked: blockedReason(midColor, nextSquare), mid };
  return { mid, next, midColor, nextColor };
}

/**
 * Move one square, or run along the corridor.
 *
 * A run stops at a junction, a dead end, a color change or the end; without
 * `corners` it also stops at the first bend. A blocked first move bumps the
 * smiley and says why.
 *
 * @param {Direction} dir The way to go.
 * @param {boolean} [run=false] Keep going instead of stopping after one square.
 * @param {boolean} [corners=true] Let a run follow bends.
 */
function move(dir, run = false, corners = true) {
  if (solved || building || !current) return;
  finishAnimation();
  const first = tryMove(player, playerColor, dir);
  if (first.blocked !== undefined) {
    showMessage(first.blocked);
    playSound("bump");
    buzz(25);
    animate({ cells: [player, first.mid], points: [player], fills: [playerColor], toward: dir, bump: true });
    return;
  }
  showMessage("");
  const cells = [player];
  const fills = [playerColor];
  let [at, color, heading, steps] = [player, playerColor, dir, 0];
  for (let m = first; ; ) {
    cells.push(m.mid, m.next);
    fills.push(m.midColor, m.nextColor);
    steps++;
    const changed = m.nextColor !== color;
    [at, color] = [m.next, m.nextColor];
    if (!run || changed || current.grid[at[0]][at[1]].marker === END || steps >= 500) break;
    // Only open, walkable ways out count; the way back doesn't.
    const ways = DIRECTION_LIST.filter(([dr, dc]) => !(dr === -heading[0] && dc === -heading[1]))
      .map((d) => ({ d, m: tryMove(at, color, d) }))
      .filter(({ m: way }) => way.blocked === undefined);
    if (ways.length !== 1) break;
    if (!corners && (ways[0].d[0] !== heading[0] || ways[0].d[1] !== heading[1])) break;
    [heading, m] = [ways[0].d, ways[0].m];
  }
  history.push({ player, color: playerColor, moves, trailLength: trail.length });
  for (const [r, c] of cells.slice(1)) {
    const key = squareKey(r, c);
    trail.push(key);
    visits.set(key, (visits.get(key) || 0) + 1);
  }
  stats.presses++;
  startTimer();
  clearHint();
  if (overlayKind === "route") {
    showRoute(at, color); // repaints, so put the face back until the slide starts
    drawPlayerNow(canvas.getContext("2d"));
  }
  animate({ cells, points: cells, fills, toward: dir, steps });
  playSound("step", { steps, duration: anim.duration });
  // A run stops right after a color change, so the change is at the end of the slide.
  if (color !== playerColor) {
    playSound("color", { color, delay: anim.duration * 0.6 });
    buzz([15, 40, 15], anim.duration * 0.6);
  }
  player = at;
  playerColor = color;
  moves += steps;
  updateStatus();
  if (current.grid[at[0]][at[1]].marker === END) {
    solved = true;
    pauseTimer();
  }
}

/** Step back before the last move or run, restoring color, moves and trail. */
function undo() {
  if (building || !current || solved || !history.length) return;
  finishAnimation();
  const before = history.pop();
  while (trail.length > before.trailLength) {
    const key = trail.pop();
    visits.set(key, visits.get(key) - 1);
  }
  player = before.player;
  playerColor = before.color;
  moves = before.moves;
  stats.undos++;
  clearHint();
  showMessage("");
  if (overlayKind === "route") showRoute(player, playerColor, false);
  follow(...geo.center(...player));
  paint();
  startGlide();
  updateStatus();
}

/** Start this maze over. Asks for a second press, since it throws away the round so far. */
function restart() {
  if (building || !current || (moves === 0 && !solved)) return;
  finishAnimation();
  if (!restartArmed) {
    showMessage("Press R or Restart again to start this maze over.");
    restartArmed = setTimeout(() => (restartArmed = 0), 2500);
    return;
  }
  clearTimeout(restartArmed);
  restartArmed = 0;
  newRound();
  centerOn(...geo.center(...player));
  paint();
}

/**
 * The shortest way to the end. It follows the color rules, so it can pass a
 * square twice in different colors.
 *
 * @param {Cell} at Where to start.
 * @param {string} color The player's color there.
 * @returns {?Cell[]} The squares to the end, or null if there's no way from here.
 */
function routeFrom(at, color) {
  return solve(current.grid, at, corners(current.grid.length)[1], null, color);
}

/** Mark the next few squares of the way to the end for a few seconds. */
function hint() {
  if (building || !current || solved) return;
  finishAnimation();
  if (overlayKind === "route") {
    showMessage("The route is already showing.");
    return;
  }
  const route = routeFrom(player, playerColor);
  if (!route) {
    showMessage("There's no way to the end from here. Try Undo or Restart.");
    return;
  }
  clearHint();
  const ahead = route.slice(1, 13);
  overlay = new Set(ahead.map((cell) => squareKey(...cell)));
  overlayKind = "hint";
  const ctx = canvas.getContext("2d");
  for (const cell of ahead) drawSquare(ctx, ...cell);
  drawPlayerNow(ctx);
  stats.hints++;
  const names = { "-1,0": "up", "1,0": "down", "0,-1": "left", "0,1": "right" };
  showMessage(`Hint: head ${names[[route[1][0] - player[0], route[1][1] - player[1]].join()]}.`);
  hintTimer = setTimeout(clearHint, 4000);
}

/** Remove the hint's marks, if any. */
function clearHint() {
  clearTimeout(hintTimer);
  if (overlayKind !== "hint") return;
  const cells = [...overlay].map(squareOf);
  overlay = new Set();
  overlayKind = null;
  const ctx = canvas.getContext("2d");
  for (const cell of cells) drawSquare(ctx, ...cell);
  if (!anim) drawPlayerNow(ctx);
}

/**
 * Mark the whole way to the end, on the maze and the minimap.
 *
 * @param {Cell} at Where to start.
 * @param {string} color The player's color there.
 * @param {boolean} [repaint=true] Redraw now; false when the caller repaints anyway.
 */
function showRoute(at, color, repaint = true) {
  const route = routeFrom(at, color) || [];
  routeCells = route;
  overlay = new Set(route.slice(1).map((cell) => squareKey(...cell)));
  overlayKind = "route";
  if (repaint) {
    paintSquares();
    updateMinimap();
  }
}

/** Show or hide the whole route. */
function toggleRoute() {
  if (building || !current || solved) return;
  finishAnimation();
  clearHint();
  if (overlayKind === "route") {
    overlay = new Set();
    overlayKind = null;
    routeCells = [];
    setRouteButton(false);
  } else {
    stats.routeShown = true;
    showRoute(player, playerColor, false);
    setRouteButton(true);
  }
  paint();
}

/**
 * Make the Show route buttons match whether the route is showing.
 *
 * @param {boolean} on Whether the route is showing.
 */
function setRouteButton(on) {
  for (const button of [routeButton, document.getElementById("m-route")]) {
    button.setAttribute("aria-pressed", on);
    button.textContent = on ? "Hide route" : "Show route";
  }
}

/**
 * Slide the smiley along squares, blending between colors, or bump it and back.
 * Each frame redraws only `cells`, unless the view has to scroll to keep up, and
 * then it redraws everything in view.
 *
 * @param {object} motion
 * @param {Cell[]} motion.cells The squares the animation can touch.
 * @param {Cell[]} motion.points The squares to slide through, in order.
 * @param {string[]} motion.fills The player's color on each of `points`.
 * @param {Direction} motion.toward The way the player moved (or tried to).
 * @param {boolean} [motion.bump=false] Bump toward `toward` and back instead of sliding.
 * @param {number} [motion.steps=1] Passage squares covered, which sets the duration.
 */
function animate({ cells, points, fills, toward, bump = false, steps = 1 }) {
  anim = {
    start: performance.now(),
    duration: reducedMotion.matches ? 0 : bump ? 160 : Math.min(110 + (steps - 1) * 75, 1500),
    steps,
    cells,
    pointSquares: points,
    points: points.map((p) => geo.center(...p)),
    fills: fills.map((color) => RGB[color]),
    toward,
    bump,
  };
  requestAnimationFrame(frame);
}

/**
 * Draw one frame of the current animation, and ask for the next until it's done.
 *
 * @param {number} now The frame's timestamp.
 */
function frame(now) {
  if (!anim) return;
  // A frame's timestamp is when the browser started the frame, which can be a
  // moment before the key press that started this animation, so clamp at 0.
  const t = anim.duration ? Math.min(1, Math.max(0, (now - anim.start) / anim.duration)) : 1;
  // One square eases out quickly; a run starts and ends gently.
  const ease = anim.steps > 1 ? 0.5 - Math.cos(Math.PI * t) / 2 : 1 - (1 - t) ** 3;
  const last = anim.points.length - 1;
  const u = ease * last;
  const i = Math.min(Math.floor(u), Math.max(0, last - 1));
  const f = last ? u - i : 0;
  const a = anim.points[i];
  const b = anim.points[Math.min(i + 1, last)];
  let x = a[0] + (b[0] - a[0]) * f;
  let y = a[1] + (b[1] - a[1]) * f;
  const fill = mixColor(anim.fills[i], anim.fills[Math.min(i + 1, last)], f);
  if (anim.bump) {
    const push = Math.sin(Math.PI * t) * geo.path * 0.15; // out and back
    x += anim.toward[1] * push;
    y += anim.toward[0] * push;
  }
  const ctx = canvas.getContext("2d");
  if (follow(x, y, now)) {
    paintSquares();
    updateMinimap();
  } else {
    for (const [r, c] of anim.cells) drawSquare(ctx, r, c);
  }
  // Only paint inside the squares just redrawn, so no part of the face is left behind.
  ctx.save();
  ctx.beginPath();
  for (const [r, c] of anim.cells) ctx.rect(geo.pos(c), geo.pos(r), geo.span(c), geo.span(r));
  ctx.clip();
  const near = anim.pointSquares[f < 0.5 ? i : Math.min(i + 1, last)];
  drawPlayerAt(ctx, x, y, geo, fill, anim.bump && t < 1 ? "oops" : "happy", faceScale(...near));
  ctx.restore();
  if (t < 1) {
    requestAnimationFrame(frame);
    return;
  }
  anim = null;
  updateMinimap();
  startGlide();
  if (solved && !winMenu.open) showWin();
}

/** Show the win screen with this round's stats, with sound, vibration and confetti. */
function showWin() {
  const shortest = shortestMoves();
  const perfect = moves === shortest && !stats.routeShown && !stats.hints;
  document.getElementById("win-text").textContent = perfect
    ? "A perfect run: the shortest route, with no help."
    : `You reached the end in ${moves} moves.`;
  const rows = [
    ["Moves", `${moves} (shortest ${shortest} · ${Math.round((100 * shortest) / moves)}% efficient)`],
    ["Time", formatTime(elapsed())],
    ["Presses and swipes", stats.presses],
    ["Hints", stats.hints],
    ["Undos", stats.undos],
    ["Route shown", stats.routeShown ? "Yes" : "No"],
  ];
  document.getElementById("win-stats").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  winMenu.showModal();
  playSound("win");
  buzz([40, 60, 40, 60, 80]);
  confetti();
}

/** Rainbow confetti over the win screen for a couple of seconds. */
function confetti() {
  if (reducedMotion.matches) return;
  const dpr = window.devicePixelRatio || 1;
  const w = (confettiCanvas.width = window.innerWidth * dpr);
  const h = (confettiCanvas.height = window.innerHeight * dpr);
  const ctx = confettiCanvas.getContext("2d");
  const colors = Object.values(RGB).filter((c) => c !== RGB.WHITE);
  const pieces = Array.from({ length: 160 }, () => ({
    x: Math.random() * w,
    y: -Math.random() * h * 0.5,
    vx: (Math.random() - 0.5) * 4 * dpr,
    vy: (2 + Math.random() * 4) * dpr,
    spin: (Math.random() - 0.5) * 0.3,
    angle: Math.random() * Math.PI,
    size: (6 + Math.random() * 6) * dpr,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const tick = (now) => {
    ctx.clearRect(0, 0, w, h);
    if (now - start > 3000 || !winMenu.open) return;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08 * dpr;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Jump to the end of the current animation, so quick key presses never lag behind. */
function finishAnimation() {
  if (!anim) return;
  anim.duration = 0;
  frame(performance.now());
}

/** Go back to the setup screen, closing menus and dropping a maze being built. */
function mainMenu() {
  setMenu(false);
  setFullScreen(false);
  pauseMenu.close();
  winMenu.close();
  pauseTimer();
  if (building) {
    buildId++; // drop the maze being built
    activeWorker?.terminate();
    setBuilding(false);
  }
  show(setupScreen);
}

/**
 * Show one screen and hide the other.
 *
 * @param {HTMLElement} screen The setup screen or the maze screen.
 */
function show(screen) {
  setupScreen.hidden = screen !== setupScreen;
  mazeScreen.hidden = screen !== mazeScreen;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  show(mazeScreen);
  generate();
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
document.getElementById("zoom-in").addEventListener("click", zoomIn);
document.getElementById("zoom-out").addEventListener("click", zoomOut);
document.getElementById("zoom-fit").addEventListener("click", zoomFit);
/** Mute or unmute. Unmuting (or moving the volume) plays a tick so you can hear the level. */
function toggleMute() {
  setSound({ muted: !sound.muted, volume: sound.volume || 60 });
  playSound("step");
}
muteButton.addEventListener("click", (e) => {
  e.currentTarget.blur();
  toggleMute();
});
for (const slider of [volumeInput, document.getElementById("m-volume")]) {
  slider.addEventListener("input", () => setSound({ volume: Number(slider.value), muted: false }));
  slider.addEventListener("change", () => {
    slider.blur(); // so arrow keys go back to moving
    playSound("step");
  });
}
updateSoundControls();
for (const [id, action] of [["undo", undo], ["restart", restart], ["hint", hint], ["route", toggleRoute]]) {
  document.getElementById(id).addEventListener("click", (e) => {
    e.currentTarget.blur(); // keep Enter/Space from repeating it while playing
    action();
  });
}
// The timer doesn't run while the pause menu is open.
pauseMenu.addEventListener("close", () => {
  if (timer.started && !solved && !mazeScreen.hidden) startTimer();
});

/** @type {Object<string, function(): void>} Zoom keys. */
const ZOOM_KEYS = { "+": zoomIn, "=": zoomIn, "-": zoomOut, _: zoomOut, 0: zoomFit };
/** @type {Object<string, function(KeyboardEvent): void>} Other game keys, by lowercase key name. */
const PLAY_KEYS = {
  m: toggleMute,
  n: () => foldMinimap(!minimapFolded),
  z: undo,
  u: undo,
  backspace: undo,
  r: restart,
  h: (e) => (e.shiftKey ? toggleRoute() : hint()),
};

window.addEventListener("keydown", (e) => {
  // Open dialogs handle their own keys; Esc closes them (i.e. resumes) natively.
  if (mazeScreen.hidden || pauseMenu.open || winMenu.open) return;
  if (e.key === "Escape" && !mobileMenu.hidden) {
    setMenu(false);
    return;
  }
  if (e.key === "Escape" && fullScreen()) {
    setFullScreen(false);
    return;
  }
  const dir = DIRECTIONS[e.key] || DIRECTIONS[e.key.toLowerCase()];
  const key = e.key.toLowerCase();
  if (e.key === "Escape") {
    e.preventDefault();
    pauseTimer();
    pauseMenu.showModal();
  } else if (key === "z" && (e.ctrlKey || e.metaKey) && !e.altKey) {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey || e.metaKey || e.altKey) {
    return; // leave browser shortcuts (and browser zoom) alone
  } else if (dir) {
    e.preventDefault(); // don't scroll the page
    move(dir, e.shiftKey);
  } else if (ZOOM_KEYS[e.key]) {
    e.preventDefault();
    ZOOM_KEYS[e.key]();
  } else if (PLAY_KEYS[key]) {
    e.preventDefault();
    PLAY_KEYS[key](e);
  }
});
/** Fit the maze to the space again (after a resize), keeping the same zoom relative to "fit". */
function relayout() {
  if (!current || mazeScreen.hidden || building) return;
  finishAnimation();
  const ratio = geo.path / fitPath;
  layoutView(null);
  zoomTo(Math.round(fitPath * ratio));
}
window.addEventListener("resize", relayout);

// Phones: a menu with undo, restart, the route, and a switch for the arrow pad,
// which is hidden by default there (the choice is remembered in this browser).
const PAD_KEY = "rainbow-maze-pad";
const menuToggle = document.getElementById("menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const padToggle = document.getElementById("pad-toggle");
/**
 * Open or close the phone menu.
 *
 * @param {boolean} open Whether it should be open.
 */
function setMenu(open) {
  mobileMenu.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.textContent = open ? "✕ Close" : "☰ Menu";
}
/**
 * Show or hide the arrow pad on phones.
 *
 * @param {boolean} on Whether to show it.
 * @param {boolean} [save=true] Remember the choice in this browser.
 */
function setPad(on, save = true) {
  document.body.classList.toggle("show-pad", on);
  padToggle.checked = on;
  if (save) {
    try {
      localStorage.setItem(PAD_KEY, on ? "1" : "0");
    } catch {}
  }
  relayout(); // the pad takes room from the maze
}
try {
  setPad(localStorage.getItem(PAD_KEY) === "1", false);
} catch {
  setPad(false, false);
}
menuToggle.addEventListener("click", () => setMenu(mobileMenu.hidden));
padToggle.addEventListener("change", () => setPad(padToggle.checked));
const MENU_ACTIONS = [
  ["m-undo", undo],
  ["m-restart", restart],
  ["m-route", toggleRoute],
  ["m-new", () => (setMenu(false), generate())],
  ["m-settings", mainMenu],
  ["m-mute", toggleMute],
  ["m-zoom-out", zoomOut],
  ["m-zoom-in", zoomIn],
  ["m-zoom-fit", zoomFit],
];
for (const [id, action] of MENU_ACTIONS) document.getElementById(id).addEventListener("click", action);

// Click or tap the minimap (or press N) to fold it away, and the Map button to bring it back.
const MAP_KEY = "rainbow-maze-minimap";
let minimapFolded = false;
try {
  minimapFolded = localStorage.getItem(MAP_KEY) === "folded";
} catch {}
/**
 * Fold the minimap away to a Map button, or bring it back, and remember the choice.
 *
 * @param {boolean} folded Whether to fold it.
 */
function foldMinimap(folded) {
  minimapFolded = folded;
  try {
    localStorage.setItem(MAP_KEY, folded ? "folded" : "shown");
  } catch {}
  if (current) updateMinimap();
}
minimap.addEventListener("click", () => foldMinimap(true));
mapShow.addEventListener("click", () => foldMinimap(false));

// Swipes stop at the first bend unless this is on; then they follow bends like
// Shift + arrow runs do. Off by default; the switch is in the phone menu (and
// the toolbar on bigger touch screens), and the choice is remembered.
const CORNERS_KEY = "rainbow-maze-swipe-corners";
const cornerToggles = document.querySelectorAll(".corner-toggle");
let swipeCorners = false;
try {
  swipeCorners = localStorage.getItem(CORNERS_KEY) === "on";
} catch {}
/**
 * Choose whether swipes follow bends, update both switches, and remember the choice.
 *
 * @param {boolean} on Whether swipes go around corners.
 */
function setSwipeCorners(on) {
  swipeCorners = on;
  for (const toggle of cornerToggles) toggle.checked = on;
  try {
    localStorage.setItem(CORNERS_KEY, on ? "on" : "off");
  } catch {}
}
for (const toggle of cornerToggles) {
  toggle.checked = swipeCorners;
  toggle.addEventListener("change", () => setSwipeCorners(toggle.checked));
}

// Vibration on touch devices that support it (Android, not iPhones): a short buzz
// for a bump, a double one for a color change, and a longer pattern for winning.
// On by default; the switch is in the phone menu, and the choice is remembered.
const VIBRATE_KEY = "rainbow-maze-vibrate";
const vibrateToggle = document.getElementById("vibrate-toggle");
let vibrateOn = true;
try {
  vibrateOn = localStorage.getItem(VIBRATE_KEY) !== "off";
} catch {}
/** Whether this is a touch device that can vibrate. @returns {boolean} */
const canVibrate = () => touchControls.matches && typeof navigator.vibrate === "function";
/**
 * Vibrate, if switched on and supported.
 *
 * @param {number | number[]} pattern Milliseconds to vibrate, or on/off/on… durations.
 * @param {number} [delay=0] Milliseconds from now to start.
 */
function buzz(pattern, delay = 0) {
  if (!vibrateOn || !canVibrate()) return;
  setTimeout(() => {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }, delay);
}
/** Show the Vibrate switch only where vibration works, and make it match the setting. */
function updateVibrateSwitch() {
  document.getElementById("vibrate-switch").hidden = !canVibrate();
  vibrateToggle.checked = vibrateOn;
}
vibrateToggle.addEventListener("change", () => {
  vibrateOn = vibrateToggle.checked;
  try {
    localStorage.setItem(VIBRATE_KEY, vibrateOn ? "on" : "off");
  } catch {}
  buzz(25); // so you can feel it's on
});
updateVibrateSwitch();

// Phones: full screen shows only the maze, with a button under it to leave. Where
// the browser allows it (not on iPhones), this also hides the browser's own bars.
/** Whether the maze is in (our) full screen. @returns {boolean} */
const fullScreen = () => document.body.classList.contains("maze-fullscreen");
let browserFullScreen = false;
/**
 * Enter or leave full screen: only the maze, and the browser's full screen where allowed.
 *
 * @param {boolean} on Whether to be in full screen.
 */
function setFullScreen(on) {
  if (on === fullScreen()) return;
  setMenu(false);
  document.body.classList.toggle("maze-fullscreen", on);
  if (on) {
    try {
      document.documentElement.requestFullscreen({ navigationUI: "hide" })
        .then(() => (browserFullScreen = true))
        .catch(() => {});
    } catch {}
  } else if (browserFullScreen) {
    browserFullScreen = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  requestAnimationFrame(relayout);
}
document.getElementById("fullscreen").addEventListener("click", () => setFullScreen(true));
document.getElementById("exit-fullscreen").addEventListener("click", () => setFullScreen(false));
// Leaving the browser's full screen another way (e.g. the back gesture) leaves ours too.
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && browserFullScreen) {
    browserFullScreen = false;
    setFullScreen(false);
  }
});
// Tapping anywhere else closes the menu.
document.addEventListener("pointerdown", (e) => {
  if (!mobileMenu.hidden && !mobileMenu.contains(e.target) && !menuToggle.contains(e.target)) setMenu(false);
});
mobileView.addEventListener("change", () => {
  if (!mobileView.matches) {
    setMenu(false);
    setFullScreen(false);
  }
  relayout();
});
// The mouse wheel (or a trackpad pinch) over the maze zooms.
canvas.addEventListener("wheel", (e) => {
  if (!current) return;
  e.preventDefault();
  (e.deltaY < 0 ? zoomIn : zoomOut)();
}, { passive: false });

// Touch: a swipe runs along the corridor, two fingers pinch to zoom and drag to
// look around, and holding a pad button steps one square at a time, repeating.
/** @type {Map<number, [number, number]>} Pointer id -> [x, y] for fingers on the maze. */
const touches = new Map();
/** @type {?[number, number]} Where a one-finger swipe started. */
let swipeStart = null;
/**
 * The two-finger gesture, from when the second finger went down: the finger gap,
 * the zoom, and the spot under the fingers as a share of the maze's size.
 * @type {?{distance: number, path: number, anchor: [number, number]}}
 */
let pinch = null;
/** @type {number} The pending pinch frame, or 0. */
let pinchFrame = 0;
/** The distance between the two fingers, in CSS pixels. @returns {number} */
const fingerGap = () => {
  const [[x1, y1], [x2, y2]] = [...touches.values()];
  return Math.hypot(x2 - x1, y2 - y1);
};
/** The point between the two fingers, on the canvas in device pixels. @returns {[number, number]} */
const fingerMid = () => {
  const [[x1, y1], [x2, y2]] = [...touches.values()];
  const box = canvas.getBoundingClientRect();
  return [((x1 + x2) / 2 - box.left) * geo.dpr, ((y1 + y2) / 2 - box.top) * geo.dpr];
};
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  try {
    canvas.setPointerCapture(e.pointerId); // keep getting moves if the finger leaves the maze
  } catch {}
  if (touches.size === 1) {
    swipeStart = [e.clientX, e.clientY];
  } else if (touches.size === 2 && geo) {
    swipeStart = null; // a pinch is never a swipe
    // The spot under the fingers, as a share of the maze's width and height, so it
    // stays under them as they spread (zoom) and move (drag).
    const mazePx = geo.pos(visibleSize(current.grid));
    const [mx, my] = fingerMid();
    pinch = { distance: Math.max(1, fingerGap()), path: geo.path, anchor: [(view.x + mx) / mazePx, (view.y + my) / mazePx] };
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (!pinch || touches.size !== 2 || pinchFrame) return;
  // Zoom and drag at most once per frame. The next move brings the smiley back
  // into view if the fingers dragged it out.
  pinchFrame = requestAnimationFrame(() => {
    pinchFrame = 0;
    if (!pinch || touches.size !== 2 || !current || building) return;
    finishAnimation();
    const path = Math.round((pinch.path * fingerGap()) / pinch.distance);
    if (path !== geo.path) layoutView(path);
    camTarget = null; // the fingers move the view now
    const mazePx = geo.pos(visibleSize(current.grid));
    const [mx, my] = fingerMid();
    view.x = pinch.anchor[0] * mazePx - mx;
    view.y = pinch.anchor[1] * mazePx - my;
    clampView();
    paint();
  });
});
/**
 * A finger lifted (or was cancelled): end a pinch, or turn a swipe into a move.
 *
 * @param {PointerEvent} e The pointerup or pointercancel event.
 */
function liftFinger(e) {
  if (!touches.delete(e.pointerId)) return;
  if (pinch) {
    if (!touches.size) pinch = null; // the pinch ends when the last finger lifts
    return;
  }
  if (!swipeStart || e.type !== "pointerup" || pauseMenu.open || winMenu.open) return;
  const dx = e.clientX - swipeStart[0];
  const dy = e.clientY - swipeStart[1];
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return; // a tap, not a swipe
  move(Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0], true, swipeCorners);
}
canvas.addEventListener("pointerup", liftFinger);
canvas.addEventListener("pointercancel", liftFinger);
let repeatTimer = 0;
/** Stop a held arrow pad button from repeating. */
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
  pickCustom();
  if (params.has("size")) sizeInput.value = params.get("size");
  if (params.has("colors")) colorsInput.value = params.get("colors");
  updateHint();
  form.requestSubmit();
}
