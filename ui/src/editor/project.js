/* THE PROJECT BEING EDITED (2026-11-05): a world document (world/world-doc)
 * and the small rules the editor keeps while changing it -- fresh ids and
 * wire numbers, a map's scale from the size of a character on it, the assets
 * table, and undo. */
import { SCHEMA, LIMITS } from '../world/world-doc.js';

/* Which list of a map each drawing layer is. */
export const LAYERS = {
  walls: { field: 'walk', label: 'Walls', hint: 'Where people cannot walk' },
  front: { field: 'front', label: 'Foreground', hint: 'Painting drawn in front of people' },
  areas: { field: 'zones', label: 'Areas', hint: 'Rooms: their chat, call and note' },
  items: { field: 'items', label: 'Items', hint: 'Things to click: links, apps, videos, portals' },
  arrivals: { field: 'arrivals', label: 'Arrivals', hint: 'Where people appear' },
};

export const slug = (name, fallback = 'thing') =>
  String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
export function freshId(base, taken) {
  const root = slug(base);
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}
export const idsOf = (doc, kind) => new Set(doc.maps.flatMap((m) => (m[kind] ?? []).map((x) => x.id)));
export const mapIds = (doc) => new Set(doc.maps.map((m) => m.id));

/* A new area's number on the wire: from 16 up -- 1-15 are the official map's
 * rooms, 13 Rumors -- never 900, Vatican City's, and never one in use. */
export function nextAreaNum(doc) {
  const used = new Set(doc.maps.flatMap((m) => m.areas.map((a) => a.num)));
  for (let n = 16; n < 1000; n++) if (n !== 900 && !used.has(n)) return n;
  return null;
}
export function nextMapNum(doc) {
  const used = new Set(doc.maps.map((m) => m.num));
  for (let n = 0; n < 64; n++) if (!used.has(n)) return n;
  return null;
}

/* A MAP'S SCALE, from how tall a character stands on it in the map's own
 * pixels. The official main map is 48 (a 12-pixel body drawn four times):
 * a step of 32 pixels, walls tested 24 above the feet, cells of 8. Everything
 * is in proportion, so a person walks the same number of their own heights
 * a second on any map. */
export const BODY = 12;
export function scaleFor(height) {
  const scale = Math.max(0.25, Math.min(16, height / BODY));
  return {
    unit: Math.max(1, Math.round(8 * scale)),
    grid: Math.max(LIMITS.grid[0], Math.min(LIMITS.grid[1], Math.round(2 * scale))),
    character: { scale: +scale.toFixed(3), speed: 4.4, label: Math.max(5, Math.min(24, Math.round(9 * scale / 4))), probe: Math.round(6 * scale) },
  };
}
export const characterHeight = (map) => Math.round(map.character.scale * BODY);
/* The finest grid a map of this size may have (world/world-doc LIMITS.cells). */
export const coarsest = (size) => Math.ceil(Math.sqrt(size[0] * size[1] / LIMITS.cells));

/* A new map, on an imported painting or none -- in space (2026-11-08):
 * nothing drawn yet, and somewhere to arrive in the middle of it. */
export const SPACE_SIZE = [2400, 1600];
export function newMap(doc, { name, size = SPACE_SIZE, image = null, source = null, height = 48 }) {
  const num = nextMapNum(doc);
  const id = freshId(name || `map-${num + 1}`, mapIds(doc));
  const s = scaleFor(height);
  s.grid = Math.max(s.grid, coarsest(size));
  const spawn = freshId(`${id}-arrival`, idsOf(doc, 'arrivals'));
  return {
    id, num, name: name || `Map ${num + 1}`, size: [...size], ...(image ? { image } : {}), ...(source ? { source } : {}),
    ...s, shiftY: 0, walk: [], front: [], areas: [], zones: [],
    arrivals: [{ id: spawn, name: 'Arrival', x: Math.round(size[0] / 2), y: Math.round(size[1] / 2), dir: 'down' }],
    spawn, items: [],
  };
}

export function emptyWorld(name = 'Glurff') {
  return { schema: SCHEMA, world: { name, entry: null }, maps: [], assets: {} };
}

/* Every image the document uses, in its assets table and nothing else:
 * `known` is hash -> {mime, size, w, h}, from uploads and earlier tables. */
export function withAssets(doc, known) {
  const used = new Set();
  for (const m of doc.maps) {
    used.add(m.image?.src); if (m.over) used.add(m.over.src);
    /* A map's painting (2026-11-08): its tiles. */
    for (const t of m.paint?.tiles ?? []) used.add(t.src);
    for (const it of m.items ?? []) { if (it.image) used.add(it.image.src); if (it.do?.picture) used.add(it.do.picture.src); }
    /* An area's sound (2026-11-08). */
    for (const a of m.areas ?? []) if (a.sound) used.add(a.sound.src);
  }
  const assets = {};
  for (const h of used) {
    const a = known.get(h) ?? doc.assets?.[h];
    if (h && a) assets[h] = { mime: a.mime, size: a.size, ...(a.w ? { w: a.w, h: a.h } : {}) };
  }
  return { ...doc, assets };
}

export const allArrivals = (doc) => doc.maps.flatMap((m) => m.arrivals.map((a) => ({ ...a, map: m.id, mapName: m.name })));
export const findMap = (doc, id) => doc.maps.find((m) => m.id === id) ?? null;

/* ------------------------------------------------------------ geometry */

/* An operation moved by (dx, dy), or scaled by (sx, sy) about the origin. */
export function moveOp(op, dx, dy) {
  if (op.t === 'group') return { ...op, p: op.p.map((o) => moveOp(o, dx, dy)) };
  const o = { ...op };
  if ('x' in o) { o.x += dx; o.y += dy; }
  if (o.p) o.p = o.p.map((v, i) => v + (i % 2 ? dy : dx));
  return o;
}
export function scaleOp(op, sx, sy) {
  if (op.t === 'group') { const p = op.p.map((o) => scaleOp(o, sx, sy)); return p.includes(null) ? null : { ...op, p }; }
  const o = { ...op };
  switch (o.t) {
    case 'rect': return { ...o, x: o.x * sx, y: o.y * sy, w: o.w * sx, h: o.h * sy };
    case 'ellipse': return { ...o, x: o.x * sx, y: o.y * sy, rx: o.rx * sx, ry: o.ry * sy };
    case 'poly': return { ...o, p: o.p.map((v, i) => v * (i % 2 ? sy : sx)) };
    case 'line': return { ...o, p: o.p.map((v, i) => v * (i % 2 ? sy : sx)), r: o.r * Math.sqrt(sx * sy) };
    default: {
      /* A bitmap scales only by a whole number of its cells. */
      const cell = o.cell * sx;
      if (sx !== sy || !Number.isInteger(cell) || cell < 1) return null;
      return { ...o, x: o.x * sx, y: o.y * sy, cell };
    }
  }
}
/* Whole pixels, a tenth of one for points: what the document keeps. */
export function tidyOp(op) {
  if (op.t === 'group') return { ...op, p: op.p.map(tidyOp) };
  const r = (v) => Math.round(v * 10) / 10;
  const o = { ...op };
  for (const k of ['x', 'y', 'w', 'h', 'rx', 'ry', 'r']) if (typeof o[k] === 'number' && o.t !== 'bits' && o.t !== 'runs') o[k] = r(o[k]);
  if (o.p) o.p = o.p.map(r);
  return o;
}

/* ------------------------------------------------------------- history */

export class History {
  constructor(limit = 120) { this.past = []; this.future = []; this.limit = limit; }
  record(doc) {
    this.past.push(JSON.stringify(doc));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(doc) { if (!this.past.length) return null; this.future.push(JSON.stringify(doc)); return JSON.parse(this.past.pop()); }
  redo(doc) { if (!this.future.length) return null; this.past.push(JSON.stringify(doc)); return JSON.parse(this.future.pop()); }
}
