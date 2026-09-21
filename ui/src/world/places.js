/* The painted worlds.
 *
 * The main map remains one continuous world whose rooms are regions. The
 * Vatican is another scene, but it is also one complete social room: everybody
 * on that painting shares its roster, chat and call instead of leaking into
 * the Game Room's conversation.
 */
import data from './map-data.js';
import vatican from './vatican-data.js';

export const MAIN_SCENE = 'main';
export const VATICAN_SCENE = 'vatican';
export const isScene = value => value === MAIN_SCENE || value === VATICAN_SCENE;
export const normalScene = value => value === VATICAN_SCENE ? VATICAN_SCENE : MAIN_SCENE;

export const TILE = 32;
export const CELL = data.cell;
export const PER_TILE = TILE / CELL;
export const WORLD_PX = data.width, WORLD_PY = data.height;
export const WORLD_W = data.width / TILE, WORLD_H = data.height / TILE;
export const COMMONS = 0;
const COMMONS_ID = 99;

export const MAP_IMAGE = '/apps/glurff/map/world.jpg';
export const OVER_IMAGE = '/apps/glurff/map/over.png';
export const VATICAN_IMAGE = '/apps/glurff/map/vatican.jpg';
export const VATICAN_OVER_IMAGE = '/apps/glurff/map/vatican-over.png';

export const SPAWN = { x: data.spawn[0] / TILE, y: data.spawn[1] / TILE };
export const VATICAN_SPAWN = {
  x: vatican.spawn[0] / vatican.tile,
  y: vatican.spawn[1] / vatican.tile,
  dir: 'down',
};

/* Rooms, as the main map's designation layer labelled them. Vatican City uses
 * a reserved room id below the huddle range (1000+) so it stays stable when
 * another room is drawn on the main map later. */
const MAIN_ROOMS = data.rooms.map((r) => ({
  id: r.id, slug: r.slug, name: r.name, cells: r.cells,
  x: r.bounds[0] / TILE, y: r.bounds[1] / TILE,
  w: (r.bounds[2] - r.bounds[0]) / TILE, h: (r.bounds[3] - r.bounds[1]) / TILE,
  scene: MAIN_SCENE,
}));
export const VATICAN_ROOM = 900;
export const ROOMS = [...MAIN_ROOMS, {
  id: VATICAN_ROOM,
  slug: 'vatican-city',
  name: 'Vatican City',
  cells: vatican.cols * vatican.rows,
  x: 0,
  y: 0,
  w: vatican.width / vatican.tile,
  h: vatican.height / vatican.tile,
  scene: VATICAN_SCENE,
}];
export const roomById = (id) => ROOMS.find((r) => r.id === id) ?? null;
export const roomBySlug = (slug) => ROOMS.find((r) => r.slug === slug) ?? null;
export const LAST_ROOM = ROOMS.reduce((n, r) => Math.max(n, r.id), 0);
export const RUMORS_ROOM = roomBySlug('war')?.id ?? 0;
export const GAME_ROOM = roomBySlug('game')?.id ?? 0;
const ROOM_IDS = new Set(ROOMS.map((room) => room.id));
export const isChattyRoom = (place) => ROOM_IDS.has(place) && place !== RUMORS_ROOM;

const unpack = encoded => {
  const raw = atob(encoded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
const mainSolid = unpack(data.solid);
const vaticanSolid = unpack(vatican.solid);
const vaticanExit = unpack(vatican.exit);

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

const bit = (bits, index) => index >= 0 && (bits[index >> 3] & (1 << (index & 7))) !== 0;
const cellOf = (map, x, y) => {
  const perTile = map.tile / map.cell;
  const cx = Math.floor(x * perTile), cy = Math.floor(y * perTile);
  if (cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows) return -1;
  return cy * map.cols + cx;
};

const MAIN = {
  key: MAIN_SCENE, data: { ...data, tile: TILE }, tile: TILE,
  world: { w: data.width / TILE, h: data.height / TILE, px: data.width, py: data.height },
  image: MAP_IMAGE, over: OVER_IMAGE, characterScale: 4, walkSpeed: 4.4,
  /* The name over somebody's head, in points. A character an inch tall wants a
   * smaller label than one four times the size; see sceneNameSize. */
  nameSize: 9,
  /* The visible body is forty-eight pixels high at 4x. */
  collisionOffsetY: 24 / TILE,
  /* Keep the supplied boundary twelve pixels higher than its artwork. */
  boundaryShiftY: -12 / TILE,
};
const VATICAN = {
  key: VATICAN_SCENE, data: vatican, tile: vatican.tile,
  world: { w: vatican.width / vatican.tile, h: vatican.height / vatican.tile,
           px: vatican.width, py: vatican.height },
  image: VATICAN_IMAGE, over: VATICAN_OVER_IMAGE, characterScale: 1, walkSpeed: 2.24,
  /* A quarter the character, so the name does not tower over the person. */
  nameSize: 5,
  /* The visible body is twelve pixels high at 1x. Test collision at its
   * vertical centre instead of at the feet, while keeping position/presence
   * anchored at the feet. */
  collisionOffsetY: 6 / vatican.tile,
  boundaryShiftY: 0,
};
export const sceneInfo = scene => scene === VATICAN_SCENE ? VATICAN : MAIN;
export const sceneTile = scene => sceneInfo(scene).tile;
export const sceneWorld = scene => sceneInfo(scene).world;
export const sceneImages = scene => {
  const info = sceneInfo(scene);
  return { image: info.image, over: info.over };
};
export const sceneCharacterScale = scene => sceneInfo(scene).characterScale;
export const sceneNameSize = scene => sceneInfo(scene).nameSize;
export const sceneWalkSpeed = scene => sceneInfo(scene).walkSpeed;
const sceneCollisionY = (y, scene) => {
  const info = sceneInfo(scene);
  return y - info.collisionOffsetY - info.boundaryShiftY;
};

export function solidAt(x, y, scene = MAIN_SCENE) {
  const map = scene === VATICAN_SCENE ? vatican : MAIN.data;
  const index = cellOf(map, x, sceneCollisionY(y, scene));
  if (index < 0) return true;
  return bit(scene === VATICAN_SCENE ? vaticanSolid : mainSolid, index);
}

/* The supplied designation layer's upper marked area is the trip home. */
export function vaticanExitAt(x, y) {
  return bit(vaticanExit, cellOf(vatican, x, y));
}

/* WHICH ROOM SOMEBODY IS IN.
 *
 * Your FEET decide whether you are in a room. A character is drawn upward from
 * its feet, so a body point sits about a third of a tile higher -- and judging
 * membership by that put people INSIDE a room while they were still standing
 * outside its wall, close enough for their shoulders to overlap it. They
 * turned up on the room's list without ever walking in.
 *
 * The body point still has a job, and it is the one it was added for: it keeps
 * you in a room you are ALREADY in while your feet are on its threshold or on
 * a piece of its furniture, so the chat does not flicker to the Commons as you
 * walk along a wall. It never puts you into a room you have not entered, which
 * is why it is only consulted against `previous`.
 */
export function regionAt(x, y, scene = MAIN_SCENE, previous = null) {
  if (scene === VATICAN_SCENE) return VATICAN_ROOM;
  const feetCell = cellOf(MAIN.data, x, y);
  const feet = feetCell < 0 ? COMMONS : cells[feetCell];
  if (feet) return feet;
  /* Feet on OPEN FLOOR outside the room: you are outside it, and no amount of
   * body overlapping its wall changes that. The body point is only consulted
   * when the feet are on something that belongs to no room at all -- a
   * threshold, a wall, a table -- which is the flicker it was added for. */
  if (feetCell >= 0 && !bit(mainSolid, feetCell)) return COMMONS;
  const bodyCell = cellOf(MAIN.data, x, sceneCollisionY(y, scene));
  const body = bodyCell < 0 ? COMMONS : cells[bodyCell];
  return body && body === previous ? body : COMMONS;
}

export const world = MAIN.world;
export function buildWorld(scene = MAIN_SCENE) { return sceneWorld(scene); }

/* Kept for older callers. The paintings contain their own props. */
export const PROP_SIZE = {};
