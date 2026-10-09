# Rainbow Maze

A maze where you change color as you go. You start white, step through checkered
doorways to take on new colors, and each color can only walk on certain squares.
Reach the star in the bottom right, becoming every color on the way.

**Play it at https://mbwamkali.github.io/rainbow_maze/**

There are two parts:

- **`web/`**, a playable browser game.
- **`maze.py`**, a Python script that builds a maze with the same rules and saves it as
  `grid.json` and `grid.png`.

## How to play

- You start at the doorway in the upper left. Reach the star in the bottom right.
- You start **white**, and white can only walk on white.
- **Checkered doorways** join two colors. Anyone can step onto one, and you take on the
  color of whatever square you step onto next, in any direction. Your new color
  replaces the old one.
- A color walks on itself, on white, and on any color it contains. Light mixes, so
  magenta (red + blue) walks on magenta, red and blue, but not green.
- Each maze has exactly one route that follows these rules, and you'll need every color.

| | Keyboard | Touch |
|---|---|---|
| Move one square | Arrow keys or WASD | Arrow pad below the maze (on phones, switch it on in the menu) |
| Run to the next turn-off | Shift + arrow | Swipe |
| Zoom | `+` `−` `0` (fit), mouse wheel | Pinch, or the − / + / Fit buttons |
| Undo | Z, U, Backspace or Ctrl+Z | Undo button (in the menu on phones) |
| Restart | R twice | Restart button twice (in the menu on phones) |
| Hint / show the route | H / Shift + H | Hint and Show route buttons (Show route is in the menu on phones) |
| Pause | Esc | |
| Full screen (phones) | | ⛶ Full screen button; ✕ Exit full screen under the maze |

On phones, the header is compact: ☰ Menu holds undo, restart, the route, new maze,
settings, sound, zoom and the arrow pad switch.

## Running the web app

It's plain HTML and JavaScript with no build step. You can open `web/index.html`
directly, but serving it over HTTP is better: browsers don't allow Web Workers from
`file://`, so large mazes then build on the main page and it pauses briefly.

```sh
python3 -m http.server -d web
```

Then open http://localhost:8000. To skip the setup screen, add settings to the URL,
e.g. `?size=41&colors=4&layout=blobs`.

On a phone, it can be installed to the home screen (Share → Add to Home Screen on
iPhone, or the browser menu's Install / Add to Home screen on Android). It then opens
full screen, without the browser's bars. This needs the game served from its own
address, like the GitHub Pages site above, not embedded in another page.

## Running the Python generator

```sh
python3 -m venv .venv
.venv/bin/pip install pillow
.venv/bin/python maze.py
```

It asks for the number of colors and a layout, then writes `grid.json` (the maze),
`grid.png` (a picture of it) and zoomed-in previews of the start and end corners.

## Tests

The web app has browser tests in `web/tests/`. Each one loads the real app in an
iframe and plays it. To run them in headless Firefox:

```sh
python3 web/tests/run.py            # at normal pixel density
python3 web/tests/run.py --dpr 2    # as on a high-DPI screen
python3 web/tests/run.py --mobile   # as on a touch screen, including the phone layout
```

To watch them run, serve `web/` as above and open http://localhost:8000/tests/.
They also run on GitHub for every push (`.github/workflows/tests.yml`). When they pass
on `main`, the web app is published to GitHub Pages (`.github/workflows/pages.yml`).

## Files

| Path | What it is |
|---|---|
| `web/index.html` | The page: setup screen, maze screen, menus and styles |
| `web/maze.js` | Maze rules, generation, solving and drawing (shared with the worker) |
| `web/app.js` | The game: input, camera and zoom, animation, undo, hints, win screen |
| `web/worker.js` | Builds mazes off the main thread |
| `web/manifest.webmanifest`, `web/icons/` | For installing to a phone's home screen |
| `web/tests/` | Browser tests and their runner |
| `maze.py` | The Python generator |
