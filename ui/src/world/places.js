/* The world: ONE map.
 *
 * The rooms are built into the commons rather than being separate places
 * reached through portals. That means everyone is always in the same world, so
 * you can stand outside and watch people moving around inside a room, and
 * walking through a doorway "puts you in" a room without loading anything.
 *
 * A room is therefore a REGION -- a rectangle of the one map. Which room you
 * are in is a function of where you are standing, and that is what joins you to
 * its call.
 *
 * Art is Turf's pastoral set: grass, cobble, stone, fences, trees, tables,
 * stools, barrels. No office furniture and no screens exist in it, so identity
 * comes from layout and from PALETTE -- Pixi tints every sprite, so the same
 * stones read cold in one room and warm in another.
 */
import { TILE } from 'world/parts';

export const WORLD_W = 64;
export const WORLD_H = 46;
export const COMMONS = 0;

/* Rooms, laid out around an open middle. `door` is the gap in the wall, given
 * as a tile on the room's boundary. Interiors are deliberately compact: the
 * commons has to stay the biggest space in the world. */
export const ROOMS = [
  { id: 1, name: 'Board Room',      x: 2,  y: 2,  w: 13, h: 9,  floor: 'floor',       tint: 0xb9c4d8, door: [[8, 10], [9, 10]] },
  { id: 2, name: 'Meeting Room',    x: 17, y: 2,  w: 13, h: 9,  floor: 'floor',       tint: 0xd8cbb9, door: [[23, 10], [24, 10]] },
  { id: 3, name: 'Conference Room', x: 32, y: 2,  w: 16, h: 10, floor: 'floor',       tint: 0xc8ccd8, door: [[39, 11], [40, 11]] },
  { id: 4, name: 'Auditorium',      x: 50, y: 2,  w: 12, h: 12, floor: 'floor-stone', tint: 0xd6d2c4, door: [[55, 13], [56, 13]] },
  { id: 5, name: 'Rumors',          x: 2,  y: 15, w: 13, h: 9,  floor: 'floor-stone', tint: 0xc98a8a, door: [[14, 19], [14, 20]] },
  { id: 6, name: 'Movie Room',      x: 2,  y: 27, w: 15, h: 11, floor: 'floor',       tint: 0x8a90a8, door: [[16, 32], [16, 33]] },
  { id: 7, name: 'Game Room',       x: 48, y: 28, w: 14, h: 11, floor: 'cobble-red',  tint: 0xbfae86, door: [[48, 33], [48, 34]] },
];

export const roomById = (id) => ROOMS.find((r) => r.id === id) ?? null;

/* Which room a position is inside, or 0 for the commons. Rooms are exclusive
 * and never overlap, so the first match is the answer. */
export function regionAt(x, y) {
  const tx = Math.round(x), ty = Math.round(y);
  for (const r of ROOMS) {
    if (tx > r.x && tx < r.x + r.w - 1 && ty > r.y && ty < r.y + r.h - 1) return r.id;
  }
  return COMMONS;
}

/* Props that stand taller than their tile, so a character walks behind them. */
export const PROP_SIZE = { tree: 2, 'tunnel-big': 2, house: 2 };

const seated = (x, y) => [
  ['prop', 'table', x, y],
  ['prop', 'stool', x - 1, y], ['prop', 'stool', x + 1, y],
  ['prop', 'stool', x, y - 1], ['prop', 'stool', x, y + 1],
];

/* Everything outside the rooms. Paths, planting, and somewhere to sit. */
const COMMONS_OPS = [
  ['fill', 'cobble', 19, 14, 26, 12],
  ['fill', 'cobble-red', 30, 18, 4, 4],
  ['band', 'cobble', 8, 11, 2, 4],
  ['band', 'cobble', 23, 11, 2, 4],
  ['band', 'cobble', 39, 12, 2, 3],
  ['band', 'cobble', 55, 14, 2, 4],
  ['band', 'cobble', 15, 19, 5, 2],
  ['band', 'cobble', 17, 32, 3, 2],
  ['band', 'cobble', 44, 33, 5, 2],
  ...seated(23, 17), ...seated(40, 22), ...seated(28, 24),
  ['prop', 'tree', 18, 8], ['prop', 'tree', 46, 17], ['prop', 'tree', 22, 40],
  ['prop', 'tree', 58, 22], ['prop', 'tree', 6, 41],
  ['prop', 'shrub', 26, 13], ['prop', 'shrub', 43, 15], ['prop', 'shrub', 35, 30],
  ['prop', 'flowers-red', 32, 16], ['prop', 'flowers-red', 25, 28],
  ['prop', 'sign', 31, 14],
  ['prop', 'barrel', 42, 13], ['prop', 'crate', 43, 13],
];

/* Interiors, keyed by room id. Coordinates are absolute world tiles. */
const ROOM_OPS = {
  1: (r) => [...seated(r.x + 7, r.y + 5), ['prop', 'crate', r.x + 2, r.y + 2]],
  2: (r) => [...seated(r.x + 7, r.y + 5), ['prop', 'shrub', r.x + 2, r.y + 7]],
  /* Three tables in a row with stools down both sides -- as close to a
   * conference table as this prop set gets. */
  3: (r) => {
    const cx = r.x + 8, cy = r.y + 6;
    const ops = [];
    for (let i = 0; i < 3; i++) ops.push(['prop', 'table', cx + i, cy]);
    for (let i = 0; i < 3; i++) ops.push(['prop', 'stool', cx + i, cy - 1], ['prop', 'stool', cx + i, cy + 1]);
    ops.push(['prop', 'stool', cx - 1, cy], ['prop', 'stool', cx + 3, cy]);
    return ops;
  },
  /* Stone tiers stepping down to a stage. */
  4: (r) => {
    const ops = [['fill', 'floor-stone', r.x + 4, r.y + 2, r.w - 8, 3], ['prop', 'sign', r.x + 9, r.y + 3]];
    /* Tiers step down toward the stage and must stay clear of the doorway in
     * the bottom wall, or they seal the room shut. */
    /* Tiers must stop well clear of the doorway in the bottom wall: a tier on
     * the tile you step onto from outside seals the room. */
    for (let i = 0; i < 3; i++) ops.push(['tier', r.x + 2, r.y + 3 + i * 2, r.w - 4]);
    return ops;
  },
  5: (r) => [
    ['prop', 'tunnel', r.x + 2, r.y + 2], ['prop', 'tunnel', r.x + 10, r.y + 2],
    ['prop', 'crate', r.x + 4, r.y + 6], ['prop', 'barrel', r.x + 9, r.y + 6],
    ['prop', 'stool', r.x + 5, r.y + 7], ['prop', 'stool', r.x + 8, r.y + 7],
  ],
  6: (r) => {
    const ops = [['screen', r.x + 4, r.y + 1, 10, 4]];
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 5; i++) ops.push(['prop', 'stool', r.x + 4 + i * 2, r.y + 7 + row * 3]);
    return ops;
  },
  7: (r) => [
    ...seated(r.x + 5, r.y + 4), ...seated(r.x + 12, r.y + 4), ...seated(r.x + 8, r.y + 9),
    ['prop', 'barrel', r.x + 2, r.y + 2],
  ],
};

/* Expand the world into what the renderer and collision need.
 *
 * Collision blocks the BASE of a prop rather than its whole sprite, so tall
 * things can be walked behind instead of becoming impassable columns. */
export function buildWorld() {
  const w = WORLD_W, h = WORLD_H;
  const tiles = Array.from({ length: h }, () => Array(w).fill('grass'));
  const tints = Array.from({ length: h }, () => Array(w).fill(0xffffff));
  const solid = Array.from({ length: h }, () => Array(w).fill(false));
  const props = [];
  let screen = null;

  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const put = (x, y, t, tint) => { if (inside(x, y)) { tiles[y][x] = t; if (tint) tints[y][x] = tint; } };
  const block = (x, y) => { if (inside(x, y)) solid[y][x] = true; };

  const run = (ops, tint) => {
    for (const [kind, ...a] of ops) {
      if (kind === 'fill' || kind === 'band') {
        const [t, x, y, ww, hh] = a;
        for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) put(x + i, y + j, t, tint);
      } else if (kind === 'prop') {
        const [t, x, y] = a;
        props.push({ t, x, y, tint });
        const size = PROP_SIZE[t] ?? 1;
        for (let i = 0; i < size; i++) block(x + i, y + size - 1);
      } else if (kind === 'tier') {
        const [x, y, len] = a;
        for (let i = 0; i < len; i++) { props.push({ t: 'wall-stone-small', x: x + i, y, tint }); block(x + i, y); }
      } else if (kind === 'screen') {
        const [x, y, ww, hh] = a;
        screen = { x, y, w: ww, h: hh };
        for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) block(x + i, y + j);
      }
    }
  };

  run(COMMONS_OPS, null);

  for (const r of ROOMS) {
    /* Floor and walls. The doorway is punched out afterwards so it always
     * stays walkable, whatever the wall run did. */
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
        put(x, y, edge ? 'floor-stone' : r.floor, r.tint);
        if (edge) { block(x, y); props.push({ t: 'wall-stone', x, y, tint: r.tint }); }
      }
    }
    run(ROOM_OPS[r.id](r), r.tint);
    /* The doorway is a real gap: the wall tiles are simply absent, so you can
     * see straight in. No arch, no threshold prop -- an opening reads as a way
     * through far better than a decorated frame does. */
    for (const [dx, dy] of r.door) {
      solid[dy][dx] = false;
      put(dx, dy, r.floor, r.tint);
      /* Drop any wall sprite that was queued for this tile. */
      for (let i = props.length - 1; i >= 0; i--) {
        const q = props[i];
        if (q.x === dx && q.y === dy && q.t === 'wall-stone') props.splice(i, 1);
      }
    }
  }

  /* An enclosed edge, so nobody walks out of the world. */
  for (let x = 0; x < w; x++) { block(x, 0); block(x, h - 1); }
  for (let y = 0; y < h; y++) { block(0, y); block(w - 1, y); }

  return { w, h, tiles, tints, solid, props, screen, px: w * TILE, py: h * TILE };
}

/* Where a fresh arrival stands: the middle of the commons plaza. */
export const SPAWN = { x: 32, y: 20 };
