"""Build a 100x100 grid of walls and colors, save it, and render it as an image."""

import json
import random
from collections import deque

from PIL import Image, ImageDraw

SIZE = 100
CELL = 48  # pixels per cell in the rendered image

WALL = "WALL"
# Start/end squares keep their color and carry a marker: {"color": "RED", "marker": "START"}.
START = "START"  # drawn as an X
END = "END"  # drawn as a circle
# Additive (light) model: primaries red/green/blue, secondaries cyan/magenta/yellow,
# and white = all primaries combined.
RGB = {
    "RED": (255, 0, 0),
    "GREEN": (0, 255, 0),
    "BLUE": (0, 0, 255),
    "CYAN": (0, 255, 255),
    "MAGENTA": (255, 0, 255),
    "YELLOW": (255, 255, 0),
    "WHITE": (255, 255, 255),
}
PRIMARY = ["RED", "GREEN", "BLUE"]
SECONDARY = ["CYAN", "MAGENTA", "YELLOW"]
MAX_COLORS = 1 + len(PRIMARY) + len(SECONDARY)


def pick_palette(count, rng):
    """Choose `count` colors: white first, then primaries, then secondaries, picked at random."""
    if not 1 <= count <= MAX_COLORS:
        raise ValueError(f"number of colors must be between 1 and {MAX_COLORS}")
    primaries = rng.sample(PRIMARY, min(count - 1, len(PRIMARY)))
    secondaries = rng.sample(SECONDARY, max(count - 1 - len(PRIMARY), 0))
    return ["WHITE"] + primaries + secondaries


def ask_color_count():
    """Menu: keep asking until the user enters a valid number of colors."""
    print("How many colors should the maze use?")
    print("  1   white only")
    print("  2   white + 1 random primary color")
    print("  3   white + 2 random primary colors")
    print("  4   white + all 3 primary colors")
    print("  5-7 white + all 3 primary colors + 1-3 random secondary colors")
    while True:
        answer = input(f"Enter a number (1-{MAX_COLORS}): ").strip()
        if answer.isdigit() and 1 <= int(answer) <= MAX_COLORS:
            return int(answer)
        print(f"Please enter a whole number from 1 to {MAX_COLORS}.")


def corners(size=SIZE):
    """Start is the upper-right open cell, end is the bottom-left open cell.

    Passages sit on odd coordinates, so the outermost usable index is the largest odd one.
    """
    last = size - 2 if size % 2 else size - 3
    return (1, last), (last, 1)


def carve(size, rng, start, palette):
    """Carve a maze with a randomized depth-first search; open cells get random colors."""
    grid = [[WALL] * size for _ in range(size)]

    # Carve on odd coordinates so walls sit between passages.
    grid[start[0]][start[1]] = rng.choice(palette)
    stack = [start]
    while stack:
        r, c = stack[-1]
        neighbors = [
            (r + dr, c + dc, r + dr // 2, c + dc // 2)
            for dr, dc in ((-2, 0), (2, 0), (0, -2), (0, 2))
            if 0 < r + dr < size - 1 and 0 < c + dc < size - 1 and grid[r + dr][c + dc] == WALL
        ]
        if not neighbors:
            stack.pop()
            continue
        nr, nc, mr, mc = rng.choice(neighbors)
        grid[mr][mc] = rng.choice(palette)
        grid[nr][nc] = rng.choice(palette)
        stack.append((nr, nc))
    return grid


def solve(grid, start, end):
    """Breadth-first search; returns the shortest path from start to end, or None."""
    size = len(grid)
    prev = {start: None}
    queue = deque([start])
    while queue:
        cell = queue.popleft()
        if cell == end:
            path = []
            while cell is not None:
                path.append(cell)
                cell = prev[cell]
            return path[::-1]
        r, c = cell
        for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if 0 <= nr < size and 0 <= nc < size and grid[nr][nc] != WALL and (nr, nc) not in prev:
                prev[(nr, nc)] = cell
                queue.append((nr, nc))
    return None


def build_grid(color_count=MAX_COLORS, size=SIZE, seed=None, max_attempts=100):
    """Build a maze with START in the upper right and END in the bottom left.

    Every attempt is checked with a solver and only a solvable maze is returned.
    """
    rng = random.Random(seed)
    palette = pick_palette(color_count, rng)
    start, end = corners(size)
    for _ in range(max_attempts):
        grid = carve(size, rng, start, palette)
        if solve(grid, start, end):
            for (r, c), marker in ((start, START), (end, END)):
                grid[r][c] = {"color": grid[r][c], "marker": marker}
            return grid
    raise RuntimeError(f"no solvable maze after {max_attempts} attempts")


def render(grid, path, cell=CELL):
    size = len(grid)
    img = Image.new("RGB", (size * cell, size * cell), "white")
    draw = ImageDraw.Draw(img)
    for r, row in enumerate(grid):
        for c, value in enumerate(row):
            box = (c * cell, r * cell, (c + 1) * cell - 1, (r + 1) * cell - 1)
            if value == WALL:
                draw.rectangle(box, fill="black")
            elif isinstance(value, dict):
                draw.rectangle(box, fill=RGB[value["color"]])
                pad, width = cell // 6, max(2, cell // 10)
                inner = (box[0] + pad, box[1] + pad, box[2] - pad, box[3] - pad)
                # Draw each marker twice: a wider white stroke underneath gives the black
                # stroke a white outline so it stands out on every color.
                halo = max(1, width // 2)
                if value["marker"] == START:
                    x0, y0, x1, y1 = inner
                    for a, b in (((x0, y0), (x1, y1)), ((x0, y1), (x1, y0))):
                        # Extend the white stroke past each end so the tips are outlined too.
                        dx, dy = (b[0] - a[0]) / (x1 - x0) * halo, (b[1] - a[1]) / (y1 - y0) * halo
                        draw.line((a[0] - dx, a[1] - dy, b[0] + dx, b[1] + dy), fill="white", width=width + 2 * halo)
                    for a, b in (((x0, y0), (x1, y1)), ((x0, y1), (x1, y0))):
                        draw.line((a, b), fill="black", width=width)
                else:
                    outer = (inner[0] - halo, inner[1] - halo, inner[2] + halo, inner[3] + halo)
                    draw.ellipse(outer, outline="white", width=width + 2 * halo)
                    draw.ellipse(inner, outline="black", width=width)
            else:
                draw.rectangle(box, fill=RGB[value])
    img.save(path)


if __name__ == "__main__":
    grid = build_grid(ask_color_count())
    with open("grid.json", "w") as f:
        json.dump(grid, f)
    render(grid, "grid.png")
    # Zoomed previews of the start (upper-right) and end (bottom-left) corners.
    render([row[-20:] for row in grid[:20]], "preview_start.png")
    render([row[:20] for row in grid[-20:]], "preview_end.png")
    start, end = corners()
    used = sorted({v["color"] if isinstance(v, dict) else v for row in grid for v in row} - {WALL})
    print(f"colors used: {', '.join(used)}")
    print(f"solution length: {len(solve(grid, start, end))} cells")
    print("wrote grid.json, grid.png, preview_start.png, preview_end.png")
