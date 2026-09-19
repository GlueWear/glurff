/* The world: ONE painted map.
 *
 * The map is a drawing (map/source/picture.jpg), and everything the world needs
 * to know about it is drawn on three more layers beside it: what blocks you,
 * what is drawn over you, and which room is where. tools/build_map.py reads
 * those layers and writes map-data.js; nothing about the world is written
 * twice.
 *
 * Rooms are REGIONS of the one map, as they have always been: which room you
 * are in is a function of where you are standing, so you can watch people
 * moving around inside a room from the commons, and walking through a doorway
 * "puts you in" a room without loading anything.
 *
 * COORDINATES. Positions are in tiles, as before, with a tile being 32 painted
 * pixels -- so the world is 48 by 32 tiles and a person is about three quarters
 * of a tile tall. Walls are finer than that: the drawn strokes land on a grid
 * of quarter-tiles, so a thin wall still stops you.
 */
import data from 'world/map-data';

export const TILE = 32;                       //  painted pixels per tile
export const CELL = data.cell;                //  painted pixels per collision cell
export const PER_TILE = TILE / CELL;          //  collision cells across a tile
export const WORLD_PX = data.width, WORLD_PY = data.height;
export const WORLD_W = data.width / TILE, WORLD_H = data.height / TILE;
export const COMMONS = 0;
const COMMONS_ID = 99;                        //  what the map calls the commons

export const MAP_IMAGE = '/apps/glurff/map/world.jpg';
export const OVER_IMAGE = '/apps/glurff/map/over.png';

export const SPAWN = { x: data.spawn[0] / TILE, y: data.spawn[1] / TILE };

/* Rooms, as the designation layer labelled them. `bounds` is in tiles. */
export const ROOMS = data.rooms.map((r) => ({
  id: r.id, slug: r.slug, name: r.name, cells: r.cells,
  x: r.bounds[0] / TILE, y: r.bounds[1] / TILE,
  w: (r.bounds[2] - r.bounds[0]) / TILE, h: (r.bounds[3] - r.bounds[1]) / TILE,
}));
export const roomById = (id) => ROOMS.find((r) => r.id === id) ?? null;
export const roomBySlug = (slug) => ROOMS.find((r) => r.slug === slug) ?? null;
/* The rooms anything else needs by name. Ids come from the map, so nothing
 * anywhere hard-codes one. */
export const LAST_ROOM = ROOMS.reduce((n, r) => Math.max(n, r.id), 0);
export const RUMORS_ROOM = roomBySlug('war')?.id ?? 0;
export const GAME_ROOM = roomBySlug('game')?.id ?? 0;
/* Somewhere you can stand and talk: a room of the map, but not Rumors, which
 * is anonymous and Noltbook's own. */
export const isChattyRoom = (place) => place > COMMONS && place <= LAST_ROOM && place !== RUMORS_ROOM;

/* Walls, one bit per collision cell. */
const bits = (() => {
  const raw = atob(data.solid);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
})();
/* Rooms, stored as runs of the same id because that is nearly all they are. */
const cells = (() => {
  const out = new Uint8Array(data.cols * data.rows);
  let at = 0;
  for (let i = 0; i < data.runs.length; i += 2) {
    const id = data.runs[i], count = data.runs[i + 1];
    out.fill(id === COMMONS_ID ? COMMONS : id, at, at + count);
    at += count;
  }
  return out;
})();

const cellOf = (x, y) => {
  const cx = Math.floor(x * PER_TILE), cy = Math.floor(y * PER_TILE);
  if (cx < 0 || cy < 0 || cx >= data.cols || cy >= data.rows) return -1;
  return cy * data.cols + cx;
};

/* Can somebody stand here? Outside the map, and the space outside the building,
 * are as solid as a wall. */
export function solidAt(x, y) {
  const i = cellOf(x, y);
  if (i < 0) return true;
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}

/* Which room a position is inside, or 0 for the commons. */
export function regionAt(x, y) {
  const i = cellOf(x, y);
  return i < 0 ? COMMONS : cells[i];
}

/* What the camera may show. */
export const world = { w: WORLD_W, h: WORLD_H, px: WORLD_PX, py: WORLD_PY };

/* The world used to be built tile by tile from a list of operations; the map is
 * a painting now, so there is nothing to build. Kept so callers read the same. */
export function buildWorld() { return world; }

/* Props were separate sprites with their own heights; the painting includes
 * them, and the obscure layer says which parts are drawn over people. */
export const PROP_SIZE = {};
