/* THE PAINTED WORLDS, as the world's document has them (2026-11-05).
 *
 * Each map of the world (world/world-doc) is a scene: one painting, its
 * walls, its areas. Areas are rooms, and an area's number is its place on the
 * wire. The document is the one lib/world-config holds -- the host's
 * published world, or the app's copy of the official one -- and is fixed for
 * the life of the page: going to another Glurff loads the page again.
 *
 * Positions here are in a scene's own UNITS, its document's `unit` pixels
 * (32 on the official main map), as the game has always counted them.
 *
 * The official world's main map remains one continuous world whose rooms
 * are regions; Vatican City is another scene that is also one whole room.
 * Neither is special here any more: both are what their document says.
 */
import { WORLD_DOC, assetUrl } from '../lib/world-config.js';
import { compile, covers, bounds, QUIET, worldChat, PAINT_TILE } from './world-doc.js';
import { imageShape, normalTurn } from './turned.js';

export const COMMONS = 0;
/* The floor outside every area: no chat, no calls (world/world-doc). */
export { QUIET };

const doc = WORLD_DOC;
const WORLD_CHAT = worldChat(doc);
const SCENES = new Map(doc.maps.map((m) => [m.id, { map: m, ...compile(m, WORLD_CHAT) }]));

/* Every arrival (a door), in its scene's units, with the shape drawn for it
 * in map pixels when there is one. */
const ARRIVALS = new Map();
for (const m of doc.maps) for (const a of m.arrivals)
  ARRIVALS.set(a.id, { id: a.id, name: a.name ?? a.id, x: a.x / m.unit, y: a.y / m.unit, dir: a.dir ?? 'down', scene: m.id, shape: a.shape ?? null });
export const arrival = (id) => ARRIVALS.get(id) ?? null;

/* WHERE SOMEBODY ARRIVING THROUGH A DOOR STANDS: anywhere you can stand
 * inside it, at random, so a crowd coming in is not one pile; its middle if
 * it was drawn as a point or nowhere inside it is walkable (2026-11-06). */
export function arrivalPoint(a, random = Math.random) {
  if (!a) return null;
  const s = SCENES.get(normalScene(a.scene)), u = s.map.unit;
  if (a.shape) {
    const [x0, y0, x1, y1] = bounds(a.shape);
    for (let i = 0; i < 40; i++) {
      const x = x0 + random() * (x1 - x0), y = y0 + random() * (y1 - y0);
      if (covers(a.shape, x, y) && !solidAt(x / u, y / u, a.scene)) return { x: x / u, y: y / u, dir: a.dir, scene: a.scene };
    }
  }
  return { x: a.x, y: a.y, dir: a.dir, scene: a.scene };
}

/* The scene a visit starts in: the world's entry's. */
const ENTRY = ARRIVALS.get(doc.world.entry) ?? ARRIVALS.get(doc.maps[0].spawn);
export const MAIN_SCENE = ENTRY.scene;
export const spawnOf = (scene) => {
  const s = SCENES.get(normalScene(scene));
  return ARRIVALS.get(s.map.spawn) ?? null;
};

export const isScene = (value) => SCENES.has(value);
export const normalScene = (value) => (SCENES.has(value) ? value : MAIN_SCENE);
export const SCENE_IDS = [...SCENES.keys()];
/* A scene's number on the wire, and back: the official world's main map is 0
 * and Vatican City 1, as they always were. */
export const sceneNum = (scene) => SCENES.get(normalScene(scene)).map.num;
export const sceneOfNum = (n) => doc.maps.find((m) => m.num === n)?.id ?? null;

export const TILE = SCENES.get(MAIN_SCENE).map.unit;

/* Each scene: its painting, its size, and how a character is drawn and
 * walks on it. `collisionOffsetY` -- walls are tested that far above the
 * feet -- and `boundaryShiftY` -- the walls drawn that much off their
 * artwork -- are in units, as they were. */
const INFO = new Map([...SCENES].map(([id, { map: m }]) => [id, {
  key: id, tile: m.unit, name: m.name,
  world: { w: m.size[0] / m.unit, h: m.size[1] / m.unit, px: m.size[0], py: m.size[1] },
  /* A map in space has no painting (2026-11-08). */
  image: m.image ? assetUrl(m.image.src) : null, over: m.over ? assetUrl(m.over.src) : null,
  /* The paintings are drawn at the map's size, whatever size of copy the
   * host sends visitors. */
  imageScale: m.image ? { x: m.size[0] / m.image.w, y: m.size[1] / m.image.h } : null,
  overScale: m.over ? { x: m.size[0] / m.over.w, y: m.size[1] / m.over.h } : null,
  characterScale: m.character.scale, walkSpeed: m.character.speed, nameSize: m.character.label,
  collisionOffsetY: m.character.probe / m.unit,
  boundaryShiftY: (m.shiftY ?? 0) / m.unit,
}]));
export const sceneInfo = (scene) => INFO.get(normalScene(scene));
/* What of a scene's painting is drawn over people (its foreground layer), as
 * cells, or null. */
export const sceneFront = (scene) => {
  const s = SCENES.get(normalScene(scene));
  return s.front ? { cols: s.cols, rows: s.rows, grid: s.map.grid, cells: s.front } : null;
};
/* The images placed on a scene, in their order: {id, url, at: [x, y, w, h]
 * in map pixels, turn (degrees about its middle; world/turned), front}. */
export const sceneItemImages = (scene) => (SCENES.get(normalScene(scene)).map.items ?? [])
  .filter((it) => it.image).map((it) => ({ id: it.id, url: assetUrl(it.image.src), at: it.image.at, turn: normalTurn(it.image.turn), front: it.image.layer === 'front' }));
/* A scene's painting (2026-11-08): its tiles, each {url, at: [x, y, w, h]}
 * in map pixels, over the map image and under everything else. */
export function scenePaintTiles(scene) {
  const p = SCENES.get(normalScene(scene)).map.paint;
  if (!p?.tiles?.length) return [];
  const sx = (p.size[0] / p.w) * PAINT_TILE, sy = (p.size[1] / p.h) * PAINT_TILE;
  return p.tiles.map((t) => ({ url: assetUrl(t.src), at: [t.c * sx, t.r * sy, sx, sy] }));
}
/* The map's size, in pixels: where the front cells go. */
export const scenePainting = (scene) => ({ size: SCENES.get(normalScene(scene)).map.size });
export const sceneTile = (scene) => sceneInfo(scene).tile;
export const sceneWorld = (scene) => sceneInfo(scene).world;
export const sceneImages = (scene) => ({ image: sceneInfo(scene).image, over: sceneInfo(scene).over });
/* What a picture weighs, by the document's own table: its address ends in
 * its hash (lib/world-config assetUrl). 0 for anything not in it. */
export const assetBytes = (url) => doc.assets?.[String(url ?? '').split('/').pop()]?.size ?? 0;
export const sceneCharacterScale = (scene) => sceneInfo(scene).characterScale;
export const sceneNameSize = (scene) => sceneInfo(scene).nameSize;
export const sceneWalkSpeed = (scene) => sceneInfo(scene).walkSpeed;
export const world = sceneWorld(MAIN_SCENE);
export function buildWorld(scene = MAIN_SCENE) { return sceneWorld(scene); }

/* How far a position on the wire can reach, in units times `sub`: the
 * biggest map's size, and never less than the 64 x 46 every client
 * accepted before maps came from documents. */
export const spotMax = (sub) => ({
  x: Math.max(64 * sub, ...doc.maps.map((m) => Math.ceil(m.size[0] / m.unit) * sub)),
  y: Math.max(46 * sub, ...doc.maps.map((m) => Math.ceil(m.size[1] / m.unit) * sub)),
});

/* ROOMS: every area of every map. Where each lies is the box round its
 * cells, in its scene's units. */
export const ROOMS = [];
for (const [id, s] of SCENES) {
  const m = s.map, per = m.grid / m.unit;
  const box = new Map();
  for (let i = 0; i < s.zones.length; i++) {
    const n = s.zones[i];
    if (!n || n === QUIET) continue;
    const cx = i % s.cols, cy = Math.floor(i / s.cols);
    const b = box.get(n);
    if (!b) box.set(n, { x0: cx, y0: cy, x1: cx, y1: cy, cells: 1 });
    else { b.x0 = Math.min(b.x0, cx); b.y0 = Math.min(b.y0, cy); b.x1 = Math.max(b.x1, cx); b.y1 = Math.max(b.y1, cy); b.cells++; }
  }
  for (const a of m.areas) {
    if (a.mode === 'world') continue;     //  the main area is the commons, place 0
    const b = box.get(a.num) ?? { x0: 0, y0: 0, x1: -1, y1: -1, cells: 0 };
    ROOMS.push({
      id: a.num, slug: a.id, name: a.name, cells: b.cells, scene: id, area: a, traits: a.traits ?? [],
      x: b.x0 * per, y: b.y0 * per, w: (b.x1 - b.x0 + 1) * per, h: (b.y1 - b.y0 + 1) * per,
    });
  }
}
export const roomById = (id) => ROOMS.find((r) => r.id === id) ?? null;
export const roomBySlug = (slug) => ROOMS.find((r) => r.slug === slug) ?? null;
export const roomsOf = (scene) => ROOMS.filter((r) => r.scene === normalScene(scene));
const withTrait = (trait) => ROOMS.find((r) => r.traits.includes(trait)) ?? null;
/* The rooms that keep an old compatibility behaviour, or -1 for none:
 * Rumors' anonymous chat, the Game Room's dice, the Library's secret. */
export const RUMORS_ROOM = withTrait('rumors')?.id ?? -1;
export const GAME_ROOM = withTrait('dice')?.id ?? -1;
export const UNLOCK_SLUG = withTrait('unlock')?.slug ?? null;
export const LAST_ROOM = ROOMS.reduce((n, r) => Math.max(n, r.id), 0);
const ROOM_IDS = new Set(ROOMS.map((room) => room.id));
export const isChattyRoom = (place) => ROOM_IDS.has(place) && place !== RUMORS_ROOM && roomById(place).area.mode !== 'quiet';
/* A place somebody in `scene` can say they are in: the main area, the quiet
 * floor, or one of that scene's areas. */
export const placeIn = (scene, place) => place === COMMONS || place === QUIET || roomsOf(scene).some((r) => r.id === place);
/* Whether a place has a chat, and whether it has calls: the quiet floor has
 * neither, a quiet area neither, an area whose calls are off no call. */
export const chatAt = (place) => place === COMMONS || (place !== QUIET && roomById(place)?.area.mode !== 'quiet');
export const callsAt = (place) => place === COMMONS || (place !== QUIET && !!roomById(place) && roomById(place).area.mode !== 'quiet' && roomById(place).area.call !== 'none');
/* Whether the world's chat has proximity huddles (its areas' cards say). */
const chatArea = doc.maps.flatMap((m) => m.areas).find((a) => a.mode === 'world');
export const commonsHuddles = () => chatArea?.call !== 'none';
/* WHAT A PLACE IS CALLED (2026-11-06): an area by its name; the world's chat
 * by its first area's (the official world's is "The Commons"); the quiet
 * floor between areas by its map's. */
export const placeName = (place, scene = MAIN_SCENE) => (place === COMMONS ? chatArea?.name ?? 'The Commons'
  : place === QUIET ? sceneInfo(scene).name ?? 'Here' : roomById(place)?.name ?? 'Room');
/* Whether an area may be leased (its document says). */
export const leasable = (place) => !!roomById(place)?.area.lease;

/* The cell of a scene under a point given in units, judged exactly as the
 * game always has: x times the cells per unit, rounded down. */
const cellOf = (s, x, y) => {
  const per = s.map.unit / s.map.grid;
  const cx = Math.floor(x * per), cy = Math.floor(y * per);
  if (cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows) return -1;
  return cy * s.cols + cx;
};
const sceneCollisionY = (y, scene) => {
  const info = sceneInfo(scene);
  return y - info.collisionOffsetY - info.boundaryShiftY;
};

export function solidAt(x, y, scene = MAIN_SCENE) {
  const s = SCENES.get(normalScene(scene));
  const index = cellOf(s, x, sceneCollisionY(y, scene));
  return index < 0 || s.walls[index] === 1;
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
  const s = SCENES.get(normalScene(scene));
  const feetCell = cellOf(s, x, y);
  const feet = feetCell < 0 ? COMMONS : s.zones[feetCell];
  if (feet) return feet;
  /* Feet on OPEN FLOOR outside the room: you are outside it, and no amount of
   * body overlapping its wall changes that. The body point is only consulted
   * when the feet are on something that belongs to no room at all -- a
   * threshold, a wall, a table -- which is the flicker it was added for. */
  if (feetCell >= 0 && !s.walls[feetCell]) return COMMONS;
  const bodyCell = cellOf(s, x, sceneCollisionY(y, scene));
  const body = bodyCell < 0 ? COMMONS : s.zones[bodyCell];
  return body && body === previous ? body : COMMONS;
}

/* ------------------------------------------------------------- items */

/* Everything placed on the maps, each with the box round what is clicked,
 * in map pixels (`rect`, as hotspots always had). */
export const ITEMS = doc.maps.flatMap((m) => (m.items ?? []).map((it) => {
  const shape = it.shape ?? (it.image ? imageShape(it.image) : null);
  const box = shape ? bounds(shape) : null;
  return { ...it, scene: m.id, shape, rect: box ? { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] } : null };
}));
export const itemById = (id) => ITEMS.find((it) => it.id === id) ?? null;
/* Is a point, in map pixels, on an item? */
export const onItem = (it, point) => !!it.shape && !!point && covers(it.shape, point.x, point.y);

/* PORTALS. A portal leads to an arrival: clicked, walked into (where your
 * feet are), or said -- a phrase, in its area's chat, the whole message
 * however it is cased, with spaces round it trimmed and runs of them inside
 * counted as one. Each gives {item, to}. */
const portals = ITEMS.filter((it) => it.do?.kind === 'portal' && ARRIVALS.has(it.do.to));
const said = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export function phrasePortal(text, place) {
  const words = said(text);
  if (!words) return null;
  const it = portals.find((p) => p.do.trigger === 'phrase' && said(p.do.phrase) === words &&
    roomBySlug(p.do.area)?.id === place);
  return it ? { item: it, to: ARRIVALS.get(it.do.to), area: roomBySlug(it.do.area) } : null;
}
export function walkPortalAt(x, y, scene) {
  const s = SCENES.get(normalScene(scene));
  const px = x * s.map.unit, py = y * s.map.unit;
  const it = portals.find((p) => p.scene === s.map.id && p.do.trigger === 'walk' && covers(p.shape, px, py));
  return it ? { item: it, to: ARRIVALS.get(it.do.to) } : null;
}
/* Any item walked into -- a portal, or a thing set to open when you step on
 * it rather than when tapped. */
export function walkItemAt(x, y, scene) {
  const s = SCENES.get(normalScene(scene));
  const px = x * s.map.unit, py = y * s.map.unit;
  return ITEMS.find((it) => it.scene === s.map.id && it.do?.trigger === 'walk' && it.shape && covers(it.shape, px, py)) ?? null;
}
export const portalOf = (it) => (it?.do?.kind === 'portal' && ARRIVALS.has(it.do.to) ? { item: it, to: ARRIVALS.get(it.do.to) } : null);
/* Where a scene's doors lead (2026-11-08): the other maps one step away, by
 * a portal or a character's choice -- the likeliest next. */
export function sceneNeighbours(scene) {
  const id = normalScene(scene), out = new Set();
  for (const it of ITEMS) {
    if (it.scene !== id) continue;
    for (const d of [it.do, ...(it.do?.kind === 'npc' ? (it.do.choices ?? []).map((c) => c.do) : [])]) {
      const to = d?.kind === 'portal' ? ARRIVALS.get(d.to) : null;
      if (to && to.scene !== id) out.add(to.scene);
    }
  }
  return [...out];
}

/* Where this visit starts: somewhere inside the entrance door. */
export const SPAWN = (() => { const p = arrivalPoint(ENTRY); return { x: p.x, y: p.y, dir: ENTRY.dir }; })();

/* Kept for older callers. The paintings contain their own props. */
export const PROP_SIZE = {};
