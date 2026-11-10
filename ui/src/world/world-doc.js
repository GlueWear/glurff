/* THE WORLD AS DATA (2026-11-05).
 *
 * A Glurff is a document its host publishes, plus the images it names. This
 * module is what the document means: its shape, how its drawn layers become
 * the grids the game walks on, and everything that must be true of it before
 * visitors are given it. The editor, the runtime and the import tools all use
 * it; the host's agent checks the same rules again (lib/glurff-world.hoon) --
 * the browser's word is never the last one.
 *
 * Coordinates are the MAP's pixels: the background image as the owner
 * imported it, whatever smaller copy a visitor is sent. Every drawn layer is
 * a list of operations applied in order over a grid of square cells, `grid`
 * map pixels on a side; a cell takes the value of the LAST operation that
 * covers its centre. The game asks about the cell under a point, so a wall
 * drawn to a pixel and the grid it lands on never disagree.
 *
 * The full description, with an example: implementation/map-editor/SCHEMA.md.
 */

import { imageShape } from './turned.js';

export const SCHEMA = 1;
export const LIMITS = {
  maps: 10, areas: 64, items: 256, arrivals: 64, ops: 4000, points: 20000,
  side: 16384, grid: [1, 64], cells: 4_194_304, name: 64, text: 4000, links: 24,
};
/* Numbers on the wire: an area's place and a map's scene. Places at 1000 and
 * up are proximity huddles; 0 is the open floor outside every area. */
export const AREA_NUM = [1, 998];
/* The floor outside every area: quiet -- no chat, no calls. 999 on the wire,
 * so no area has it. A map's MAIN AREA, the world's own note, is the open
 * floor of old: place 0 (2026-11-06). */
export const QUIET = 999;
export const MAIN = 0;
export const MAP_NUM = [0, 63];

export const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const HEX = /^[0-9a-f]{64}$/;
export const NOTE = /^[a-z0-9][a-z0-9~.-]{0,95}$/;
export const SHIP = /^~[a-z]{3}(-?[a-z]{3}){0,7}$/;
export const DESK = /^[a-z][a-z0-9-]{0,63}$/;
export const FACING = ['up', 'down', 'left', 'right'];
export const TRIGGERS = ['click', 'walk', 'phrase'];
export const MODES = ['room', 'note', 'quiet', 'world'];
export const CALLS = ['room', 'huddle', 'none'];
export const TRAITS = ['rumors', 'unlock', 'dice'];
export const KINDS = ['web', 'app', 'artifact', 'video', 'portal', 'travel', 'text', 'links', 'none', 'npc', 'collect'];
/* What a character's choices can do (2026-11-08): what an item that is
 * tapped can, but be another character or a collectible. */
export const NPC_DOES = ['web', 'app', 'portal', 'travel', 'text', 'links'];
export const NPC_MAX = { lines: 8, line: 140, talk: 1000, choices: 4, label: 40, look: 2000 };
export const COLLECT_TEXT = 500;
/* AREA SOUND (2026-11-08): a loop a browser plays, never runs -- and small,
 * since visitors fetch it from the host's ship. */
export const AUDIO_MIMES = ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/webm'];
export const SOUND_MAX = 2 * 1024 * 1024;
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
/* A MAP'S PAINTING (2026-11-08): a picture `w` x `h` laid over the map from
 * its top left corner to `size` (map pixels), drawn over the map image and
 * under everything else. Kept as PNG tiles PAINT_TILE pixels square, where
 * something is painted: `tiles` [{c, r, src}], c and r counted in tiles. At
 * most PAINT_MAX a side, so a big map's painting is coarser than the map. */
export const PAINT_TILE = 512;
export const PAINT_MAX = 4096;
export const paintDims = (size) => {
  const k = Math.min(1, PAINT_MAX / Math.max(size[0], size[1]));
  return { w: Math.max(1, Math.round(size[0] * k)), h: Math.max(1, Math.round(size[1] * k)) };
};
/* A SIGN ON THE MAP (2026-11-08): its words' height in map pixels, a part of
 * how tall people are there (12 of a character's art pixels), so a sign reads
 * the same against a person on any map. */
export const SIGN_SIZES = { small: 0.2, medium: 0.3, large: 0.5 };
export const signFontSize = (map, size) => Math.max(4, Math.round((map?.character?.scale ?? 4) * 12 * (SIGN_SIZES[size] ?? SIGN_SIZES.medium)));
const COLOUR = /^#[0-9a-f]{6}$/i;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v) => Number.isInteger(v);
const str = (v, max = LIMITS.name) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/* ------------------------------------------------------------ operations
 *
 *   {t:'rect',    x, y, w, h}          corner and size
 *   {t:'ellipse', x, y, rx, ry}        centre and radii
 *   {t:'poly',    p:[x0,y0, x1,y1, ...]}  closed polygon
 *   {t:'line',    p:[...], r}          a stroke of radius r along a polyline:
 *                                      walls, brushes and erasers
 *   {t:'bits',    x, y, cell, cols, rows, data}   a bitmap, base64, row
 *                                      major, lowest bit first; only set bits
 *                                      apply
 *   {t:'runs',    x, y, cell, cols, r:[start, length, ...]}  marked cells
 *
 * Each carries what it sets: `v` (1 or 0, default 1) on the walls and the
 * foreground, `a` (an area's id, or null to clear) on the areas layer. */

const b64 = (s) => {
  if (typeof atob === 'function') {
    const raw = atob(s); const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
};
const bitsOf = new WeakMap();
const bytes = (op) => { let b = bitsOf.get(op); if (!b) { b = b64(op.data); bitsOf.set(op, b); } return b; };
const runsOf = new WeakMap();
const runSet = (op) => {
  let s = runsOf.get(op);
  if (!s) { s = new Set(); for (let i = 0; i + 1 < op.r.length; i += 2) for (let k = 0; k < op.r[i + 1]; k++) s.add(op.r[i] + k); runsOf.set(op, s); }
  return s;
};

const segDist2 = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
};

/* Does an operation cover the point? */
export function covers(op, x, y) {
  switch (op.t) {
    case 'rect': return x >= op.x && y >= op.y && x < op.x + op.w && y < op.y + op.h;
    case 'ellipse': {
      if (op.rx <= 0 || op.ry <= 0) return false;
      const dx = (x - op.x) / op.rx, dy = (y - op.y) / op.ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'poly': {
      const p = op.p; let inside = false;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 'line': {
      const p = op.p, r2 = op.r * op.r;
      if (p.length === 2) return (x - p[0]) ** 2 + (y - p[1]) ** 2 <= r2;
      for (let i = 0; i + 3 < p.length; i += 2) if (segDist2(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r2) return true;
      return false;
    }
    case 'bits': {
      const cx = Math.floor((x - op.x) / op.cell), cy = Math.floor((y - op.y) / op.cell);
      if (cx < 0 || cy < 0 || cx >= op.cols || cy >= op.rows) return false;
      const i = cy * op.cols + cx;
      return (bytes(op)[i >> 3] & (1 << (i & 7))) !== 0;
    }
    case 'runs': {
      const cx = Math.floor((x - op.x) / op.cell), cy = Math.floor((y - op.y) / op.cell);
      if (cx < 0 || cy < 0 || cx >= op.cols) return false;
      return runSet(op).has(cy * op.cols + cx);
    }
    /* Several shapes as one -- an item or a door drawn in parts. */
    case 'group': return op.p.some((o) => covers(o, x, y));
    default: return false;
  }
}

/* The map pixels an operation can touch, as [x0, y0, x1, y1]. */
export function bounds(op) {
  switch (op.t) {
    case 'rect': return [op.x, op.y, op.x + op.w, op.y + op.h];
    case 'ellipse': return [op.x - op.rx, op.y - op.ry, op.x + op.rx, op.y + op.ry];
    case 'poly': case 'line': {
      const pad = op.t === 'line' ? op.r : 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < op.p.length; i += 2) {
        x0 = Math.min(x0, op.p[i]); x1 = Math.max(x1, op.p[i]);
        y0 = Math.min(y0, op.p[i + 1]); y1 = Math.max(y1, op.p[i + 1]);
      }
      return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    }
    case 'bits': return [op.x, op.y, op.x + op.cols * op.cell, op.y + op.rows * op.cell];
    case 'group': {
      const bs = op.p.map(bounds);
      return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
    }
    case 'runs': {
      let last = 0;
      for (let i = 0; i + 1 < op.r.length; i += 2) last = Math.max(last, op.r[i] + op.r[i + 1]);
      return [op.x, op.y, op.x + op.cols * op.cell, op.y + Math.ceil(last / op.cols) * op.cell];
    }
    default: return [0, 0, 0, 0];
  }
}

/* A layer as a grid: one byte per cell, cols x rows, each cell `grid` map
 * pixels, judged at its centre. `value(op)` is what an operation sets there
 * (an area's number on the areas layer). Only the cells under an
 * operation's bounds are visited, so a big map with a few shapes is cheap,
 * and a bitmap drawn on the map's own grid is copied, not sampled. */
export function rasterize(ops, cols, rows, grid, value = (op) => (op.v ?? 1), base = 0, Out = Uint8Array) {
  const out = new Out(cols * rows);
  if (base) out.fill(base);
  for (const op of ops ?? []) {
    const v = value(op);
    if ((op.t === 'bits' || op.t === 'runs') && op.cell === grid && op.x % grid === 0 && op.y % grid === 0) {
      const ox = op.x / grid, oy = op.y / grid;
      const put = (i) => {
        const cx = (i % op.cols) + ox, cy = Math.floor(i / op.cols) + oy;
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) out[cy * cols + cx] = v;
      };
      if (op.t === 'runs') { for (let i = 0; i + 1 < op.r.length; i += 2) for (let k = 0; k < op.r[i + 1]; k++) put(op.r[i] + k); }
      else { const b = bytes(op), n = op.cols * op.rows; for (let i = 0; i < n; i++) if (b[i >> 3] & (1 << (i & 7))) put(i); }
      continue;
    }
    const [x0, y0, x1, y1] = bounds(op);
    const c0 = Math.max(0, Math.floor(x0 / grid)), c1 = Math.min(cols - 1, Math.floor(x1 / grid));
    const r0 = Math.max(0, Math.floor(y0 / grid)), r1 = Math.min(rows - 1, Math.floor(y1 / grid));
    for (let cy = r0; cy <= r1; cy++) {
      const py = cy * grid + grid / 2;
      for (let cx = c0; cx <= c1; cx++) if (covers(op, cx * grid + grid / 2, py)) out[cy * cols + cx] = v;
    }
  }
  return out;
}

/* One cell's value, without a grid: what the host's agent does to check a
 * point (an arrival) and what `rasterize` gives for the cell under it. */
export function sample(ops, x, y, grid, value = (op) => (op.v ?? 1), base = 0) {
  const cx = Math.floor(x / grid), cy = Math.floor(y / grid);
  const px = cx * grid + grid / 2, py = cy * grid + grid / 2;
  let out = base;
  for (const op of ops ?? []) if (covers(op, px, py)) out = value(op);
  return out;
}

/* A map's grid size in cells. */
export const gridOf = (map) => ({ cols: Math.ceil(map.size[0] / map.grid), rows: Math.ceil(map.size[1] / map.grid) });

/* Where somebody standing at (x, y) is tested against the walls: `probe`
 * pixels above the feet, and the boundary moved by `shiftY`. */
export const probeY = (map, y) => y - (map.character?.probe ?? 0) - (map.shiftY ?? 0);

/* A map's walls: what is drawn on its walls layer, then the box of every
 * placed image that blocks, which goes wherever the image is moved -- turned
 * with it, when it is turned (world/turned, 2026-11-10). */
export function wallsOf(map) {
  const blocks = (map.items ?? []).filter((it) => it?.image?.blocks === true && Array.isArray(it.image.at))
    .map((it) => imageShape(it.image));
  return blocks.length ? [...(map.walk ?? []), ...blocks] : map.walk ?? [];
}

/* Can somebody stand here? Inside the map and not on a wall. */
export function walkable(map, x, y) {
  const py = probeY(map, y);
  if (x < 0 || py < 0 || x >= map.size[0] || py >= map.size[1]) return false;
  return sample(wallsOf(map), x, py, map.grid) === 0;
}

/* ------------------------------------------------------------ the checks */

/* Everything wrong with a document, as sentences the editor can show, or []
 * if visitors may be given it. `held` is the host's store, hash -> {mime,
 * size}, when it is known: then every asset must be there and match.
 * `loading`: a published world being loaded, which may have been published
 * under older rules. */
export function validate(doc, held = null, { loading = false } = {}) {
  const errors = [];
  const bad = (where, what) => errors.push(where ? `${where}: ${what}` : what);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['the document is not an object'];
  if (doc.schema !== SCHEMA) return [`unsupported schema ${JSON.stringify(doc.schema)}`];

  /* The assets table: every image the document uses, once. */
  const assets = doc.assets && typeof doc.assets === 'object' && !Array.isArray(doc.assets) ? doc.assets : null;
  if (!assets) bad('', 'the document has no assets table');
  const used = new Set();
  for (const [h, a] of Object.entries(assets ?? {})) {
    if (!HEX.test(h)) { bad('assets', `not an asset id: ${h}`); continue; }
    if (!a || typeof a.mime !== 'string' || !int(a.size) || a.size < 1) { bad(`assets.${h.slice(0, 8)}`, 'needs a mime and a size'); continue; }
    if (held) {
      const have = held[h];
      if (!have) bad(`assets.${h.slice(0, 8)}`, 'is not held by the host');
      else if (have.mime !== a.mime || have.size !== a.size) bad(`assets.${h.slice(0, 8)}`, 'does not match what the host holds');
    }
  }
  const image = (where, img) => {
    if (!img || typeof img !== 'object') return bad(where, 'is not an image');
    if (!HEX.test(img.src ?? '')) return bad(where, 'names no asset');
    const a = assets?.[img.src];
    if (!a) return bad(where, 'uses an image missing from the assets table');
    if (!IMAGE_MIMES.includes(a.mime)) bad(where, `is ${a.mime}, not an image`);
    if (!int(img.w) || !int(img.h) || img.w < 1 || img.h < 1 || img.w > LIMITS.side || img.h > LIMITS.side) bad(where, 'needs its pixel size');
    else if ((int(a.w) && a.w !== img.w) || (int(a.h) && a.h !== img.h)) bad(where, 'size differs from the asset');
    used.add(img.src);
  };
  /* A map's painting: its size, and tiles inside it, each a PNG tile once. */
  const painting = (where, p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return bad(where, 'is not a painting');
    if (!int(p.w) || !int(p.h) || p.w < 1 || p.h < 1 || p.w > PAINT_MAX || p.h > PAINT_MAX) return bad(where, `needs its pixel size, at most ${PAINT_MAX} a side`);
    if (!Array.isArray(p.size) || p.size.length !== 2 || !p.size.every((n) => int(n) && n >= 1 && n <= LIMITS.side)) bad(where, 'needs the size it covers');
    if (!Array.isArray(p.tiles)) return bad(where, 'needs its tiles');
    const cols = Math.ceil(p.w / PAINT_TILE), rows = Math.ceil(p.h / PAINT_TILE), seen = new Set();
    for (const t of p.tiles) {
      if (!t || !int(t.c) || !int(t.r) || t.c < 0 || t.r < 0 || t.c >= cols || t.r >= rows) { bad(where, 'has a tile outside it'); continue; }
      if (seen.has(`${t.c},${t.r}`)) { bad(where, 'repeats a tile'); continue; }
      seen.add(`${t.c},${t.r}`);
      const a = HEX.test(t.src ?? '') ? assets?.[t.src] : null;
      if (!a) { bad(where, 'has a tile missing from the assets table'); continue; }
      used.add(t.src);
      if (a.mime !== 'image/png') bad(where, 'has a tile that is not a PNG');
      else if ((int(a.w) && a.w !== PAINT_TILE) || (int(a.h) && a.h !== PAINT_TILE)) bad(where, `has a tile that is not ${PAINT_TILE} pixels square`);
    }
  };
  /* An area's sound: a held audio asset, small, at a volume. */
  const sound = (where, snd) => {
    if (!snd || typeof snd !== 'object' || Array.isArray(snd)) return bad(where, 'is not a sound');
    if (!HEX.test(snd.src ?? '')) return bad(where, 'names no asset');
    const a = assets?.[snd.src];
    if (!a) return bad(where, 'uses a sound missing from the assets table');
    if (!AUDIO_MIMES.includes(a.mime)) bad(where, `is ${a.mime}, not a sound`);
    else if (a.size > SOUND_MAX) bad(where, `is bigger than ${SOUND_MAX / 1048576} MB`);
    if (snd.volume != null && (!num(snd.volume) || snd.volume < 0 || snd.volume > 1)) bad(where, 'its volume is 0 to 1');
    used.add(snd.src);
  };

  const world = doc.world ?? {};
  if (!str(world.name)) bad('world', 'needs a name');

  const maps = Array.isArray(doc.maps) ? doc.maps : [];
  if (!maps.length) bad('', 'a world needs a map');
  if (maps.length > LIMITS.maps) bad('', `a world has at most ${LIMITS.maps} maps`);

  /* Ids are unique across the whole world, kind by kind, so a reference never
   * needs a map to go with it, and numbers on the wire never collide. */
  const mapIds = new Set(), mapNums = new Set(), areaIds = new Map(), areaNums = new Set(),
        itemIds = new Set(), arrivals = new Map();
  const portals = [];
  let mains = 0;

  maps.forEach((m, mi) => {
    const at = `map ${m?.id ?? mi}`;
    if (!m || typeof m !== 'object') return bad(at, 'is not an object');
    if (!ID.test(m.id ?? '')) bad(at, 'needs an id of lowercase letters, digits and dashes');
    else if (mapIds.has(m.id)) bad(at, 'repeats an id'); else mapIds.add(m.id);
    if (!int(m.num) || m.num < MAP_NUM[0] || m.num > MAP_NUM[1]) bad(at, 'needs a number 0-63');
    else if (mapNums.has(m.num)) bad(at, 'repeats a number'); else mapNums.add(m.num);
    if (!str(m.name)) bad(at, 'needs a name');
    const size = Array.isArray(m.size) && m.size.length === 2 && m.size.every((n) => int(n) && n >= 1 && n <= LIMITS.side) ? m.size : null;
    if (!size) return bad(at, `needs a size of whole pixels, at most ${LIMITS.side} a side`);
    /* No background picture: a map in space (2026-11-08), its edge a faint
     * line, with whatever is placed and drawn on it. */
    if (m.image != null) image(`${at} background`, m.image);
    if (m.over != null) image(`${at} foreground image`, m.over);
    if (m.paint != null) painting(`${at} painting`, m.paint);
    if (!int(m.unit) || m.unit < 1 || m.unit > 1024) bad(at, 'needs a unit: pixels per step');
    if (!int(m.grid) || m.grid < LIMITS.grid[0] || m.grid > LIMITS.grid[1]) bad(at, `needs a grid of ${LIMITS.grid[0]}-${LIMITS.grid[1]} pixels`);
    else if (Math.ceil(size[0] / m.grid) * Math.ceil(size[1] / m.grid) > LIMITS.cells) bad(at, 'grid is too fine for the map: make its cells bigger');
    const c = m.character ?? {};
    if (!num(c.scale) || c.scale <= 0 || c.scale > 16) bad(`${at} character`, 'needs a scale');
    if (!num(c.speed) || c.speed <= 0 || c.speed > 40) bad(`${at} character`, 'needs a speed');
    if (!num(c.label) || c.label < 2 || c.label > 48) bad(`${at} character`, 'needs a name size');
    if (!int(c.probe) || Math.abs(c.probe) > 1024) bad(`${at} character`, 'needs a probe height');
    if (m.shiftY != null && (!int(m.shiftY) || Math.abs(m.shiftY) > 1024)) bad(at, 'shiftY must be whole pixels');

    const layer = (name, ops, check) => {
      if (ops == null) return;
      if (!Array.isArray(ops)) return bad(`${at} ${name}`, 'is not a list');
      if (ops.length > LIMITS.ops) bad(`${at} ${name}`, `has more than ${LIMITS.ops} shapes`);
      ops.forEach((op, i) => { const e = opError(op); if (e) bad(`${at} ${name} #${i + 1}`, e); else check?.(op, i); });
    };
    layer('walls', m.walk, (op, i) => { if (op.v != null && op.v !== 0 && op.v !== 1) bad(`${at} walls #${i + 1}`, 'v must be 0 or 1'); });
    layer('foreground', m.front, (op, i) => { if (op.v != null && op.v !== 0 && op.v !== 1) bad(`${at} foreground #${i + 1}`, 'v must be 0 or 1'); });

    const areas = Array.isArray(m.areas) ? m.areas : [];
    if (areas.length > LIMITS.areas) bad(at, `has more than ${LIMITS.areas} areas`);
    const here = new Set();
    areas.forEach((a, ai) => {
      const where = `area ${a?.id ?? ai}`;
      if (!ID.test(a?.id ?? '')) return bad(where, 'needs an id');
      if (areaIds.has(a.id)) bad(where, 'repeats an id'); else { areaIds.set(a.id, { area: a, map: m }); here.add(a.id); }
      if (a.mode === 'world') {
        if (a.num !== MAIN) bad(where, 'is the world\'s chat, number 0');
        mains++;
      } else if (!int(a.num) || a.num < AREA_NUM[0] || a.num > AREA_NUM[1]) bad(where, 'needs a number 1-998');
      else if (areaNums.has(a.num)) bad(where, 'repeats a number'); else areaNums.add(a.num);
      if (!str(a.name)) bad(where, 'needs a name');
      if (!MODES.includes(a.mode)) bad(where, `mode must be ${MODES.join(', ')}`);
      if (a.mode === 'world') {
        if (a.note != null || a.lease) bad(where, 'is the world\'s own note: not another note, and never leased');
        if (!['huddle', 'none'].includes(a.call)) bad(where, 'the world\'s chat has proximity calls or none');
      } else if (a.mode === 'note') {
        if (!NOTE.test(a.note ?? '')) bad(where, 'is bound to a note but names none');
        if (a.lease) bad(where, 'is already a note, so it cannot also be leased');
        if (a.noteHost != null && !SHIP.test(a.noteHost)) bad(where, "its note's host must be a ship");
      } else {
        if (a.note != null) bad(where, 'names a note but is not bound to it');
        if (a.noteHost != null) bad(where, "names a note's host but is not bound to a note");
        if (!CALLS.includes(a.call)) bad(where, `call must be ${CALLS.join(', ')}`);
        if (a.mode === 'quiet' && a.call !== 'none') bad(where, 'is quiet, so it has no call');
      }
      if (a.lease != null && typeof a.lease !== 'boolean') bad(where, 'lease must be true or false');
      if (a.traits != null && (!Array.isArray(a.traits) || a.traits.some((t) => !TRAITS.includes(t)))) bad(where, `traits are ${TRAITS.join(', ')}`);
      if (a.sound != null) sound(`${where} sound`, a.sound);
    });
    layer('areas', m.zones, (op, i) => { if (op.a != null && !here.has(op.a)) bad(`${at} areas #${i + 1}`, `names no area of this map: ${op.a}`); });


    const arr = Array.isArray(m.arrivals) ? m.arrivals : [];
    if (arr.length > LIMITS.arrivals) bad(at, `has more than ${LIMITS.arrivals} arrival points`);
    arr.forEach((p, pi) => {
      const where = `arrival ${p?.id ?? pi}`;
      if (!ID.test(p?.id ?? '')) return bad(where, 'needs an id');
      if (arrivals.has(p.id)) bad(where, 'repeats an id'); else arrivals.set(p.id, { at: p, map: m });
      if (!num(p.x) || !num(p.y)) return bad(where, 'needs a position');
      if (p.dir != null && !FACING.includes(p.dir)) bad(where, `faces ${FACING.join(', ')}`);
      if (!walkable(m, p.x, p.y)) bad(where, 'is outside the map or inside a wall');
    });
    if (arr.length && !arr.some((p) => p?.id === m.spawn)) bad(at, 'its spawn is not one of its arrival points');

    const items = Array.isArray(m.items) ? m.items : [];
    if (items.length > LIMITS.items) bad(at, `has more than ${LIMITS.items} items`);
    items.forEach((it, ii) => {
      const where = `item ${it?.id ?? ii}`;
      if (!ID.test(it?.id ?? '')) return bad(where, 'needs an id');
      if (itemIds.has(it.id)) bad(where, 'repeats an id'); else itemIds.add(it.id);
      if (!str(it.name)) bad(where, 'needs a name');
      if (it.image != null) {
        image(`${where} image`, it.image);
        const p = it.image.at;
        if (!Array.isArray(p) || p.length !== 4 || !p.every(num) || p[2] <= 0 || p[3] <= 0) bad(`${where} image`, 'needs a place [x, y, w, h]');
        if (it.image.layer != null && !['back', 'front'].includes(it.image.layer)) bad(`${where} image`, 'layer is back or front');
        if (it.image.blocks != null && typeof it.image.blocks !== 'boolean') bad(`${where} image`, 'blocks is true or false');
        if (it.image.turn != null && !(typeof it.image.turn === 'number' && Number.isFinite(it.image.turn) && Math.abs(it.image.turn) <= 360)) bad(`${where} image`, 'turn is degrees, -360 to 360');
      }
      const trigger = it.do?.trigger ?? 'click';
      if (it.shape != null) { const e = opError(it.shape); if (e) bad(where, `shape: ${e}`); }
      else if (trigger !== 'phrase' && it.image == null) bad(where, 'needs a shape or an image to click');
      actionErrors(it.do, where, here, bad, image);
      if (it.do?.kind === 'portal') portals.push({ it, map: m, where });
    });
  });

  if (!ID.test(world.entry ?? '') || !arrivals.has(world.entry)) bad('world', 'its entry is not an arrival point');
  /* Published before areas could be the world's chat, a world still loads
   * (its open floor is its chat, `compile`); a new one needs one somewhere. */
  if (!loading && !mains) bad('world', 'needs an area that is the world\'s chat');
  for (const { it, where } of portals) {
    const to = arrivals.get(it.do.to);
    if (!to) bad(where, `leads to no arrival point: ${it.do.to}`);
  }
  if (assets) for (const h of Object.keys(assets)) if (HEX.test(h) && !used.has(h)) bad(`assets.${h.slice(0, 8)}`, 'is listed but nothing uses it');
  return errors;
}

/* What is wrong with one operation's shape, or null. */
export function opError(op) {
  if (!op || typeof op !== 'object') return 'is not a shape';
  const pts = (p) => Array.isArray(p) && p.length % 2 === 0 && p.length <= LIMITS.points && p.every(num);
  switch (op.t) {
    case 'rect': return [op.x, op.y, op.w, op.h].every(num) && op.w > 0 && op.h > 0 ? null : 'a rectangle needs x, y, w, h';
    case 'ellipse': return [op.x, op.y, op.rx, op.ry].every(num) && op.rx > 0 && op.ry > 0 ? null : 'an ellipse needs x, y, rx, ry';
    case 'poly': return pts(op.p) && op.p.length >= 6 ? null : 'a polygon needs three corners';
    case 'line': return pts(op.p) && op.p.length >= 2 && num(op.r) && op.r > 0 ? null : 'a stroke needs points and a radius';
    case 'bits': {
      if (![op.x, op.y].every(int) || !int(op.cell) || op.cell < 1 || !int(op.cols) || !int(op.rows) || op.cols < 1 || op.rows < 1) return 'a bitmap needs x, y, cell, cols, rows';
      if (typeof op.data !== 'string') return 'a bitmap needs its data';
      const want = Math.ceil(op.cols * op.rows / 8);
      return Math.floor(op.data.replace(/=+$/, '').length * 3 / 4) >= want ? null : 'a bitmap is shorter than its size';
    }
    case 'runs': return [op.x, op.y].every(int) && int(op.cell) && op.cell >= 1 && int(op.cols) && op.cols >= 1 &&
      Array.isArray(op.r) && op.r.length % 2 === 0 && op.r.length <= LIMITS.points && op.r.every((n) => int(n) && n >= 0) ? null : 'runs need x, y, cell, cols and pairs';
    case 'group': {
      if (!Array.isArray(op.p) || !op.p.length || op.p.length > 64) return 'a group needs 1-64 shapes';
      for (const o of op.p) { if (o?.t === 'group') return 'a group cannot hold a group'; const e = opError(o); if (e) return `a group's shape: ${e}`; }
      return null;
    }
    default: return `unknown shape ${JSON.stringify(op.t)}`;
  }
}

/* A character's look, as the character builder makes one (world/parts):
 * a few slots, each a part and a tint. */
const lookOk = (look) => !!look && typeof look === 'object' && !Array.isArray(look) &&
  JSON.stringify(look).length <= NPC_MAX.look &&
  Object.entries(look).every(([k, v]) => /^[a-z]{1,16}$/.test(k) && v && typeof v === 'object' &&
    (v.part == null || (typeof v.part === 'string' && v.part.length <= 64)) &&
    (v.tint == null || (typeof v.tint === 'string' && v.tint.length <= 16) || (Number.isInteger(v.tint) && v.tint >= 0 && v.tint <= 0xffffff)));

function actionErrors(act, where, areas, bad, image = () => {}) {
  if (!act || typeof act !== 'object') return bad(where, 'does nothing: give it a behaviour');
  if (!KINDS.includes(act.kind)) return bad(where, `unknown behaviour ${JSON.stringify(act.kind)}`);
  if (act.trigger != null && !TRIGGERS.includes(act.trigger)) bad(where, `is triggered by ${TRIGGERS.join(', ')}`);
  if (act.trigger === 'phrase' && act.kind !== 'portal') bad(where, 'only a portal can be spoken');
  switch (act.kind) {
    case 'web': if (typeof act.url !== 'string' || !/^https:\/\/[^\s]+$/.test(act.url) || act.url.length > 2000) bad(where, 'needs an https address'); break;
    case 'app':
      if (!DESK.test(act.desk ?? '')) bad(where, 'needs an app desk');
      if (act.publisher !== 'HOST' && !SHIP.test(act.publisher ?? '')) bad(where, 'needs the app\'s publisher');
      if (act.context != null && (typeof act.context !== 'object' || Object.keys(act.context).length > 8 ||
          Object.entries(act.context).some(([k, v]) => !/^[a-z][a-z0-9-]{0,31}$/i.test(k) || typeof v !== 'string' || v.length > 200))) bad(where, 'its app context is up to eight short strings');
      break;
    case 'artifact': if (!NOTE.test(act.note ?? '') || typeof act.artifact !== 'string' || !act.artifact || act.artifact.length > 200) bad(where, 'needs a note and an artifact'); break;
    /* A video: with a `screen`, it plays on the map there for the people in
     * `area`; without one, it is a player of your own, like the jukebox. */
    case 'video': {
      const s = act.screen;
      if (s != null && (![s.x, s.y, s.w, s.h].every(num) || s.w <= 0 || s.h <= 0)) bad(where, 'its screen needs x, y, w, h');
      if (s != null && act.area != null && !areas.has(act.area)) bad(where, 'a screen plays for an area of this map, or for everyone');
      if (s == null && act.area != null) bad(where, 'only a screen plays for an area');
      break;
    }
    case 'portal':
      if (!ID.test(act.to ?? '')) bad(where, 'needs an arrival point to lead to');
      if (act.trigger === 'phrase') {
        if (typeof act.phrase !== 'string' || !act.phrase.trim() || act.phrase.length > 80) bad(where, 'needs the phrase to say');
        if (!areas.has(act.area)) bad(where, 'a phrase is said in an area of this map');
      }
      if (act.oneWay != null && typeof act.oneWay !== 'boolean') bad(where, 'oneWay is true or false');
      break;
    case 'travel': if (!SHIP.test(act.host ?? '')) bad(where, 'needs the host ship of the other Glurff'); break;
    case 'text':
      /* A sign people can write on may start blank. */
      if (act.editable != null && typeof act.editable !== 'boolean') bad(where, 'editable is true or false');
      if (typeof act.text !== 'string' || (!act.editable && !act.text.trim()) || act.text.length > LIMITS.text) bad(where, `needs text, at most ${LIMITS.text} characters`);
      /* Made into a sign: its words show on the map (2026-11-08). */
      if (act.sign != null) {
        const s = act.sign;
        if (!s || typeof s !== 'object' || Array.isArray(s)) bad(where, 'its sign is how its words show on the map');
        else {
          if (s.size != null && !Object.hasOwn(SIGN_SIZES, s.size)) bad(where, `its sign's words are ${Object.keys(SIGN_SIZES).join(', ')}`);
          if (s.color != null && !COLOUR.test(s.color)) bad(where, "its sign's colour is #rrggbb");
          if (s.plaque != null && typeof s.plaque !== 'boolean') bad(where, "its sign's plaque is true or false");
        }
      }
      break;
    case 'links':
      if (!Array.isArray(act.links) || !act.links.length || act.links.length > LIMITS.links ||
          act.links.some((l) => !str(l?.title) || typeof l?.url !== 'string' || !/^https:\/\/[^\s]+$/.test(l.url))) bad(where, `needs up to ${LIMITS.links} titled https links`);
      break;
    /* A CHARACTER (2026-11-08): who it looks like, where it faces, whether
     * it wanders its area, what it says as people come near, and what it
     * says when tapped -- with a few choices, each something an item does. */
    case 'npc': {
      if (act.trigger != null) bad(where, 'a character is tapped');
      if (act.look != null && !lookOk(act.look)) bad(where, "its look is a character's look");
      if (act.dir != null && !FACING.includes(act.dir)) bad(where, `faces ${FACING.join(', ')}`);
      if (act.wander != null && typeof act.wander !== 'boolean') bad(where, 'wander is true or false');
      /* Where it walks (2026-11-08): a box on the map, map pixels. */
      if (act.roam != null && !(act.roam && typeof act.roam === 'object' && ['x', 'y', 'w', 'h'].every((k) => num(act.roam[k])) && act.roam.w > 0 && act.roam.h > 0))
        bad(where, 'walks around a box of x, y, w, h');
      if (act.lines != null && (!Array.isArray(act.lines) || act.lines.length > NPC_MAX.lines || act.lines.some((l) => !str(l, NPC_MAX.line))))
        bad(where, `says up to ${NPC_MAX.lines} lines of up to ${NPC_MAX.line} letters`);
      if (act.talk != null && (typeof act.talk !== 'string' || act.talk.length > NPC_MAX.talk)) bad(where, `says up to ${NPC_MAX.talk} letters when tapped`);
      if (act.choices != null) {
        if (!Array.isArray(act.choices) || act.choices.length > NPC_MAX.choices) bad(where, `has up to ${NPC_MAX.choices} choices`);
        else act.choices.forEach((c, i) => {
          const at = `${where} choice ${i + 1}`;
          if (!str(c?.label, NPC_MAX.label)) bad(at, `needs a label of up to ${NPC_MAX.label} letters`);
          if (!NPC_DOES.includes(c?.do?.kind)) return bad(at, `does ${NPC_DOES.join(', ')}`);
          if (c.do.trigger != null) bad(at, 'is tapped');
          actionErrors(c.do, at, areas, bad, image);
        });
      }
      break;
    }
    /* A COLLECTIBLE (2026-11-08): found by tapping it or walking into it,
     * once a person; a picture of it, or none -- a spot on the map. */
    case 'collect':
      if (act.text != null && (typeof act.text !== 'string' || act.text.length > COLLECT_TEXT)) bad(where, `says up to ${COLLECT_TEXT} letters when found`);
      if (act.near != null && typeof act.near !== 'boolean') bad(where, 'near is true or false');
      if (act.picture != null) image(`${where} picture`, act.picture);
      break;
    default: break;
  }
}

/* --------------------------------------------------------- compiled maps */

/* Whether any map of a world has an area that is the world's chat. A world
 * with none was published before there were such areas, and its open floor
 * is its chat, as it always was. */
export const worldChat = (doc) => (doc?.maps ?? []).some((m) => (m.areas ?? []).some((a) => a.mode === 'world'));

/* A map made ready to walk on: its grids built once. `walls` and `front` are
 * 0/1 per cell; `zones` is each cell's place: an area's number, MAIN (0) for
 * the main area, QUIET where there is no area at all. */
export function compile(map, worldChatSomewhere = (map.areas ?? []).some((a) => a.mode === 'world')) {
  const { cols, rows } = gridOf(map);
  const nums = new Map((map.areas ?? []).map((a) => [a.id, a.num]));
  /* A map published before maps had main areas keeps what its open floor
   * always was: the world's chat. */
  const open = worldChatSomewhere ? QUIET : MAIN;
  return {
    cols, rows,
    walls: rasterize(wallsOf(map), cols, rows, map.grid),
    front: map.front?.length ? rasterize(map.front, cols, rows, map.grid) : null,
    zones: rasterize(map.zones, cols, rows, map.grid, (op) => (op.a == null ? open : nums.get(op.a) ?? open), open, Uint16Array),
  };
}
