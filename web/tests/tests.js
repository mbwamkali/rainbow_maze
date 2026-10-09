// Browser tests for the web app. Each test loads the real app (../index.html) in an
// iframe and runs code inside it with `app.ev("…")`, so tests see the app's own
// globals (current, player, geo, …). Open this page from a local web server, or run
// `python3 web/tests/run.py` to run it in headless Firefox.
//
// These cover the bugs found so far: the smiley leaving marks on narrow paths,
// thick right/bottom walls on even sizes, and moves not drawing when a frame's
// timestamp came before the key press.

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let lastApp = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms, what) {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

// Installed into the app's iframe; its code runs in the app's global scope.
function installHelpers() {
  const T = (window.T = {});
  T.KEY = { "-1,0": "ArrowUp", "1,0": "ArrowDown", "0,-1": "ArrowLeft", "0,1": "ArrowRight" };
  T.frames = 0;
  const realFrame = frame;
  frame = (now) => { T.frames++; realFrame(now); };
  T.press = (key, options = {}, finish = true) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...options }));
    if (finish) finishAnimation();
  };
  T.dirTo = (a, b) => T.KEY[[Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])].join()];
  // The player's place on the solution. The solution can pass a square twice (in
  // different colors), so search forward from the last place found.
  T.from = 0;
  T.index = () => {
    const i = current.path.findIndex(([r, c], k) => k >= T.from && r === player[0] && c === player[1]);
    if (i >= 0) T.from = i;
    return i;
  };
  T.solutionKey = () => {
    const i = T.index();
    return i < 0 ? null : T.dirTo(current.path[i], current.path[i + 2]);
  };
  T.blockedKey = () =>
    Object.values(T.KEY).find((key) => tryMove(player, playerColor, DIRECTIONS[key]).blocked !== undefined);
  // Follow the solution with runs (Shift + arrow); returns the number of presses.
  T.runToEnd = () => {
    T.from = 0;
    let presses = 0;
    while (!solved && presses < 20000) {
      const key = T.solutionKey();
      if (!key) return -1;
      T.press(key, { shiftKey: true });
      presses++;
    }
    return presses;
  };
  // Step the current animation through several frames, as a browser would.
  T.playFrames = () => {
    if (!anim) return;
    const { start, duration } = anim;
    for (let f = 1; f <= 6 && anim; f++) frame(start + ((duration || 1) * f) / 6);
  };
  // Pixels that differ between the canvas and a clean repaint, outside the
  // player's own square (where redrawing the face over itself is harmless).
  T.strayPixels = () => {
    const ctx = canvas.getContext("2d");
    const live = ctx.getImageData(0, 0, canvas.width, canvas.height).data.slice();
    paint();
    const clean = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const [px, py] = [geo.pos(player[1]) - view.x, geo.pos(player[0]) - view.y];
    let stray = 0;
    for (let k = 0; k < live.length; k += 4) {
      const x = (k / 4) % canvas.width;
      const y = Math.floor(k / 4 / canvas.width);
      if (x >= px && x < px + geo.path && y >= py && y < py + geo.path) continue;
      if (live[k] !== clean[k] || live[k + 1] !== clean[k + 1] || live[k + 2] !== clean[k + 2]) stray++;
    }
    return stray;
  };
}

// Load the app with `query` (e.g. "size=41&colors=4", which builds a maze straight
// away) and wait for the maze unless `waitForMaze` is false. `width` and `height`
// size the app's window (in CSS pixels), e.g. 390 × 844 for a phone.
async function openApp(query = "", { waitForMaze = true, width = 1000, height = 900 } = {}) {
  const iframe = document.createElement("iframe");
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.src = `../index.html${query ? `?${query}` : ""}`;
  const loaded = new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));
  document.getElementById("frames").replaceChildren(iframe);
  await loaded;
  const win = iframe.contentWindow;
  const app = { win, doc: win.document, errors: [], ev: (code) => win.eval(code) };
  win.addEventListener("error", (e) => app.errors.push(e.message));
  win.addEventListener("unhandledrejection", (e) => app.errors.push(String(e.reason)));
  app.ev(`(${installHelpers})()`);
  if (waitForMaze) await until(() => app.ev("!!current && !building"), 30000, "the maze to build");
  lastApp = app;
  return app;
}

test("builds in a Web Worker, and on the main thread when workers are blocked", async () => {
  const app = await openApp("size=41&colors=4");
  assert(app.ev("!workerBroken"), "the Web Worker build failed");
  app.ev("workerBroken = true; window.__build = generate();");
  await app.ev("__build");
  assert(app.ev("!!current && !building && buildingNote.hidden"), "the main-thread build didn't finish");
});

test("outer walls are as thick as the inner walls on even sizes", async () => {
  const app = await openApp("size=40&colors=3");
  app.ev("zoomFit()");
  const r = app.ev(`(() => {
    const ctx = canvas.getContext("2d");
    const y = Math.floor(geo.center(...corners(current.grid.length)[1])[1] - view.y);
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    const black = (x) => row[4 * x] + row[4 * x + 1] + row[4 * x + 2] === 0;
    let left = 0, right = 0;
    while (black(left)) left++;
    while (black(canvas.width - 1 - right)) right++;
    return { left, right, wall: geo.wall, visible: visibleSize(current.grid) };
  })()`);
  assert(r.visible === 39, `drew ${r.visible} rows of a 40-row grid, expected 39`);
  assert(r.left === r.wall && r.right === r.wall, `borders ${r.left}px / ${r.right}px, walls ${r.wall}px`);
});

test("the smiley stays inside its square at every size", async () => {
  const app = await openApp("", { waitForMaze: false });
  const bad = app.ev(`(() => {
    const bad = [];
    for (let path = 4; path <= 64; path++) {
      for (const scale of [1, 0.65]) {
        const pad = 8;
        const c = document.createElement("canvas");
        c.width = c.height = path + 2 * pad;
        const ctx = c.getContext("2d");
        for (const mood of ["happy", "oops"]) drawPlayerAt(ctx, pad + path / 2, pad + path / 2, geometry(path), "#e63946", mood, scale);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let outside = 0;
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++)
            if (!(x >= pad && x < pad + path && y >= pad && y < pad + path) && d[4 * (y * c.width + x) + 3]) outside++;
        if (outside) bad.push(path + "px x" + scale + ": " + outside);
      }
    }
    return bad;
  })()`);
  assert(!bad.length, `face drawn outside its square: ${bad.slice(0, 5).join(", ")}`);
});

test("each key press moves and draws the smiley (real frame timing)", async () => {
  // Every move has to finish drawing on its own, without another key press. (A
  // bug once left moves waiting until the next press.) The wait is generous since
  // headless browsers can deliver frames slowly.
  const app = await openApp("size=41&colors=4");
  for (let n = 0; n < 12; n++) {
    app.ev(`T.press(T.solutionKey(), {}, false)`);
    try {
      await until(() => app.ev("anim === null"), 2000, "the slide to finish");
    } catch {
      throw new Error(`move ${n + 1} never finished drawing (${app.ev("T.frames")} frames so far) ${app.errors.join("; ")}`);
    }
  }
  assert(app.ev("moves") === 12, `moves = ${app.ev("moves")}, expected 12`);
});

test("a frame stamped before the key press still draws", async () => {
  const app = await openApp("size=21&colors=3");
  for (const [label, key] of [["move", app.ev("T.solutionKey()")], ["bump", app.ev("T.blockedKey()")]]) {
    app.ev(`T.press("${key}", {}, false)`);
    try {
      app.ev("frame(anim.start - 4)");
    } catch (e) {
      throw new Error(`${label}: ${e.message}`);
    }
    app.ev("finishAnimation()");
  }
});

test("running reaches the end in exactly the shortest number of moves", async () => {
  for (const query of ["size=61&colors=5&layout=blobs", "size=101&colors=7&layout=tendrils"]) {
    const app = await openApp(query);
    const presses = app.ev("T.runToEnd()");
    const [solved, moves, shortest] = app.ev("[solved, moves, shortestMoves()]");
    assert(solved, `${query}: not solved after ${presses} presses`);
    assert(moves === shortest, `${query}: ${moves} moves, shortest is ${shortest}`);
    assert(presses < moves / 2, `${query}: ${presses} presses for ${moves} moves; runs should cut that down`);
  }
});

test("moving, bumping, hints and the route leave no stray marks", async () => {
  for (const query of ["size=41&colors=4", "size=101&colors=7"]) {
    const app = await openApp(query);
    for (const zoom of ["zoomFit()", "zoomTo(Math.round(32 * geo.dpr))"]) {
      app.ev(zoom);
      app.ev(`
        T.from = 0;
        for (let n = 0; n < 30 && !solved; n++) {
          const bump = T.blockedKey();
          if (bump) { T.press(bump, {}, false); T.playFrames(); }
          T.press(T.solutionKey(), { shiftKey: n % 2 === 0 }, false); T.playFrames();
          if (n === 10) hint();
          if (n === 20) toggleRoute();
        }`);
      const stray = app.ev("T.strayPixels()");
      assert(stray === 0, `${query} ${zoom}: ${stray} stray pixels`);
    }
  }
});

test("undo restores position, color, moves and trail", async () => {
  const app = await openApp("size=61&colors=5");
  const ok = app.ev(`(() => {
    const states = [];
    T.from = 0;
    for (let n = 0; n < 8; n++) {
      states.push([player.join(), playerColor, moves, trail.length].join());
      T.press(T.solutionKey(), { shiftKey: true });
    }
    return states.reverse().every((state) => {
      T.press("z");
      return [player.join(), playerColor, moves, trail.length].join() === state;
    });
  })()`);
  assert(ok, "a state wasn't restored by undo");
  assert(app.ev("moves === 0 && history.length === 0 && stats.undos === 8"), "not back at the start");
});

test("the hint points the way, and the route leads to the end", async () => {
  const app = await openApp("size=61&colors=5&layout=tendrils");
  app.ev(`T.press("ArrowRight"); T.press("ArrowDown"); T.press("ArrowRight");`);
  app.ev(`T.press("h")`);
  const [kind, marked, text] = app.ev("[overlayKind, overlay.size, message.textContent]");
  assert(kind === "hint" && marked > 0, `hint marked ${marked} squares (${kind})`);
  assert(/^Hint: head (up|down|left|right)\.$/.test(text), `hint message "${text}"`);
  app.ev(`T.press("H", { shiftKey: true })`);
  const routeMoves = app.ev("(routeCells.length - 1) / 2");
  const before = app.ev("moves");
  app.ev(`while (!solved && overlayKind === "route") T.press(T.dirTo(routeCells[0], routeCells[2]));`);
  assert(app.ev("solved"), "following the route didn't reach the end");
  assert(app.ev("moves") - before === routeMoves, `took ${app.ev("moves") - before} moves, the route was ${routeMoves}`);
});

test("restart needs a second press", async () => {
  const app = await openApp("size=41&colors=4");
  app.ev(`T.from = 0; for (let n = 0; n < 3; n++) T.press(T.solutionKey(), { shiftKey: true });`);
  const moved = app.ev("moves");
  app.ev(`T.press("r")`);
  assert(app.ev("moves") === moved, "the first press restarted");
  app.ev(`T.press("r")`);
  assert(app.ev("moves === 0 && trail.length === 1 && history.length === 0"), "the second press didn't restart");
});

test("the win screen shows stats, and a perfect run says so", async () => {
  const app = await openApp("size=41&colors=4");
  app.ev("T.runToEnd()");
  await until(() => app.ev("winMenu.open"), 2000, "the win screen");
  const text = app.ev(`document.getElementById("win-text").textContent`);
  assert(/perfect run/i.test(text), `win text "${text}"`);
  const stats = app.ev(`[...document.querySelectorAll("#win-stats dt")].map((dt) => dt.textContent + "=" + dt.nextElementSibling.textContent)`);
  assert(stats.length === 6, `${stats.length} stats shown`);
  assert(stats[0].includes("100% efficient"), stats[0]);
});

test("zoom buttons zoom, and the minimap shows only when zoomed in", async () => {
  const app = await openApp("size=101&colors=7");
  const click = (id) => app.ev(`document.getElementById("${id}").click(); geo.path`);
  const start = app.ev("geo.path");
  const zoomedIn = click("zoom-in");
  const zoomedOut = click("zoom-out") && click("zoom-out");
  assert(zoomedIn > start && zoomedOut < zoomedIn, `paths ${start} -> ${zoomedIn} -> ${zoomedOut}`);
  click("zoom-fit");
  assert(app.ev("geo.path === fitPath && minimap.hidden"), "Fit should show the whole maze without a minimap");
  click("zoom-in");
  click("zoom-in");
  assert(app.ev("!minimap.hidden"), "the minimap should show when zoomed in");
});

test("a swipe stops at the first bend unless the switch says go around corners", async () => {
  const app = await openApp("size=61&colors=5");
  app.ev("localStorage.removeItem(CORNERS_KEY)");
  // Find a step that lands on a bend: one way on from there, and it turns.
  const found = app.ev(`(() => {
    const n = visibleSize(current.grid);
    for (let r = 1; r < n; r += 2) for (let c = 1; c < n; c += 2) {
      for (const color of ["WHITE", ...current.palette]) for (const d of DIRECTION_LIST) {
        const m = tryMove([r, c], color, d);
        if (m.blocked !== undefined || m.nextColor !== color || current.grid[m.next[0]][m.next[1]].marker) continue;
        const ways = DIRECTION_LIST.filter(([dr, dc]) => !(dr === -d[0] && dc === -d[1]))
          .filter((w) => tryMove(m.next, color, w).blocked === undefined);
        if (ways.length === 1 && (ways[0][0] !== d[0] || ways[0][1] !== d[1])) {
          T.bend = { at: [r, c], color, d, stop: m.next };
          return true;
        }
      }
    }
    return false;
  })()`);
  assert(found, "no bend found in the maze");
  app.ev(`T.touch = (type, x, y) => {
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true,
      clientX: box.left + x, clientY: box.top + y, bubbles: true }));
  };
  T.swipeBend = () => {
    newRound();
    [player, playerColor] = [T.bend.at, T.bend.color];
    const [dr, dc] = T.bend.d;
    T.touch("pointerdown", 150, 150);
    T.touch("pointerup", 150 + dc * 80, 150 + dr * 80);
    finishAnimation();
    return player[0] === T.bend.stop[0] && player[1] === T.bend.stop[1];
  };`);
  assert(app.ev("swipeCorners === false"), "swipes should stop at corners by default");
  assert(app.ev("T.swipeBend()"), "the swipe didn't stop at the bend");
  app.ev(`const t = document.querySelector(".corner-toggle"); t.checked = true; t.dispatchEvent(new Event("change"))`);
  assert(app.ev("swipeCorners && [...cornerToggles].every((t) => t.checked)"), "the switch didn't turn on (or the other copy didn't follow)");
  assert(!app.ev("T.swipeBend()"), "with the switch on, the swipe still stopped at the bend");
  // Shift + arrow runs follow bends either way.
  app.ev(`setSwipeCorners(false); newRound(); [player, playerColor] = [T.bend.at, T.bend.color]`);
  app.ev(`T.press(T.KEY[T.bend.d.join()], { shiftKey: true })`);
  assert(app.ev("player[0] !== T.bend.stop[0] || player[1] !== T.bend.stop[1]"), "a Shift run stopped at the bend");
  app.ev("localStorage.removeItem(CORNERS_KEY)");
});

test("slides go about 75ms a square and start gently", async () => {
  const app = await openApp("size=61&colors=5");
  app.ev(`T.press(T.solutionKey(), {}, false)`);
  const one = app.ev("[anim.duration, anim.steps]");
  app.ev("finishAnimation()");
  assert(one[1] === 1 && one[0] === 110, `one square took ${one[0]}ms`);
  app.ev("newRound(); T.from = 0");
  app.ev(`T.press(T.solutionKey(), { shiftKey: true }, false)`);
  const [duration, steps] = app.ev("[anim.duration, anim.steps]");
  app.ev("finishAnimation()");
  assert(duration === Math.min(110 + (steps - 1) * 75, 1500), `a ${steps}-square run took ${duration}ms`);
});

test("phone: the view glides toward the smiley instead of jumping", async () => {
  if (!touchScreen) return { skipped: "needs a touch screen (run.py --mobile)" };
  const app = await openApp("size=101&colors=7", PHONE);
  app.ev("zoomIn(); zoomIn()");
  // Scroll far away, then ask the view to follow the smiley.
  app.ev("view.x = view.y = 0; clampView(); const mid = 2 * Math.floor(visibleSize(current.grid) / 4) + 1; player = [mid, mid]; paint()");
  const before = app.ev("[view.x, view.y]");
  app.ev("follow(...geo.center(...player)); paint(); startGlide()");
  const first = app.ev("[view.x, view.y, camTarget && camTarget.x, camTarget && camTarget.y]");
  assert(first[2] !== null, "the view jumped instead of gliding");
  assert(first[0] > before[0] && first[0] < first[2], `the first step went ${before[0]} -> ${first[0]} of ${first[2]}`);
  await until(() => app.ev("camTarget === null"), 3000, "the glide to finish");
  const [x, y] = app.ev("[geo.center(...player)[0] - view.x, geo.center(...player)[1] - view.y]");
  const [w, h] = app.ev("[view.w, view.h]");
  assert(x >= w * 0.35 - 1 && x <= w * 0.65 + 1 && y >= h * 0.35 - 1 && y <= h * 0.65 + 1,
    `the smiley ended at ${Math.round(x)}, ${Math.round(y)} in a ${w}×${h} view`);
});

test("the minimap folds away with a click or N, and comes back", async () => {
  let app = await openApp("size=101&colors=7");
  app.ev("localStorage.removeItem(MAP_KEY); zoomIn(); zoomIn()");
  assert(app.ev("!minimap.hidden && mapShow.hidden"), "the minimap should show when zoomed in");
  app.ev("minimap.click()");
  assert(app.ev("minimap.hidden && !mapShow.hidden"), "clicking the minimap didn't fold it");
  app.ev("mapShow.click()");
  assert(app.ev("!minimap.hidden && mapShow.hidden"), "the Map button didn't bring it back");
  app.ev(`T.press("n")`);
  assert(app.ev("minimap.hidden && !mapShow.hidden"), "N didn't fold the minimap");
  app.ev(`T.press("n")`);
  assert(app.ev("!minimap.hidden && mapShow.hidden"), "N didn't bring the minimap back");
  app.ev("localStorage.removeItem(MAP_KEY)");
});

test("the minimap moves out of the smiley's way, and stays put otherwise", async () => {
  const app = await openApp("size=101&colors=7");
  app.ev("localStorage.removeItem(MAP_KEY); zoomIn(); zoomIn()");
  // Put the smiley in the middle of the maze, then scroll so it sits under the
  // map's top-right corner.
  app.ev(`T.overlap = () => {
    const a = minimap.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const [x, y] = geo.center(...player).map((v, i) => box[i ? "top" : "left"] + (v - (i ? view.y : view.x)) / geo.dpr);
    const r = geo.path / geo.dpr / 2;
    return x + r > a.left && x - r < a.right && y + r > a.top && y - r < a.bottom;
  };
  T.showAt = (fx, fy) => {
    const [x, y] = geo.center(...player);
    view.x = x - view.w * fx;
    view.y = y - view.h * fy;
    clampView();
    paint();
  };
  const mid = 2 * Math.floor(visibleSize(current.grid) / 4) + 1;
  player = [mid, mid];`);
  assert(app.ev("(stage.dataset.mapCorner || 'top-right') === 'top-right'"), "the map didn't start top right");
  app.ev("T.showAt(0.92, 0.08)");
  const corner = app.ev("stage.dataset.mapCorner");
  assert(corner && corner !== "top-right", `the map stayed at ${corner}`);
  assert(!app.ev("T.overlap()"), "the map still covers the smiley");
  app.ev("T.showAt(0.5, 0.5)");
  assert(app.ev("stage.dataset.mapCorner") === corner, "the map moved again with the smiley far away");
  assert(app.ev("getComputedStyle(minimap).left") !== app.ev("getComputedStyle(minimap).right") || corner.startsWith("bottom"),
    "the corner didn't change the map's place");
});

test("touch: a swipe runs, a pinch zooms, and ending a pinch doesn't move", async () => {
  const app = await openApp("size=101&colors=7");
  // Synthetic touch pointers on the maze canvas.
  app.ev(`T.touch = (type, id, x, y) => {
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1,
      clientX: box.left + x, clientY: box.top + y, bubbles: true }));
  };`);
  const key = app.ev("T.solutionKey()");
  const [dx, dy] = { ArrowUp: [0, -80], ArrowDown: [0, 80], ArrowLeft: [-80, 0], ArrowRight: [80, 0] }[key];
  app.ev(`T.touch("pointerdown", 1, 200, 200); T.touch("pointerup", 1, ${200 + dx}, ${200 + dy}); finishAnimation()`);
  const afterSwipe = app.ev("moves");
  assert(afterSwipe > 0, `a ${key} swipe didn't move`);
  app.ev(`T.touch("pointerdown", 1, 200, 200); T.touch("pointerup", 1, 205, 203)`);
  assert(app.ev("moves") === afterSwipe, "a tap moved the player");

  const before = app.ev("geo.path");
  app.ev(`T.touch("pointerdown", 1, 200, 200); T.touch("pointerdown", 2, 300, 200); T.touch("pointermove", 2, 350, 200)`);
  await until(() => app.ev("geo.path") !== before, 1000, "the pinch to zoom");
  const zoomed = app.ev("geo.path");
  assert(Math.abs(zoomed - before * 1.5) <= 1, `pinching 100px -> 150px zoomed ${before} -> ${zoomed}`);
  app.ev(`T.touch("pointerup", 2, 350, 200); T.touch("pointerup", 1, 120, 200)`);
  assert(app.ev("moves") === afterSwipe, "lifting the fingers after a pinch moved the player");
  assert(app.ev("touches.size === 0 && pinch === null"), "the pinch didn't end");

  // Two fingers moving together drag the view without zooming. Start from the
  // middle of the maze so the view has room to move.
  app.ev("zoomIn(); centerOn(geo.pos(visibleSize(current.grid)) / 2, geo.pos(visibleSize(current.grid)) / 2); paint()");
  const [path, x, y] = app.ev("[geo.path, view.x, view.y]");
  app.ev(`T.touch("pointerdown", 1, 200, 200); T.touch("pointerdown", 2, 300, 200);
    T.touch("pointermove", 1, 260, 170); T.touch("pointermove", 2, 360, 170)`);
  await until(() => app.ev("view.x") !== x, 1000, "the two-finger drag");
  await until(() => app.ev("pinchFrame === 0"), 1000, "the drag's frame");
  const [path2, x2, y2] = app.ev("[geo.path, view.x, view.y]");
  const dpr = app.ev("geo.dpr");
  assert(path2 === path, `dragging zoomed ${path} -> ${path2}`);
  assert(Math.abs(x - x2 - 60 * dpr) <= 2 && Math.abs(y - y2 + 30 * dpr) <= 2,
    `dragging 60px right and 30px up moved the view by ${x2 - x}, ${y2 - y}`);
  app.ev(`T.touch("pointerup", 1, 260, 170); T.touch("pointerup", 2, 360, 170)`);
  assert(app.ev("moves") === afterSwipe, "the drag moved the player");
});

test("sound: muted by default, and each event has its sound", async () => {
  let app = await openApp("size=41&colors=4");
  app.ev("localStorage.removeItem(SOUND_KEY)");
  app = await openApp("size=41&colors=4");
  // Record which sounds the game asks for (they still play through the real code).
  app.ev(`T.sounds = []; const realPlay = playSound; playSound = (name, options) => { T.sounds.push(name); realPlay(name, options); };`);
  assert(app.ev(`sound.muted && muteButton.getAttribute("aria-pressed") === "true"`), "sound should start muted");
  app.ev(`T.press(T.solutionKey()); T.press(T.blockedKey())`);
  assert(app.ev("audio === null"), "audio was started while muted");

  app.ev(`T.press("m")`);
  assert(app.ev(`!sound.muted && muteButton.getAttribute("aria-pressed") === "false"`), "M didn't turn sound on");
  app.ev(`T.sounds = []; T.press(T.blockedKey()); T.runToEnd()`);
  const heard = app.ev("T.sounds");
  for (const name of ["bump", "step", "color", "win"]) assert(heard.includes(name), `no "${name}" sound in ${heard.join(", ")}`);
  const colorChanges = app.ev("current.palette.length - 1");
  assert(heard.filter((n) => n === "color").length >= colorChanges, `${heard.filter((n) => n === "color").length} color sounds for ${colorChanges} colors`);

  app.ev(`volumeInput.value = 30; volumeInput.dispatchEvent(new Event("input"))`);
  assert(app.ev("sound.volume === 30 && !sound.muted"), "the volume slider didn't set the volume");
  // The choice is remembered on reload.
  app = await openApp("size=21&colors=3");
  assert(app.ev("!sound.muted && sound.volume === 30"), "sound settings weren't remembered");
  app.ev("localStorage.removeItem(SOUND_KEY)");
});

test("each sound is audible, short, and doesn't clip", async () => {
  const app = await openApp("", { waitForMaze: false });
  // Render each sound into a buffer instead of the speakers, at full volume.
  const results = await app.ev(`(async () => {
    const out = {};
    const saved = { audio, muted: sound.muted, volume: sound.volume };
    Object.assign(sound, { muted: false, volume: 100 });
    for (const [name, options] of [["step", { steps: 4, duration: 225 }], ["bump", {}], ["color", { color: "CYAN" }], ["win", {}]]) {
      const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
      const master = ctx.createGain();
      master.connect(ctx.destination);
      audio = { ctx, master };
      playSound(name, options);
      const data = (await ctx.startRendering()).getChannelData(0);
      let peak = 0, last = 0;
      data.forEach((v, i) => { if (Math.abs(v) > peak) peak = Math.abs(v); if (Math.abs(v) > 0.001) last = i; });
      out[name] = { peak: Math.round(peak * 100) / 100, seconds: Math.round((last / 44100) * 100) / 100 };
    }
    Object.assign(sound, { muted: saved.muted, volume: saved.volume });
    audio = saved.audio;
    return out;
  })()`);
  for (const [name, { peak, seconds }] of Object.entries(results)) {
    assert(peak > 0.05, `${name} is nearly silent (peak ${peak})`);
    assert(peak < 0.9, `${name} is close to clipping (peak ${peak})`);
    assert(seconds < 1.2, `${name} lasts ${seconds}s`);
  }
});

// Whether this browser reports a touch screen (run.py --mobile).
const touchScreen = matchMedia("(pointer: coarse)").matches;
const PHONE = { width: 390, height: 844 };
const shown = (app, selector) => app.ev(`getComputedStyle(document.querySelector("${selector}")).display !== "none"`);

test("the phone menu appears only on phone-sized touch screens", async () => {
  // Desktop, and a narrow desktop window: unchanged.
  for (const size of [{}, PHONE]) {
    const app = await openApp("size=41&colors=4", size);
    const phone = touchScreen && size === PHONE;
    assert(shown(app, "#menu-toggle") === phone, `menu button ${phone ? "missing" : "shown"} at ${size.width || 1000}px`);
    for (const id of ["undo", "restart", "route"]) {
      assert(shown(app, `#${id}`) === !phone, `toolbar ${id} ${phone ? "shown" : "hidden"} at ${size.width || 1000}px`);
    }
    assert(app.ev("mobileMenu.hidden"), "the menu started open");
    // The compact header and full screen are phones-only too.
    assert(shown(app, "#fullscreen") === phone, `full screen button shown=${shown(app, "#fullscreen")}`);
    for (const selector of ["#back", "#again", "#info", ".view-controls"]) {
      assert(shown(app, selector) === !phone, `${selector} shown=${shown(app, selector)} at ${size.width || 1000}px`);
    }
    assert(app.ev("getComputedStyle(stage).paddingLeft") === (phone ? "0px" : "8px"), "the maze card changed");
    // The corner switch is in the toolbar on bigger touch screens (in the menu on phones).
    const cornerSwitch = app.ev(`document.querySelector(".view-controls .corner-switch").getClientRects().length > 0`);
    assert(cornerSwitch === (touchScreen && !phone), `toolbar corner switch shown=${cornerSwitch}`);
    // The arrow pad shows on touch screens, except on phones until it's switched on.
    assert(shown(app, "#dpad") === (touchScreen && !phone), `arrow pad shown=${shown(app, "#dpad")}`);
  }
});

test("phone: the menu opens and closes, toggles the arrow pad, and runs its actions", async () => {
  if (!touchScreen) return { skipped: "needs a touch screen (run.py --mobile)" };
  let app = await openApp("size=41&colors=4", PHONE);
  app.ev(`localStorage.removeItem(PAD_KEY)`);
  app = await openApp("size=41&colors=4", PHONE);
  const canvasHeight = () => app.ev("canvas.getBoundingClientRect().height");
  const tallBefore = canvasHeight();

  app.ev("menuToggle.click()");
  assert(!app.ev("mobileMenu.hidden") && app.ev(`menuToggle.getAttribute("aria-expanded")`) === "true", "the menu didn't open");
  assert(app.ev("menuToggle.textContent") === "✕ Close", `button says "${app.ev("menuToggle.textContent")}"`);

  app.ev("padToggle.click()");
  assert(shown(app, "#dpad"), "the arrow pad didn't appear");
  // The maze makes room for the pad: they don't overlap, and both fit on screen.
  const fit = app.ev(`(() => {
    const maze = canvas.getBoundingClientRect(), pad = dpad.getBoundingClientRect();
    return { mazeBottom: maze.bottom, padTop: pad.top, padBottom: pad.bottom, height: innerHeight };
  })()`);
  assert(fit.mazeBottom <= fit.padTop && fit.padBottom <= fit.height,
    `maze ends at ${Math.round(fit.mazeBottom)}px, pad spans ${Math.round(fit.padTop)}-${Math.round(fit.padBottom)}px of ${fit.height}px`);
  app.ev(`T.from = 0; for (let n = 0; n < 3; n++) T.press(T.solutionKey(), { shiftKey: true });`);
  const moved = app.ev("moves");
  app.ev(`document.getElementById("m-undo").click()`);
  assert(app.ev("moves") < moved, "Undo in the menu didn't undo");
  app.ev(`document.getElementById("m-route").click()`);
  assert(app.ev(`overlayKind === "route" && document.getElementById("m-route").textContent === "Hide route"`), "Show route didn't show it");
  app.ev(`document.getElementById("m-restart").click(); document.getElementById("m-restart").click()`);
  assert(app.ev("moves === 0"), "Restart (twice) didn't restart");

  // Tapping outside the menu closes it; the pad setting is remembered.
  app.ev(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  assert(app.ev("mobileMenu.hidden"), "tapping outside didn't close the menu");
  app = await openApp("size=41&colors=4", PHONE);
  assert(shown(app, "#dpad") && app.ev("padToggle.checked"), "the arrow pad setting wasn't remembered");
  app.ev(`padToggle.click(); localStorage.removeItem(PAD_KEY)`);
  assert(!shown(app, "#dpad") && canvasHeight() >= tallBefore - 1, "switching the pad off didn't give the maze its room back");
});

test("phone: a compact header leaves most of the screen to the maze", async () => {
  if (!touchScreen) return { skipped: "needs a touch screen (run.py --mobile)" };
  const app = await openApp("size=61&colors=5", PHONE);
  const r = app.ev(`(() => {
    const box = canvas.getBoundingClientRect();
    return { top: box.top, width: box.width, statusHeight: statusLabel.getBoundingClientRect().height,
      toolbarHeight: document.querySelector(".toolbar").getBoundingClientRect().height };
  })()`);
  assert(r.top < 150, `the maze starts ${Math.round(r.top)}px down`);
  assert(r.width >= PHONE.width - 2, `the maze is ${Math.round(r.width)}px wide on a ${PHONE.width}px screen`);
  assert(r.toolbarHeight < 60, `the toolbar is ${Math.round(r.toolbarHeight)}px tall (more than one row)`);
  assert(r.statusHeight < 30, `the status is ${Math.round(r.statusHeight)}px tall (more than one line)`);
  // Everything that left the header is in the menu.
  app.ev("menuToggle.click()");
  const before = app.ev("geo.path");
  app.ev(`document.getElementById("m-zoom-in").click()`);
  assert(app.ev("geo.path") > before, "zoom in from the menu didn't zoom");
  app.ev(`document.getElementById("m-mute").click()`);
  assert(app.ev("!sound.muted") && app.ev(`document.getElementById("m-mute").textContent`) === "🔊", "the menu's sound button didn't turn sound on");
  app.ev(`document.getElementById("m-mute").click(); localStorage.removeItem(SOUND_KEY)`);
  assert(app.ev(`document.querySelectorAll("#m-info .chip").length`) === 5, "the menu doesn't list the maze's colors");
  const oldMaze = app.ev("current");
  app.ev(`document.getElementById("m-new").click()`);
  await until(() => app.ev("!!current && !building") && app.ev("current") !== oldMaze, 30000, "a new maze");
  assert(app.ev("mobileMenu.hidden"), "the menu stayed open over the new maze");
  app.ev(`menuToggle.click(); document.getElementById("m-settings").click()`);
  assert(app.ev("!setupScreen.hidden && mazeScreen.hidden"), "Change settings didn't go back to the settings");
});

test("phone: full screen shows only the maze and an exit button under it", async () => {
  if (!touchScreen) return { skipped: "needs a touch screen (run.py --mobile)" };
  const app = await openApp("size=61&colors=5", PHONE);
  app.ev(`document.getElementById("fullscreen").click()`);
  await sleep(100); // it lays out again on the next frame
  const r = app.ev(`(() => {
    // Children of the maze screen, looking inside the .play-area wrapper (display: contents).
    const kids = [...mazeScreen.children].flatMap((el) => el.classList.contains("play-area") ? [...el.children] : [el]);
    const visible = kids.filter((el) => getComputedStyle(el).display !== "none").map((el) => el.id);
    const box = canvas.getBoundingClientRect();
    const exit = document.getElementById("exit-fullscreen").getBoundingClientRect();
    return { visible, top: box.top, bottom: box.bottom, width: box.width, exitTop: exit.top, exitBottom: exit.bottom, height: innerHeight };
  })()`);
  assert(r.visible.join() === "stage,exit-fullscreen", `showing ${r.visible.join(", ")}`);
  assert(r.top < 2 && r.width >= PHONE.width - 2, `the maze starts at ${Math.round(r.top)}px and is ${Math.round(r.width)}px wide`);
  assert(r.exitTop >= r.bottom && r.exitTop - r.bottom < 24, `the exit button is ${Math.round(r.exitTop - r.bottom)}px below the maze`);
  assert(r.exitBottom <= r.height && r.height - r.exitBottom < 40, `the exit button ends ${Math.round(r.height - r.exitBottom)}px above the bottom`);
  // Swipes still play in full screen.
  app.ev(`T.from = 0; T.press(T.solutionKey(), { shiftKey: true })`);
  assert(app.ev("moves") > 0, "couldn't move in full screen");
  app.ev(`document.getElementById("exit-fullscreen").click()`);
  await sleep(100);
  assert(!app.ev("fullScreen()") && shown(app, ".toolbar") && shown(app, "#status"), "exiting didn't bring the header back");
  app.ev(`document.getElementById("fullscreen").click(); T.press("Escape")`);
  assert(!app.ev("fullScreen()"), "Esc didn't leave full screen");
});

test("touch screens held sideways put the arrow pad beside the maze", async () => {
  // Without a touch screen the pad is hidden and nothing moves.
  const place = (app) => app.ev(`(() => {
    const maze = canvas.getBoundingClientRect(), pad = dpad.getBoundingClientRect();
    return { mazeRight: maze.right, mazeBottom: maze.bottom, mazeHeight: maze.height,
      padLeft: pad.left, padTop: pad.top, padShown: getComputedStyle(dpad).display !== "none",
      area: getComputedStyle(document.querySelector(".play-area")).display };
  })()`);
  const sideways = place(await openApp("size=61&colors=5", { width: 820, height: 600 }));
  if (!touchScreen) {
    assert(sideways.area === "contents" && !sideways.padShown, `desktop layout changed: ${JSON.stringify(sideways)}`);
    return;
  }
  assert(sideways.padShown && sideways.padLeft >= sideways.mazeRight, `pad at ${Math.round(sideways.padLeft)}px, maze ends at ${Math.round(sideways.mazeRight)}px`);
  assert(sideways.mazeHeight > 300, `the maze is only ${Math.round(sideways.mazeHeight)}px tall`);
  const upright = place(await openApp("size=61&colors=5", { width: 820, height: 1100 }));
  assert(upright.padTop >= upright.mazeBottom, "held upright, the pad should stay under the maze");
});

test("phone: the minimap is smaller and folds away when tapped", async () => {
  if (!touchScreen) return { skipped: "needs a touch screen (run.py --mobile)" };
  let app = await openApp("size=101&colors=7", PHONE);
  app.ev("localStorage.removeItem(MAP_KEY)");
  app = await openApp("size=101&colors=7", PHONE);
  const width = app.ev("minimap.getBoundingClientRect().width");
  assert(width <= 120 && width <= PHONE.width / 4 + 1, `the minimap is ${Math.round(width)}px wide`);
  app.ev("minimap.click()");
  assert(app.ev("minimap.hidden && !mapShow.hidden"), "tapping the minimap didn't fold it");
  app = await openApp("size=101&colors=7", PHONE);
  assert(app.ev("minimap.hidden && !mapShow.hidden"), "the folded minimap wasn't remembered");
  app.ev("mapShow.click()");
  assert(app.ev("!minimap.hidden && mapShow.hidden"), "the Map button didn't bring it back");
  app.ev("localStorage.removeItem(MAP_KEY)");
});

test("the app can be installed to the home screen", async () => {
  const app = await openApp("", { waitForMaze: false });
  const links = app.ev(`[document.querySelector("link[rel=manifest]")?.href, document.querySelector("link[rel=apple-touch-icon]")?.href]`);
  assert(links[0] && links[1], `missing links: ${links}`);
  const manifest = await (await fetch(links[0])).json();
  assert(manifest.name === "Rainbow Maze" && manifest.start_url && manifest.display === "fullscreen", JSON.stringify(manifest));
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`couldn't load ${src}`));
    img.src = src;
  });
  for (const { src, sizes } of manifest.icons) {
    const img = await load(new URL(src, links[0]).href);
    assert(`${img.naturalWidth}x${img.naturalHeight}` === sizes, `${src} is ${img.naturalWidth}x${img.naturalHeight}, says ${sizes}`);
  }
  const apple = await load(links[1]);
  assert(apple.naturalWidth === 180, `the iPhone icon is ${apple.naturalWidth}px`);
});

test("vibration: bumps, color changes and winning buzz, and it can be switched off", async () => {
  if (!touchScreen) return { skipped: "needs a touch screen (run.py --mobile)" };
  const app = await openApp("size=41&colors=4", PHONE);
  app.ev("localStorage.removeItem(VIBRATE_KEY); vibrateOn = true");
  // Record vibrations instead of needing a phone.
  app.ev(`T.buzzes = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (p) => (T.buzzes.push(JSON.stringify(p)), true) });
    updateVibrateSwitch();`);
  assert(app.ev(`!document.getElementById("vibrate-switch").hidden && vibrateToggle.checked`), "the switch should show, switched on");
  app.ev(`T.press(T.blockedKey())`);
  await sleep(50);
  assert(app.ev("T.buzzes").includes("25"), `a bump buzzed ${app.ev("T.buzzes")}`);
  app.ev(`vibrateToggle.click(); T.buzzes = []; T.press(T.blockedKey())`);
  await sleep(50);
  assert(app.ev("T.buzzes.length") === 0, "it buzzed while switched off");
  app.ev(`vibrateToggle.click(); T.buzzes = []; T.runToEnd()`);
  await sleep(500);
  const buzzes = app.ev("T.buzzes");
  assert(buzzes.includes("[15,40,15]") && buzzes.includes("[40,60,40,60,80]"), `buzzes: ${buzzes.join(" ")}`);
  app.ev("localStorage.removeItem(VIBRATE_KEY)");
});

test("a blocked move says why", async () => {
  const app = await openApp("size=41&colors=4&layout=bands");
  // Stand next to an open, colored square in a color that can't walk on it.
  const texts = app.ev(`(() => {
    const g = current.grid;
    for (let r = 1; r < g.length; r += 2)
      for (let c = 1; c < g.length; c += 2)
        for (const [key, [dr, dc]] of Object.entries({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] })) {
          const mid = g[r + dr]?.[c + dc];
          if (mid === undefined || mid === WALL || mid === COLOR_CHANGE || colorOf(mid) === "WHITE") continue;
          const blocked = ["RED", "GREEN", "BLUE", "YELLOW", "CYAN", "MAGENTA"].find((color) => !canEnter(color, colorOf(mid)));
          const texts = [];
          for (const color of [blocked, "WHITE"]) {
            player = [r, c];
            playerColor = color;
            T.press(key);
            texts.push([color, colorOf(mid), message.textContent]);
          }
          return texts;
        }
    return [];
  })()`);
  assert(texts.length === 2, "no colored opening found");
  const [[color, square, text], [, , whiteText]] = texts;
  const expected = `${color[0]}${color.slice(1).toLowerCase()} can't walk on ${square.toLowerCase()}.`;
  assert(text === expected, `message "${text}", expected "${expected}"`);
  assert(whiteText.startsWith("White can only walk on white."), `white message "${whiteText}"`);
});

test("difficulty presets fill in the settings, and editing them picks Custom", async () => {
  const app = await openApp("", { waitForMaze: false });
  const settings = () => app.ev("[sizeInput.value, colorsInput.value, layoutInput.value].join()");
  assert(settings() === "61,5,blobs", `default settings ${settings()}`);
  app.ev(`document.querySelector("input[value=easy]").click()`);
  assert(settings() === "31,3,bands", `easy settings ${settings()}`);
  app.ev(`sizeInput.value = 45; sizeInput.dispatchEvent(new Event("input"))`);
  assert(app.ev(`document.querySelector("input[value=custom]").checked`), "editing the size didn't pick Custom");
  app.ev(`document.querySelector("input[value=hard]").click(); form.requestSubmit()`);
  await until(() => app.ev("!!current && !building"), 30000, "the maze to build");
  assert(app.ev("current.grid.length") === 101, `built ${app.ev("current.grid.length")}, expected 101`);
});

test("the how-to-play chart matches the color rules", async () => {
  const app = await openApp("", { waitForMaze: false });
  const rows = app.ev(`[...document.querySelectorAll("#walk-chart tr")].map((tr) =>
    [...tr.querySelectorAll(".swatch")].map((s) => s.title).join(" "))`);
  assert(rows.length === 7, `${rows.length} rows`);
  assert(rows[0] === "White White", `white row: ${rows[0]}`);
  const magenta = rows.find((row) => row.startsWith("Magenta"));
  assert(magenta === "Magenta White Red Blue Magenta", `magenta row: ${magenta}`);
});

const reporting = new URLSearchParams(location.search).has("report");

async function runAll() {
  if (reporting) fetch("/progress", { method: "POST", body: JSON.stringify({ started: tests.length }) });
  const results = [];
  const list = document.getElementById("results");
  for (const { name, fn } of tests) {
    const started = performance.now();
    let error = null;
    let outcome = null;
    lastApp = null;
    try {
      outcome = await fn();
      if (lastApp?.errors.length) throw new Error(`page error: ${lastApp.errors[0]}`);
    } catch (e) {
      error = e.message || String(e);
    }
    const ms = Math.round(performance.now() - started);
    results.push({ name, ok: !error, error, ms, skipped: outcome?.skipped });
    const item = document.createElement("li");
    item.className = error ? "fail" : outcome?.skipped ? "skip" : "pass";
    item.textContent = name;
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = error ? `— ${error}` : outcome?.skipped ? `— skipped: ${outcome.skipped}` : `${ms}ms`;
    item.append(detail);
    list.append(item);
    if (reporting) fetch("/progress", { method: "POST", body: JSON.stringify(results.at(-1)) });
  }
  document.getElementById("frames").replaceChildren();
  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  document.getElementById("summary").textContent =
    (failed ? `${failed} of ${results.length} failed` : `All ${results.length - skipped} passed`) +
    (skipped ? ` (${skipped} skipped)` : "");
  // run.py serves this page and collects the results here.
  if (reporting) {
    await fetch("/results", { method: "POST", body: JSON.stringify(results) });
  }
}

runAll();
