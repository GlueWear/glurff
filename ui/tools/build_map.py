"""Turn the painted map into what the world needs, from the four drawn layers.

    picture      the map itself, drawn once as the ground
    boundary     strokes around walls and furniture -> what you cannot walk through
    obscure      what is drawn OVER people, so they pass behind doorways
    designation  a labelled box inside each room -> which room is where

Nothing is invented here: every wall and every room comes from the drawing. The
collision grid is eight pixels a cell, so a thin drawn wall still stops you, and
the whole of it is a few hundred bytes in the page.

No ship commands, no network, no deployment. Run from build/ui:

    python3 tools/build_map.py
"""
from pathlib import Path
import heapq
from collections import deque
import base64, json, shutil, subprocess, sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from pnglib import read_png, write_png                        # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'map/source'
CELL = 8                      #  pixels per collision cell
PAD = 2                       #  cells a room may grow past its label
LEAK = 3000                   #  a fill past this has escaped into the commons
DOOR = 3                      #  cells: how close a wall must be to make a doorway
#  A character is drawn upward from its feet, about 48 painted pixels tall, so
#  a table that blocks you along its whole drawn outline stops you with your
#  whole body still above it -- the boundaries read as sitting too high. Every
#  free-standing piece of furniture therefore blocks you HALF A CHARACTER LOWER
#  than it is drawn, which is what lets you walk up to a table and stand at it.
#  The building itself -- walls, doorways, anything the outline is part of --
#  is never moved.
SINK = 3                      #  cells: half a character, 24 painted pixels
#  The top of a table is TRIMMED rather than the whole table moved down.
#  Moving it down freed its top edge and closed whatever was below it: the
#  Rumors table shut the way in from its top door, and the library's top tables
#  could no longer be walked around. Trimming gives the same thing -- you walk
#  up to a table and stand at it, your body over its near edge -- and takes
#  nothing away from the floor below it.
#  WHICH furniture, and no more. Only the tables and desks that were actually
#  too high: the ones in the commons and in the three big rooms downstairs.
#  Sinking everything free-standing moved plants, lamps, counters and the bar
#  as well, which is not what was asked for and broke the feel of those rooms.
SINK_ROOMS = {'commons', 'board', 'war', 'library'}
SINK_MIN = (40, 32)           #  px: table-sized. A plant is narrower than this.
DOORWAY_COST = 400            #  what crossing a threshold costs a room's reach
COMMONS_ID = 99               #  what the map calls the commons

#  Where each room's label sits, from the designation layer, and what it says.
#  The boxes are found by the script; these names are the reading of them.
ROOMS = [
    ('bar',           'Bar',            98,  87, 344, 218),
    ('presentation',  'Amphitheatre',  483,  86, 575, 198),
    ('movie',         'Movie Theater', 1095, 163, 366, 147),
    ('office-1',      'Office 1',       71, 329, 172,  65),
    ('office-2',      'Office 2',       69, 429, 172,  66),
    ('office-3',      'Office 3',       69, 521, 172,  65),
    ('office-4',      'Office 4',       65, 611, 172,  65),
    ('office-5',      'Office 5',     1287, 332, 172,  66),
    ('office-6',      'Office 6',     1293, 434, 172,  65),
    ('office-7',      'Office 7',     1292, 526, 172,  66),
    ('office-8',      'Office 8',     1289, 616, 173,  65),
    ('board',         'Board Room',     70, 684, 337, 241),
    ('war',           'Rumors',        424, 747, 337, 241),
    ('library',       'Library',       774, 753, 337, 241),
    ('game',          'Game Room',    1121, 682, 348, 241),
]
SPAWN = (768, 600)            #  the floor below the couch in the middle


def mask(path, w, h, cw, ch):
    """Anything drawn at all, as one bit per collision cell."""
    iw, ih, px = read_png(str(path))
    assert (iw, ih) == (w, h), f'{path.name} is {iw}x{ih}, expected {w}x{h}'
    out = bytearray(cw * ch)
    for y in range(ih):
        row, cy = y * iw, y // CELL
        for x in range(iw):
            if px[(row + x) * 4 + 3] > 32:
                out[cy * cw + x // CELL] = 1
    return out


def pieces_of(walls, cw, ch):
    """Every free-standing piece of furniture, and the building it stands in.

    The building is one connected outline that spans the map; the furniture is
    everything else, each piece its own island. Anything drawn touching a wall
    -- the bar counter, the bookshelves -- is part of that outline.
    """
    seen = bytearray(cw * ch)
    found = []
    for i in range(cw * ch):
        if not walls[i] or seen[i]:
            continue
        seen[i] = 1
        q, cells = deque([i]), []
        while q:
            j = q.popleft()
            cells.append(j)
            x, y = j % cw, j // cw
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < cw and 0 <= ny < ch:
                        k = ny * cw + nx
                        if walls[k] and not seen[k]:
                            seen[k] = 1
                            q.append(k)
        found.append(cells)
    found.sort(key=len, reverse=True)
    return found[0], found[1:]


def sink_furniture(walls, structure, furniture, region, slug_of, cw, ch):
    """Trim half a character off the TOP of the named tables' collision.

    A character is drawn upward from its feet, about 48 painted pixels tall, so
    a table that blocks you along its whole drawn outline stops you with your
    whole body still above it. Freeing its top edge is what lets you walk up to
    a table and stand AT it.

    The trim is the piece intersected with itself shifted down, which erodes
    the top edge by SINK and leaves every other edge exactly where it is. A
    piece that was simply MOVED down gained 24px at the bottom, and that is
    what closed the way through the Rumors room and around the library tables.

    Only the tables asked for: table-sized pieces standing on the commons, the
    board room, Rumors or the library. The building itself -- walls, doorways,
    anything the outline is part of -- is never moved, and neither is a plant,
    a lamp, a bar counter or anything in a room that was not named.
    """
    out = bytearray(cw * ch)
    for i in structure:
        out[i] = 1                #  the building, exactly as drawn
    moved = []
    for cells in furniture:
        xs = [c % cw for c in cells]
        ys = [c // cw for c in cells]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        wide, tall = (x1 - x0 + 1) * CELL, (y1 - y0 + 1) * CELL
        #  The floor it stands ON is the floor just below it: that is the room
        #  somebody walking up to it is standing in.
        floors = {}
        for y in range(y1 + 1, min(ch, y1 + 1 + SINK + 1)):
            for x in range(x0, x1 + 1):
                r = region[y * cw + x]
                if r:
                    floors[r] = floors.get(r, 0) + 1
        room = slug_of(max(floors, key=floors.get)) if floors else None
        take = room in SINK_ROOMS and wide >= SINK_MIN[0] and tall >= SINK_MIN[1]
        if not take:
            for i in cells:
                out[i] = 1
            continue
        #  Keep a cell only if the piece also covers the cell SINK rows above
        #  it: the top edge moves down, every other edge stays.
        own = set(cells)
        kept = [i for i in cells if (i - SINK * cw) in own]
        for i in kept:
            out[i] = 1
        moved.append((room, wide, tall, x0 * CELL, y0 * CELL, len(cells) - len(kept)))
    return out, moved


def dilate(src, cw, ch, times):
    out = bytearray(src)
    for _ in range(times):
        nxt = bytearray(out)
        for y in range(ch):
            for x in range(cw):
                if not out[y * cw + x]:
                    continue
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < cw and 0 <= ny < ch:
                            nxt[ny * cw + nx] = 1
        out = nxt
    return out


def main():
    pic = SRC / 'picture.jpg'
    boundary, obscure = SRC / 'boundary-layer.png', SRC / 'obscure-layer.png'
    w, h, _ = read_png(str(boundary))
    cw, ch = w // CELL, h // CELL
    #  TWO MASKS, deliberately. Where the rooms are, and where their doorways
    #  are, is a property of the DRAWING: it must not move because a table did.
    #  What stops you walking is the drawing with its furniture sunk half a
    #  character, so you can walk up to a table and stand at it.
    walls = mask(boundary, w, h, cw, ch)
    structure, furniture = pieces_of(walls, cw, ch)
    doors = mask(obscure, w, h, cw, ch)
    #  THE WORLD IS WHAT YOU CAN WALK TO from the spawn. Everything else -- the
    #  space outside the building above all -- is as solid as a wall. Working
    #  this out first matters: a label box overlaps its room's outer wall, so a
    #  room filled without it escapes into the outside and swallows the map.
    #  Sinking the furniture moved the couch over the spawn, so the spawn moves
    #  with it: it is "the floor below the couch", not a fixed pair of numbers.
    sx, sy = SPAWN[0] // CELL, SPAWN[1] // CELL
    start = min((i for i in range(cw * ch) if not walls[i]),
                key=lambda i: (i % cw - sx) ** 2 + (i // cw - sy) ** 2)
    spawn = ((start % cw) * CELL + CELL // 2, (start // cw) * CELL + CELL // 2)
    if start != (SPAWN[1] // CELL) * cw + SPAWN[0] // CELL:
        print(f'spawn moved to {spawn[0]},{spawn[1]}: {SPAWN[0]},{SPAWN[1]} is blocked')
    assert not walls[start], 'the spawn is inside a wall'
    inside = bytearray(cw * ch)
    inside[start] = 1
    q = deque([start])
    while q:
        i = q.popleft()
        x, y = i % cw, i // cw
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < cw and 0 <= ny < ch:
                j = ny * cw + nx
                if not inside[j] and not walls[j]:
                    inside[j] = 1
                    q.append(j)
    #  Rooms are worked out on the drawing; what ships as the collision grid is
    #  the sunk furniture, plus everything outside the building.
    solid = bytearray(1 if (walls[i] or not inside[i]) else 0 for i in range(cw * ch))

    #  A room stops at its DOORWAY. Two things say where one is: the marks drawn
    #  over the doors, and the shape of the walls themselves -- standing in a
    #  doorway, the wall it pierces is close on both sides of you. Neither alone
    #  was enough: the marks miss a few, and the shape alone would cut a room in
    #  half at a narrow spot.
    thresholds = bytearray(cw * ch)
    for y in range(ch):
        for x in range(cw):
            i = y * cw + x
            if solid[i]:
                continue
            near = lambda dx, dy: any(solid[(y + dy * k) * cw + (x + dx * k)]
                                      for k in range(1, DOOR + 1)
                                      if 0 <= x + dx * k < cw and 0 <= y + dy * k < ch)
            if (near(0, -1) and near(0, 1)) or (near(-1, 0) and near(1, 0)):
                thresholds[i] = 1
    #  The marks drawn over the doors count too, thickened a little so a mark
    #  that sits just inside the frame still spans the gap.
    thresholds = bytearray(a | b for a, b in zip(thresholds, dilate(doors, cw, ch, 2)))

    #  EVERY ROOM AND THE COMMONS GROW AT ONCE, out of their labels and out of
    #  the spawn, and the cheapest path wins each cell. Crossing a threshold
    #  costs a room dearly, so a room reaches its doorway and stops: you are in
    #  a room the moment you step through its door and out of it the moment you
    #  leave. Filling them one after another let whichever went first swallow
    #  its neighbour -- Office 7 ate Office 8 -- and filling them without the
    #  cost let the wide-mouthed rooms pour out into the commons.
    region = bytearray(cw * ch)
    cost = [None] * (cw * ch)
    heap = []
    def put(i, c, rid):
        if cost[i] is not None and cost[i] <= c:
            return
        cost[i] = c
        region[i] = rid
        heapq.heappush(heap, (c, i, rid))
    #  ONE seed per room, at the middle of its label, and then THE ROOM ITSELF:
    #  everything the seed reaches without crossing a threshold. A label box is
    #  drawn loosely and some of them hang over their room's own wall -- the
    #  amphitheatre's does -- so seeding every cell of the box plants a room out
    #  in the commons, where nothing can stop it spreading.
    #
    #  Seeding the whole room rather than one cell is what keeps a room on its
    #  own side of its door. Grown from a single seed, a room reached through
    #  its doorway and then kept going along the corridor outside, so the strip
    #  of floor between two doorways belonged to whichever room was nearer --
    #  you were "in the Library" while walking past it.
    def flood(seeds, rid):
        q = deque()
        for i in seeds:
            if not solid[i] and not thresholds[i]:
                put(i, 0, rid); q.append(i)
        while q:
            i = q.popleft()
            x, y = i % cw, i // cw
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < cw and 0 <= ny < ch):
                    continue
                j = ny * cw + nx
                if solid[j] or thresholds[j] or cost[j] is not None:
                    continue
                put(j, 0, rid); q.append(j)
        return q

    for rid, (slug, name, bx, by, bw, bh) in enumerate(ROOMS, start=1):
        cx, cy = (bx + bw // 2) // CELL, (by + bh // 2) // CELL
        seed = min((i for i in range(cw * ch) if not solid[i]),
                   key=lambda i: (i % cw - cx) ** 2 + (i // cw - cy) ** 2)
        flood([seed], rid)
        #  A seed that landed in a doorway has no room to flood; hold the cell.
        if cost[seed] is None:
            put(seed, 0, rid)
    flood([start], COMMONS_ID)
    while heap:
        c, i, rid = heapq.heappop(heap)
        if cost[i] != c or region[i] != rid:
            continue
        x, y = i % cw, i // cw
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < cw and 0 <= ny < ch) or solid[ny * cw + nx]:
                continue
            j = ny * cw + nx
            put(j, c + (DOORWAY_COST if thresholds[j] else 1), rid)

    for i in range(cw * ch):
        if solid[i]:
            region[i] = 0
        elif not region[i]:
            region[i] = COMMONS_ID  #  the commons: everything else you can stand on

    #  THE ROOMS ARE SETTLED. Only now can the furniture be sunk, because which
    #  pieces move depends on the room each of them stands in -- and the rooms
    #  themselves must never move because a table did.
    slug_of = {rid: slug for rid, (slug, *_r) in enumerate(ROOMS, start=1)}
    slug_of[COMMONS_ID] = 'commons'
    blocks, moved = sink_furniture(walls, structure, furniture, region,
                                   lambda r: slug_of.get(r), cw, ch)
    collision = bytearray(1 if (blocks[i] or not inside[i]) else 0 for i in range(cw * ch))
    print(f'{len(moved)} of {len(furniture)} pieces lose {SINK * CELL}px off the top of their collision:')
    for room, wide, tall, x, y, freed in sorted(moved):
        print(f'  {room:8} {wide:4}x{tall:<4} at {x},{y}  ({freed} cells freed)')
    #  The spawn is the floor below the couch, so it moves when the couch does.
    if collision[start]:
        start = min((i for i in range(cw * ch) if not collision[i]),
                    key=lambda i: (i % cw - start % cw) ** 2 + (i // cw - start // cw) ** 2)
        spawn = ((start % cw) * CELL + CELL // 2, (start // cw) * CELL + CELL // 2)
        print(f'spawn moved to {spawn[0]},{spawn[1]}: what it was standing on blocks it now')

    #  EVERY ROOM MUST BE ONE PIECE OF FLOOR. A table that blocks the only way
    #  past it splits a room in two: you walk in at the door and cannot reach
    #  the rest of it. That is invisible in a picture of the map and obvious to
    #  anybody walking around in it, so it is checked here.
    pockets = []
    for rid, (slug, name, *_r) in enumerate(ROOMS, start=1):
        floor = [i for i in range(cw * ch) if region[i] == rid and not collision[i]]
        if not floor:
            continue
        rest = set(floor)
        parts = []
        while rest:
            seed = next(iter(rest))
            q, part = deque([seed]), []
            rest.discard(seed)
            while q:
                i = q.popleft()
                part.append(i)
                x, y = i % cw, i // cw
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < cw and 0 <= ny < ch):
                        continue
                    j = ny * cw + nx
                    if j in rest:
                        rest.discard(j)
                        q.append(j)
            parts.append(part)
        if len(parts) > 1:
            parts.sort(key=len, reverse=True)
            for part in parts[1:]:
                x, y = (part[0] % cw) * CELL, (part[0] // cw) * CELL
                pockets.append((name, len(part), x, y))
    if pockets:
        print('CUT OFF -- these parts of a room cannot be walked to from the rest of it:')
        for name, n, x, y in pockets:
            print(f'  {name}: {n} cells around {x},{y}')

    counts = {}
    for r in region:
        if r:
            counts[r] = counts.get(r, 0) + 1
    bounds = {}
    for i, r in enumerate(region):
        if not r:
            continue
        x, y = (i % cw) * CELL, (i // cw) * CELL
        b = bounds.get(r)
        bounds[r] = (min(b[0], x), min(b[1], y), max(b[2], x + CELL), max(b[3], y + CELL)) if b else (x, y, x + CELL, y + CELL)

    def pack(bits):
        out = bytearray((len(bits) + 7) // 8)
        for i, b in enumerate(bits):
            if b:
                out[i >> 3] |= 1 << (i & 7)
        return base64.b64encode(bytes(out)).decode()

    #  Rooms are long runs of the same id; as runs they cost a couple of
    #  kilobytes instead of a cell each.
    runs = []
    for r in region:
        if runs and runs[-1][0] == r and runs[-1][1] < 65535:
            runs[-1][1] += 1
        else:
            runs.append([r, 1])
    rooms = [dict(id=rid, slug=slug, name=name, cells=counts.get(rid, 0), bounds=bounds.get(rid))
             for rid, (slug, name, *_rest) in enumerate(ROOMS, start=1)]
    data = dict(width=w, height=h, cell=CELL, cols=cw, rows=ch, spawn=list(spawn),
                commons=counts.get(99, 0), rooms=rooms,
                solid=pack(collision), runs=[n for run in runs for n in run])

    (ROOT / 'public/map').mkdir(parents=True, exist_ok=True)
    shutil.copy2(pic, ROOT / 'public/map/world.jpg')
    #  What is drawn OVER people is the PAINTING, cut out through the obscure
    #  layer -- that layer is a marker, not artwork, so drawing it directly puts
    #  bright bars across every doorway.
    flat = SRC / 'picture.png'
    if not flat.exists() or flat.stat().st_mtime < pic.stat().st_mtime:
        subprocess.run(['sips', '-s', 'format', 'png', str(pic), '--out', str(flat)],
                       check=True, capture_output=True)
    pw, ph, ppx = read_png(str(flat))
    ow, oh, opx = read_png(str(obscure))
    assert (pw, ph) == (ow, oh) == (w, h)
    cut = bytearray(w * h * 4)
    kept = 0
    for i in range(w * h):
        if opx[i * 4 + 3] > 32:
            cut[i * 4:i * 4 + 3] = ppx[i * 4:i * 4 + 3]
            cut[i * 4 + 3] = 255
            kept += 1
    write_png(str(ROOT / 'public/map/over.png'), w, h, bytes(cut))
    print(f'over layer: {kept} pixels of the painting are drawn over people')
    out = ROOT / 'src/world/map-data.js'
    out.write_text('/* Generated by tools/build_map.py from map/source. Do not edit by hand.\n'
                   ' * The painted map, its walls, what is drawn over people, and the rooms. */\n'
                   'export default ' + json.dumps(data, separators=(',', ':')) + ';\n')
    walkable = sum(1 for s in collision if not s)
    print(f'{w}x{h} map, {cw}x{ch} cells of {CELL}px')
    print(f'walkable {walkable} cells ({100 * walkable // (cw * ch)}%), commons {counts.get(99, 0)}')
    for r in rooms:
        print(f"  {r['name']:16}{r['cells']:5} cells")
    print(f'wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} kB), public/map/world.jpg, public/map/over.png')


if __name__ == '__main__':
    main()
