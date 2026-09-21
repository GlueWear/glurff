"""Build the collision, portal and over-character layers for the secret map.

The four imported layers in map/vatican-source remain the authority.  Nothing
about the Vatican's walls, spawn, exit, or obscured artwork is duplicated in
frontend code.

No ship commands, network access or deployment. Run from build/ui:

    python3 tools/build_vatican_map.py
"""
from pathlib import Path
from collections import deque
import base64
import json
import shutil
import subprocess

from pnglib import read_png, write_png


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'map/vatican-source'
CELL = 2
TILE = 24
ALPHA = 32
#  The drawing's narrowest doors are only a handful of pixels wide. These are
#  deliberate passages whose centre lines must survive rasterisation. The two
#  rotunda entries were effectively single-file slits; the three west-court
#  entries are the horizontal passages visible in the doorway screenshot.
PASSAGES = [
    ('rotunda-north', 354, 402, 370, 442),
    ('rotunda-south', 354, 588, 370, 640),
    ('court-west-north', 296, 780, 312, 794),
    ('court-west-middle', 296, 828, 312, 842),
    ('court-west-south', 296, 880, 312, 894),
]


def alpha_mask(path):
    width, height, pixels = read_png(str(path))
    return width, height, bytearray(pixels[i * 4 + 3] > ALPHA for i in range(width * height))


def components(mask, width, height):
    seen = bytearray(width * height)
    found = []
    for start, marked in enumerate(mask):
        if not marked or seen[start]:
            continue
        seen[start] = 1
        queue, part = deque([start]), []
        while queue:
            at = queue.popleft()
            part.append(at)
            x, y = at % width, at // width
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < width and 0 <= ny < height):
                    continue
                nxt = ny * width + nx
                if mask[nxt] and not seen[nxt]:
                    seen[nxt] = 1
                    queue.append(nxt)
        found.append(part)
    return sorted(found, key=len, reverse=True)


def bounds(part, width):
    xs = [i % width for i in part]
    ys = [i // width for i in part]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def enclosed(outline, width, height):
    """Pixels enclosed by one connected designation outline."""
    x0, y0, x1, y1 = bounds(outline, width)
    x0, y0 = max(0, x0 - 1), max(0, y0 - 1)
    x1, y1 = min(width, x1 + 1), min(height, y1 + 1)
    ow, oh = x1 - x0, y1 - y0
    barrier = bytearray(ow * oh)
    for at in outline:
        x, y = at % width, at // width
        barrier[(y - y0) * ow + x - x0] = 1
    outside = bytearray(ow * oh)
    queue = deque()
    for x in range(ow):
        for y in (0, oh - 1):
            i = y * ow + x
            if not barrier[i] and not outside[i]:
                outside[i] = 1
                queue.append(i)
    for y in range(oh):
        for x in (0, ow - 1):
            i = y * ow + x
            if not barrier[i] and not outside[i]:
                outside[i] = 1
                queue.append(i)
    while queue:
        at = queue.popleft()
        x, y = at % ow, at // ow
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < ow and 0 <= ny < oh):
                continue
            nxt = ny * ow + nx
            if not barrier[nxt] and not outside[nxt]:
                outside[nxt] = 1
                queue.append(nxt)
    inside = []
    for y in range(oh):
        for x in range(ow):
            i = y * ow + x
            if not barrier[i] and not outside[i]:
                inside.append((y + y0) * width + x + x0)
    if not inside:
        raise ValueError(f'designation outline at {(x0, y0, x1, y1)} is not closed')
    return inside


def cell_mask(pixels, width, height):
    cols, rows = width // CELL, height // CELL
    out = bytearray(cols * rows)
    for at, marked in enumerate(pixels):
        if marked:
            out[(at // width // CELL) * cols + (at % width // CELL)] = 1
    return out, cols, rows


def pack(bits):
    out = bytearray((len(bits) + 7) // 8)
    for i, bit in enumerate(bits):
        if bit:
            out[i >> 3] |= 1 << (i & 7)
    return base64.b64encode(bytes(out)).decode()


def clear_passages(walls, cols, rows):
    for name, x0, y0, x1, y1 in PASSAGES:
        for cy in range(max(0, y0 // CELL), min(rows, (y1 + CELL - 1) // CELL)):
            for cx in range(max(0, x0 // CELL), min(cols, (x1 + CELL - 1) // CELL)):
                walls[cy * cols + cx] = 0
        print(f'passage {name}: {x0},{y0}..{x1},{y1}')


def main():
    picture = SRC / 'picture.jpg'
    boundary = SRC / 'boundary-layer.png'
    designation = SRC / 'designation-layer.png'
    obscure = SRC / 'obscure-layer.png'
    for path in (picture, boundary, designation, obscure):
        if not path.is_file():
            raise FileNotFoundError(path)

    width, height, wall_pixels = alpha_mask(boundary)
    if width % CELL or height % CELL:
        raise ValueError(f'{width}x{height} map does not fit the {CELL}px collision grid')
    for path in (designation, obscure):
        w, h, _ = alpha_mask(path)
        if (w, h) != (width, height):
            raise ValueError(f'{path.name} is {w}x{h}, expected {width}x{height}')

    _, _, marks = alpha_mask(designation)
    parts = components(marks, width, height)
    if len(parts) < 2 or len(parts[1]) < 1000:
        raise ValueError('Expected two large closed designation outlines')
    designated = sorted(parts[:2], key=lambda p: bounds(p, width)[1])
    exit_outline, spawn_outline = designated
    exit_pixels = enclosed(exit_outline, width, height)
    spawn_pixels = enclosed(spawn_outline, width, height)

    walls, cols, rows = cell_mask(wall_pixels, width, height)
    clear_passages(walls, cols, rows)
    sx = round(sum(i % width for i in spawn_pixels) / len(spawn_pixels)) // CELL
    sy = round(sum(i // width for i in spawn_pixels) / len(spawn_pixels)) // CELL
    start = min((i for i in range(cols * rows) if not walls[i]),
                key=lambda i: (i % cols - sx) ** 2 + (i // cols - sy) ** 2)

    reachable = bytearray(cols * rows)
    reachable[start] = 1
    queue = deque([start])
    while queue:
        at = queue.popleft()
        x, y = at % cols, at // cols
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < cols and 0 <= ny < rows):
                continue
            nxt = ny * cols + nx
            if not walls[nxt] and not reachable[nxt]:
                reachable[nxt] = 1
                queue.append(nxt)
    collision = bytearray(walls[i] or not reachable[i] for i in range(cols * rows))

    exit_cells = bytearray(cols * rows)
    for at in exit_pixels:
        cell = (at // width // CELL) * cols + (at % width // CELL)
        if not collision[cell]:
            exit_cells[cell] = 1
    if not any(exit_cells):
        raise ValueError('The exit designation does not overlap reachable floor')

    spawn = [(start % cols) * CELL + CELL // 2, (start // cols) * CELL + CELL // 2]
    data = {
        'width': width, 'height': height, 'cell': CELL, 'tile': TILE,
        'cols': cols, 'rows': rows, 'spawn': spawn,
        'solid': pack(collision), 'exit': pack(exit_cells),
        'exitBounds': list(bounds(exit_outline, width)),
    }
    out = ROOT / 'src/world/vatican-data.js'
    out.write_text('/* Generated by tools/build_vatican_map.py. Do not edit by hand. */\n'
                   'export default ' + json.dumps(data, separators=(',', ':')) + ';\n')

    public = ROOT / 'public/map'
    public.mkdir(parents=True, exist_ok=True)
    shutil.copy2(picture, public / 'vatican.jpg')
    flat = SRC / 'picture.png'
    if not flat.exists() or flat.stat().st_mtime < picture.stat().st_mtime:
        subprocess.run(['sips', '-s', 'format', 'png', str(picture), '--out', str(flat)],
                       check=True, capture_output=True)
    pw, ph, paint = read_png(str(flat))
    ow, oh, over_marks = read_png(str(obscure))
    if (pw, ph) != (ow, oh) or (pw, ph) != (width, height):
        raise ValueError('Paint and obscure layers have different dimensions')
    # The supplied obscure layer alone decides what draws above a character.
    # Boundary strokes are collision data, not automatic foreground artwork.
    cut = bytearray(width * height * 4)
    kept = 0
    for i in range(width * height):
        if over_marks[i * 4 + 3] > ALPHA:
            cut[i * 4:i * 4 + 3] = paint[i * 4:i * 4 + 3]
            cut[i * 4 + 3] = 255
            kept += 1
    write_png(str(public / 'vatican-over.png'), width, height, bytes(cut))

    walkable = sum(not bit for bit in collision)
    print(f'{width}x{height}; {cols}x{rows} cells of {CELL}px; tile {TILE}px')
    print(f'spawn {spawn[0]},{spawn[1]}; exit bounds {data["exitBounds"]}')
    print(f'walkable {walkable} cells; exit {sum(exit_cells)} cells; obscure {kept} pixels')
    print(f'wrote {out.relative_to(ROOT)}, public/map/vatican.jpg and public/map/vatican-over.png')


if __name__ == '__main__':
    main()
