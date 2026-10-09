"""Build a 100x100 colored-light maze, save it, and render it as an image.

Same rules as the web app (web/maze.js):
- The player starts WHITE, which counts as "no color".
- A player can always walk on WHITE squares. A colored player can also walk on
  any color made only of their own primaries: RED walks on red; MAGENTA
  (red + blue) walks on magenta, red and blue, but not green.
- COLOR_CHANGE squares are the doorways between regions, placed far from where
  the player enters a region. Anyone can step onto one (keeping their color
  while on it), and step off it onto any square, in any direction, taking on
  that square's color. The new color replaces the old one.
  TODO(expert mode): mix instead of replace (red + blue = magenta).
- Each color is one connected region, and the player must become every color
  to finish.
- Each pair of neighboring regions touches in exactly floor(log10(size x size))
  places: one COLOR_CHANGE doorway, and openings that the color rules block.
  So there are several ways between two colors, but following the color rules
  there is exactly one route through the maze.
"""

import itertools
import json
import math
import random
import sys
from collections import deque

from PIL import Image, ImageDraw

SIZE = 100
CELL = 56  # pixels per passage in the rendered image; walls are a quarter of that

WALL = "WALL"
# Flashes (in the web app) between the colors of the squares it touches.
COLOR_CHANGE = "COLOR_CHANGE"
# Start and end keep their region color and carry a marker:
#   {"color": "WHITE", "marker": "START"}   drawn as an X
#   {"color": "BLUE", "marker": "END"}      drawn as a circle
START = "START"
END = "END"
# Additive (light) model: primaries red/green/blue, secondaries cyan/magenta/yellow,
# and white = all primaries combined.
# Slightly softened from pure (255, 0, 0) etc.; same values as the web app.
RGB = {
    "RED": (230, 57, 70),
    "GREEN": (47, 191, 113),
    "BLUE": (58, 111, 247),
    "CYAN": (34, 195, 214),
    "MAGENTA": (214, 79, 201),
    "YELLOW": (245, 204, 42),
    "WHITE": (255, 255, 255),
}
# Which primaries make up each color, as bits: red = 1, green = 2, blue = 4.
MASK = {"RED": 1, "GREEN": 2, "BLUE": 4, "YELLOW": 3, "MAGENTA": 5, "CYAN": 6, "WHITE": 7}
PRIMARY = ["RED", "GREEN", "BLUE"]
SECONDARY = ["CYAN", "MAGENTA", "YELLOW"]
MAX_COLORS = 1 + len(PRIMARY) + len(SECONDARY)
# Smallest maze that reliably fits one region per color (measured, plus a little margin).
MIN_SIZE_FOR_COLORS = {1: 5, 2: 5, 3: 9, 4: 15, 5: 21, 6: 25, 7: 31}
STEPS = ((-1, 0), (1, 0), (0, -1), (0, 1))


def pick_palette(count, rng):
    """Choose the first `count` colors of this sequence:

    1. white
    2. red (P1)
    3. a secondary containing P1 (S1)
    4. the other primary in S1 (P2)
    5. the last primary (P3)
    6. a secondary containing P3 (S2)
    7. the last secondary (S3)

    This picks which colors are used; region_order() decides the order of the regions.
    """
    if not 1 <= count <= MAX_COLORS:
        raise ValueError(f"number of colors must be between 1 and {MAX_COLORS}")

    def contains(secondary, primary):
        return MASK[secondary] & MASK[primary] != 0

    p1 = "RED"
    s1 = rng.choice([s for s in SECONDARY if contains(s, p1)])
    p2 = next(p for p in PRIMARY if p != p1 and contains(s1, p))
    p3 = next(p for p in PRIMARY if p not in (p1, p2))
    s2 = rng.choice([s for s in SECONDARY if s != s1 and contains(s, p3)])
    s3 = next(s for s in SECONDARY if s not in (s1, s2))
    return ["WHITE", p1, s1, p2, p3, s2, s3][:count]


def ask_color_count():
    """Menu: keep asking until the user enters a valid number of colors."""
    print("How many colors should the maze use?")
    print("  1   white only")
    print("  2   white + red")
    print("  3   white + red + a secondary containing red")
    print("  4   white + red + a secondary + its other primary")
    print("  5   white + all 3 primaries + a secondary containing red")
    print("  6   white + all 3 primaries + 2 secondaries")
    print("  7   white + all primary and secondary colors")
    while True:
        answer = input(f"Enter a number (1-{MAX_COLORS}): ").strip()
        if answer.isdigit() and 1 <= int(answer) <= MAX_COLORS:
            return int(answer)
        print(f"Please enter a whole number from 1 to {MAX_COLORS}.")


def ask_layout():
    """Menu: keep asking until the user picks a layout."""
    print("How should the colors be laid out?")
    print("  1   bands     wavy stripes from the upper left to the bottom right")
    print("  2   blobs     patches like countries on a map")
    print("  3   tendrils  colors wind through each other along the solution")
    styles = list(REGION_STYLES)
    while True:
        answer = input(f"Enter a number (1-{len(styles)}): ").strip()
        if answer.isdigit() and 1 <= int(answer) <= len(styles):
            return styles[int(answer) - 1]
        print(f"Please enter a whole number from 1 to {len(styles)}.")


def color_of(value):
    return value["color"] if isinstance(value, dict) else value


def step(player, frm, to, forbid=None):
    """The player's color after moving from square `frm` to square `to`, or None if not allowed.

    `forbid` names a color the player may not take on (used to check that every color is needed).
    """
    if to == WALL:
        return None
    if to == COLOR_CHANGE:
        return player
    if frm == COLOR_CHANGE:
        return None if color_of(to) == forbid else color_of(to)
    return player if can_enter(player, color_of(to)) else None


def can_enter(player, square):
    """Can a player of color `player` step onto a square of color `square`?"""
    if square == "WHITE":
        return True
    if player == "WHITE":
        return False  # white is "no color"
    return MASK[square] & ~MASK[player] == 0


def corners(size=SIZE):
    """Start is the upper-left open cell, end is the bottom-right open cell.

    Passages sit on odd coordinates, so the outermost usable index is the largest odd one.
    """
    last = size - 2 if size % 2 else size - 3
    return (1, 1), (last, last)


def region_order(colors, rng):
    """Order the non-white colors so each region needs a new color.

    A color right after one containing it (red after magenta) could be walked
    through without changing. The first color (red) always comes right after
    white. Primaries before secondaries always works; shuffling a few times
    first gives more variety.
    """
    if not colors:
        return []
    first, rest = colors[0], colors[1:]
    for _ in range(20):
        order = [first] + rng.sample(rest, len(rest))
        if all(not can_enter(order[j - 1], order[j]) for j in range(1, len(order))):
            return order
    return [first] + [c for c in rest if c in PRIMARY] + [c for c in rest if c in SECONDARY]


def band_lattice(m, count, rng, start, end, min_touch):
    """Split the passage lattice into `count` equal-size wavy diagonal bands.

    Bands run from the upper left to the bottom right.
    TODO(expert mode): allow several separate regions per color.
    """
    waves = [(0.35 / count * rng.random(), 1 + rng.random() * 2, rng.random() * 2 * math.pi) for _ in range(2)]
    span = max(1, 2 * (m - 1))
    nodes = []
    for i in range(m):
        for j in range(m):
            along = (i + j) / span  # 0 at upper left, 1 at bottom right
            across = (i - j) / span
            t = along + sum(amp * math.sin(2 * math.pi * freq * across + phase) for amp, freq, phase in waves)
            nodes.append((t, i, j))
    nodes.sort()
    band = [[0] * m for _ in range(m)]
    for rank, (_, i, j) in enumerate(nodes):
        band[i][j] = rank * count // len(nodes)
    return band


def _lattice_neighbors(m, i, j):
    return [(i + di, j + dj) for di, dj in STEPS if 0 <= i + di < m and 0 <= j + dj < m]


def _touching(m, region):
    """How many lattice-neighbor pairs join each pair of regions: {(a, b): count} with a < b."""
    touch = {}
    for i in range(m):
        for j in range(m):
            for ni, nj in ((i + 1, j), (i, j + 1)):
                if ni < m and nj < m and region[i][j] != region[ni][nj]:
                    key = tuple(sorted((region[i][j], region[ni][nj])))
                    touch[key] = touch.get(key, 0) + 1
    return touch


def blob_lattice(m, count, rng, start, end, min_touch):
    """Regions grown outward from scattered seed points, like countries on a map.

    The start's blob comes first and the end's blob last; the blobs in between
    are put in any order where each blob touches the next in at least
    `min_touch` places. Returns None if no such order exists.
    """
    if count == 1:
        return [[0] * m for _ in range(m)]
    nodes = [(i, j) for i in range(m) for j in range(m)]
    # Spread the seeds out: each new seed is the farthest of a few random candidates.
    seeds = [start]
    while len(seeds) < count:
        candidates = rng.sample(nodes, min(len(nodes), 12))
        seeds.append(max(candidates, key=lambda n: min(abs(n[0] - s[0]) + abs(n[1] - s[1]) for s in seeds)))
    if len(set(seeds)) < count:
        return None
    region = [[-1] * m for _ in range(m)]
    frontier = [[] for _ in range(count)]
    sizes = [0] * count
    for k, (i, j) in enumerate(seeds):
        region[i][j] = k
        sizes[k] = 1
        frontier[k] = _lattice_neighbors(m, i, j)
    # Always grow the smallest blob that still can, so sizes stay even.
    while True:
        growing = [k for k in range(count) if frontier[k]]
        if not growing:
            break
        k = min(growing, key=lambda g: (sizes[g], rng.random()))
        pick = rng.randrange(len(frontier[k]))
        frontier[k][pick], frontier[k][-1] = frontier[k][-1], frontier[k][pick]
        i, j = frontier[k].pop()
        if region[i][j] != -1:
            continue
        region[i][j] = k
        sizes[k] += 1
        frontier[k] += [n for n in _lattice_neighbors(m, i, j) if region[n[0]][n[1]] == -1]

    first, last = region[start[0]][start[1]], region[end[0]][end[1]]
    if first == last:
        return None
    touch = _touching(m, region)
    middle = [k for k in range(count) if k not in (first, last)]
    orders = list(itertools.permutations(middle))
    rng.shuffle(orders)
    for mid in orders:
        chain = [first, *mid, last]
        if all(touch.get(tuple(sorted(pair)), 0) >= min_touch for pair in zip(chain, chain[1:])):
            position = {k: n for n, k in enumerate(chain)}
            return [[position[region[i][j]] for j in range(m)] for i in range(m)]
    return None


def tendril_lattice(m, count, rng, start, end, min_touch):
    """Regions that follow the solution of one big maze, so colors interlock like fingers.

    Carve a maze over the whole lattice, cut its start-to-end path into `count`
    stretches of about equal weight, and give every dead-end branch the region
    of the path square it hangs off.
    """
    # One big maze (randomized depth-first search), remembering each square's parent.
    parent = {start: None}
    stack = [start]
    while stack:
        cur = stack[-1]
        nxt = [n for n in _lattice_neighbors(m, *cur) if n not in parent]
        if not nxt:
            stack.pop()
            continue
        n = rng.choice(nxt)
        parent[n] = cur
        stack.append(n)
    path = [end]
    while parent[path[-1]] is not None:
        path.append(parent[path[-1]])
    path.reverse()
    on_path = {n: k for k, n in enumerate(path)}

    # Which path square each branch hangs off, and how much hangs off each.
    children = {}
    for n, p in parent.items():
        if p is not None:
            children.setdefault(p, []).append(n)
    attach = {}
    weight = [0] * len(path)
    for k, p in enumerate(path):
        todo = [p]
        while todo:
            n = todo.pop()
            attach[n] = k
            weight[k] += 1
            todo += [c for c in children.get(n, []) if c not in on_path]

    # Cut the path where the running total passes each 1/count share.
    total, running, cuts = m * m, 0, []
    for k, w in enumerate(weight):
        running += w
        if len(cuts) < count - 1 and running >= total * (len(cuts) + 1) / count and k < len(path) - 1:
            cuts.append(k)
    if len(cuts) < count - 1:
        return None
    segment = [sum(1 for c in cuts if k > c) for k in range(len(path))]
    region = [[segment[attach[(i, j)]] for j in range(m)] for i in range(m)]
    sizes = [sum(row.count(k) for row in region) for k in range(count)]
    if min(sizes) < 0.5 * total / count:
        return None  # one branch was too big to split evenly
    touch = _touching(m, region)
    if any(touch.get((k, k + 1), 0) < min_touch for k in range(count - 1)):
        return None
    return region


# How the board is split into color regions.
REGION_STYLES = {"bands": band_lattice, "blobs": blob_lattice, "tendrils": tendril_lattice}


def layout(size, order, rng, style="bands"):
    """One attempt at a full layout; returns None if this random layout doesn't work out."""
    start, end = corners(size)
    m = (end[1] + 1) // 2  # lattice nodes per side
    colors = ["WHITE"] + order
    count = len(colors)
    si, sj = (start[0] - 1) // 2, (start[1] - 1) // 2
    ei, ej = (end[0] - 1) // 2, (end[1] - 1) // 2
    band = REGION_STYLES[style](m, count, rng, (si, sj), (ei, ej), connections_per_pair(size))
    if band is None or band[si][sj] != 0 or band[ei][ej] != count - 1:
        return None

    def inside(i, j):
        return 0 <= i < m and 0 <= j < m

    grid = [[WALL] * size for _ in range(size)]
    entries = [(si, sj)]

    for b in range(count):
        members = [(i, j) for i in range(m) for j in range(m) if band[i][j] == b]
        if not members:
            return None

        # Carve this region as its own maze (randomized depth-first search).
        ri, rj = entries[b]
        seen = {(ri, rj)}
        grid[2 * ri + 1][2 * rj + 1] = colors[b]
        stack = [(ri, rj)]
        while stack:
            i, j = stack[-1]
            nxt = [n for n in _lattice_neighbors(m, i, j) if band[n[0]][n[1]] == b and n not in seen]
            if not nxt:
                stack.pop()
                continue
            ni, nj = rng.choice(nxt)
            seen.add((ni, nj))
            grid[i + ni + 1][j + nj + 1] = colors[b]
            grid[2 * ni + 1][2 * nj + 1] = colors[b]
            stack.append((ni, nj))
        if len(seen) != len(members):
            return None  # region came out in pieces

        if b == count - 1:
            break

        # Distance of every square in this region from where the player comes in.
        origin = (2 * entries[b][0] + 1, 2 * entries[b][1] + 1)
        dist = {origin: 0}
        queue = deque([origin])
        while queue:
            r, c = queue.popleft()
            for dr, dc in STEPS:
                n = (r + dr, c + dc)
                if grid[n[0]][n[1]] == colors[b] and n not in dist:
                    dist[n] = dist[(r, c)] + 1
                    queue.append(n)

        # The doorway into the next region is a COLOR_CHANGE, picked from the 10% of
        # possible doorways farthest from the entrance so the region has to be explored.
        doors = [(dist[(2 * i + 1, 2 * j + 1)], i, j, i + di, j + dj)
                 for i, j in members for di, dj in STEPS
                 if inside(i + di, j + dj) and band[i + di][j + dj] == b + 1]
        if not doors:
            return None
        doors.sort(reverse=True)
        _, i, j, ni, nj = rng.choice(doors[:max(1, math.ceil(len(doors) / 10))])
        grid[i + ni + 1][j + nj + 1] = COLOR_CHANGE
        entries.append((ni, nj))

    grid[start[0]][start[1]] = {"color": "WHITE", "marker": START}
    grid[end[0]][end[1]] = {"color": colors[-1], "marker": END}
    return grid


def solve(grid, start, end, forbid=None):
    """Breadth-first search over (square, player color).

    Returns the shortest list of squares from start to end, or None.
    With `forbid`, the player may never take on that color.
    """
    size = len(grid)
    first = (start[0], start[1], "WHITE")
    prev = {first: None}
    queue = deque([first])
    while queue:
        state = queue.popleft()
        r, c, color = state
        if (r, c) == tuple(end):
            path = []
            while state:
                path.append((state[0], state[1]))
                state = prev[state]
            return path[::-1]
        for dr, dc in STEPS:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < size and 0 <= nc < size):
                continue
            new_color = step(color, grid[r][c], grid[nr][nc], forbid)
            if not new_color:
                continue
            nxt = (nr, nc, new_color)
            if nxt not in prev:
                prev[nxt] = state
                queue.append(nxt)
    return None


def connections_per_pair(size):
    """How many places each pair of neighboring regions must touch."""
    return math.floor(math.log10(size * size))


def boundary_squares(grid, pair=None, open_only=True):
    """Wall-position squares between passages of two different colors.

    Yields (row, col, frozenset of the two colors). With `pair`, only squares
    between those two colors; with open_only=False, closed walls instead of
    open squares (doorways and openings).
    """
    size = len(grid)
    for r in range(1, size - 1):
        for c in range(1, size - 1):
            if r % 2 == c % 2 or (grid[r][c] == WALL) == open_only:
                continue
            a, b = (grid[r][c - 1], grid[r][c + 1]) if r % 2 else (grid[r - 1][c], grid[r + 1][c])
            if WALL in (a, b) or color_of(a) == color_of(b):
                continue
            colors = frozenset((color_of(a), color_of(b)))
            if pair is None or colors == pair:
                yield r, c, colors


def route_squares(grid, start, end):
    """Squares that could be on a route, keyed by (row, col) with their degree.

    Dead-end branches are trimmed leaf by leaf (start and end are never trimmed).
    """
    size = len(grid)
    keep = {(r, c) for r in range(size) for c in range(size) if grid[r][c] != WALL}

    def neighbors(cell):
        return [(cell[0] + dr, cell[1] + dc) for dr, dc in STEPS if (cell[0] + dr, cell[1] + dc) in keep]

    degree = {cell: len(neighbors(cell)) for cell in keep}
    fixed = {tuple(start), tuple(end)}
    leaves = [cell for cell, d in degree.items() if d <= 1]
    while leaves:
        cell = leaves.pop()
        if cell in fixed or cell not in keep:
            continue
        keep.discard(cell)
        for n in neighbors(cell):
            degree[n] -= 1
            if degree[n] <= 1:
                leaves.append(n)
    return {cell: degree[cell] for cell in keep}


def count_solutions(grid, start, end, colored, limit):
    """Count routes from start to end that never revisit a square, stopping at `limit`.

    With `colored`, a route must also follow the color rules. Squares in
    dead-end branches can't be on any route, so they're trimmed first; what's
    left is junctions joined by corridors, and routes are counted over those.
    """
    start, end = tuple(start), tuple(end)
    degree = route_squares(grid, start, end)
    if end not in degree:
        return 0

    def junction(cell):
        return cell in (start, end) or degree[cell] != 2

    # Corridors between junctions, each walked square by square so colors can be checked.
    corridors = {}
    for cell in degree:
        if not junction(cell):
            continue
        corridors[cell] = []
        for dr, dc in STEPS:
            cur, prev = (cell[0] + dr, cell[1] + dc), cell
            if cur not in degree:
                continue
            cells = []
            while not junction(cur):
                cells.append(cur)
                prev, cur = cur, next(
                    n for n in ((cur[0] + a, cur[1] + b) for a, b in STEPS) if n in degree and n != prev)
            cells.append(cur)
            if cur != cell:
                corridors[cell].append((cells, cur))

    count = 0
    visited = {start}

    def walk(at, color):
        nonlocal count
        if at == end:
            count += 1
            return
        for cells, to in corridors[at]:
            if count >= limit:
                return
            if to in visited:
                continue
            p = color
            if colored:
                frm = grid[at[0]][at[1]]
                for r, c in cells:
                    p = step(p, frm, grid[r][c])
                    if not p:
                        break
                    frm = grid[r][c]
                if not p:
                    continue
            visited.add(to)
            walk(to, p)
            visited.discard(to)

    walk(start, "WHITE")
    return count


def add_openings(grid, start, end, colors, connections, rng):
    """Open walls between each pair of neighboring regions until they touch in `connections` places.

    The COLOR_CHANGE doorway counts as one. An opening is only kept if there is
    still exactly one route under the color rules. An opened square takes the
    color of one side so every color stays one region. Returns False if a
    boundary can't get enough openings.
    """
    for first, second in zip(colors, colors[1:]):
        boundary = [(r, c) for r, c, _ in boundary_squares(grid, frozenset((first, second)), open_only=False)]
        rng.shuffle(boundary)
        made = 1  # the doorway
        for r, c in boundary:
            if made == connections:
                break
            for color in rng.sample([first, second], 2):
                grid[r][c] = color
                if count_solutions(grid, start, end, True, 2) == 1:
                    made += 1
                    break
                grid[r][c] = WALL
        if made < connections:
            return False
    return True


def build_grid(color_count=MAX_COLORS, size=SIZE, seed=None, max_attempts=200, style="bands"):
    """Build a maze with START in the upper left and END in the bottom right.

    A layout is only accepted if every pair of neighboring regions touches in
    the required number of places, there's exactly one route under the color
    rules, and it can't be solved without taking on every color.
    Returns (grid, region color order, shortest solution).
    """
    if style not in REGION_STYLES:
        raise ValueError(f"layout must be one of: {', '.join(REGION_STYLES)}")
    if size < MIN_SIZE_FOR_COLORS[color_count]:
        raise ValueError(f"{color_count} colors need a maze size of at least {MIN_SIZE_FOR_COLORS[color_count]}")
    rng = random.Random(seed)
    palette = pick_palette(color_count, rng)
    start, end = corners(size)
    for _ in range(max_attempts):
        order = region_order(palette[1:], rng)
        result = layout(size, order, rng, style)
        if not result:
            continue
        grid = result
        if not add_openings(grid, start, end, ["WHITE"] + order, connections_per_pair(size), rng):
            continue
        path = solve(grid, start, end)
        if not path or any(solve(grid, start, end, color) for color in order):
            continue
        return grid, ["WHITE"] + order, path
    raise RuntimeError(f"a {size}x{size} maze is too small for {color_count} colors; try a larger size")


def touching_colors(grid, r, c):
    """The colors of the squares a COLOR_CHANGE square touches, in a fixed order."""
    colors = []
    for dr, dc in STEPS:
        if 0 <= r + dr < len(grid) and 0 <= c + dc < len(grid):
            value = grid[r + dr][c + dc]
            if value not in (WALL, COLOR_CHANGE) and color_of(value) not in colors:
                colors.append(color_of(value))
    return colors


def render(grid, path, cell=CELL):
    """Passages (odd rows/columns) are `cell` pixels thick, walls (even ones) a quarter of that."""
    # An even-sized grid ends in two all-wall rows/columns; the second sits on an
    # odd (passage-width) index and would make the right and bottom borders thick,
    # so leave it out (but keep it in cropped previews, where it holds passages).
    size = len(grid)
    if size % 2 == 0 and all(v == WALL for v in grid[-1]) and all(row[-1] == WALL for row in grid):
        size -= 1
    wall = max(1, round(cell / 4))

    def pos(k):
        return (k + 1) // 2 * wall + k // 2 * cell

    img = Image.new("RGB", (pos(size), pos(size)), "white")
    draw = ImageDraw.Draw(img)
    for r, row in enumerate(grid[:size]):
        for c, value in enumerate(row[:size]):
            box = (pos(c), pos(r), pos(c + 1) - 1, pos(r + 1) - 1)
            if value == WALL:
                draw.rectangle(box, fill="black")
                continue
            if value == COLOR_CHANGE:
                # Can't flash in a still image: split diagonally between the colors it
                # touches, with a black and white frame so it reads as one block.
                colors = touching_colors(grid, r, c)
                x0, y0, x1, y1 = box
                draw.polygon([(x0, y0), (x1, y0), (x0, y1)], fill=RGB[colors[0]])
                draw.polygon([(x1, y0), (x1, y1), (x0, y1)], fill=RGB[colors[-1]])
                frame = max(1, min(box[2] - box[0], box[3] - box[1]) // 8)
                draw.rectangle(box, outline="white", width=2 * frame)
                draw.rectangle(box, outline="black", width=frame)
                continue
            draw.rectangle(box, fill=RGB[color_of(value)])
            if not isinstance(value, dict):
                continue
            pad, width = cell // 6, max(2, cell // 10)
            inner = (box[0] + pad, box[1] + pad, box[2] - pad, box[3] - pad)
            # Draw each mark twice: a wider white stroke underneath gives the black
            # stroke a white outline so it stands out on every color.
            halo = max(1, width // 2)
            outer = (inner[0] - halo, inner[1] - halo, inner[2] + halo, inner[3] + halo)
            if value["marker"] == START:
                x0, y0, x1, y1 = inner
                for a, b in (((x0, y0), (x1, y1)), ((x0, y1), (x1, y0))):
                    # Extend the white stroke past each end so the tips are outlined too.
                    dx, dy = (b[0] - a[0]) / (x1 - x0) * halo, (b[1] - a[1]) / (y1 - y0) * halo
                    draw.line((a[0] - dx, a[1] - dy, b[0] + dx, b[1] + dy), fill="white", width=width + 2 * halo)
                for a, b in (((x0, y0), (x1, y1)), ((x0, y1), (x1, y0))):
                    draw.line((a, b), fill="black", width=width)
            else:
                draw.ellipse(outer, outline="white", width=width + 2 * halo)
                draw.ellipse(inner, outline="black", width=width)
    img.save(path)


if __name__ == "__main__":
    sys.setrecursionlimit(10_000)  # route counting recurses once per junction
    color_count = ask_color_count()
    style = ask_layout()
    grid, order, path = build_grid(color_count, style=style)
    with open("grid.json", "w") as f:
        json.dump(grid, f)
    render(grid, "grid.png")
    # Zoomed previews of the start (upper-left) and end (bottom-right) corners.
    render([row[:20] for row in grid[:20]], "preview_start.png")
    render([row[-20:] for row in grid[-20:]], "preview_end.png")
    start, end = corners()
    print(f"{style} layout, regions start to end: {' -> '.join(c.lower() for c in order)}")
    for first, second in zip(order, order[1:]):
        touching = sum(1 for _ in boundary_squares(grid, frozenset((first, second))))
        print(f"{first.lower()}/{second.lower()} touch in {touching} places"
              f" (target {connections_per_pair(SIZE)}, 1 is the color change)")
    print(f"routes following color rules: {count_solutions(grid, start, end, True, 100)}")
    print(f"shortest solution: {len(path) - 1} moves")
    print("wrote grid.json, grid.png, preview_start.png, preview_end.png")
