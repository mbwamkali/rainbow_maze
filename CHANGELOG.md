# Changelog

Notable changes to Rainbow Maze. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] - Unreleased

The first public release.

### The game

- Mazes where you change color as you go: start white, step through checkered
  doorways to take on new colors, and reach the star. A color walks on itself, on
  white, and on any color it contains. Every maze has exactly one route that
  follows the rules, and it needs every color.
- Difficulty presets (Easy, Medium, Hard, Huge) or custom settings: size from 5
  to 250, 1 to 7 colors, and three layouts (bands, blobs, tendrils).
- A "How to play" panel whose chart and icons come from the game's own rules.
- Large mazes build in the background, so the page never freezes.

### Playing

- Move with the arrow keys or WASD; hold Shift to run to the next turn-off.
- On touch screens: swipe to run (stopping at the first bend, unless "Swipes go
  around corners" is switched on), an arrow pad, pinch to zoom, and drag with two
  fingers to look around.
- Undo, restart, a hint for the next few squares, and the whole route on demand.
- A message says why a move is blocked.
- Zoom with + / − / Fit or the mouse wheel. A minimap shows the whole maze when
  zoomed in, moves out of the smiley's way, and folds away with a click or N.
- A win screen with your moves, time, and how close you came to the shortest route.

### Phones and polish

- A phone layout: a compact header, a menu, full screen, the arrow pad beside the
  maze when held sideways, and a camera that glides after the smiley.
- Sound effects (off until you turn them on) and vibration on Android.
- Install to the home screen.
- Sharp on high-density screens; respects reduced motion; light and dark themes.

### For developers

- `maze.py`, a Python generator with the same rules that saves the maze as JSON
  and a picture.
- Browser tests that run on GitHub for every push, at normal and high pixel
  density and as a touch screen; passing `main` is published to GitHub Pages.

[1.0.0]: https://github.com/mbwamkali/rainbow_maze/releases/tag/v1.0.0
