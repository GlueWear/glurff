#!/usr/bin/env node
/* THE CURRENT GLURFF AS A WORLD DOCUMENT (2026-11-05).
 *
 * Nolset's painted world -- the main map and Vatican City -- written as a
 * schema-1 world document (src/world/world-doc.js), from exactly what the
 * game runs on today: the walls and rooms tools/build_map.py and
 * build_vatican_map.py generated, the hotspots and screens, the way into
 * Vatican City and the way home. Nothing is inferred again from the
 * paintings, so walking it is walking the current world.
 *
 * Images are named by their SHA-256, as a host stores them, so the same
 * document is both the app's built-in world and the project a host imports.
 *
 *   node tools/build_world_doc.mjs        writes src/world/legacy-world.js
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import main from '../src/world/map-data.js';
import vatican from '../src/world/vatican-data.js';

/* What the game hard-coded before maps came from documents (world/hotspots,
 * world/secret-room and lib/unlock as of 2026-11-04), kept here as the record
 * this document was made from. */
const HOTSPOTS = [
  { id: 'jukebox', scene: 'main', rect: { x: 108, y: 166, w: 35, h: 58 } },
  { id: 'amphitheatre', scene: 'main', rect: { x: 646, y: 32, w: 248, h: 73 } },
  { id: 'movie', scene: 'main', rect: { x: 1192, y: 108, w: 148, h: 68 } },
  { id: 'pong-table', scene: 'main', rect: { x: 1368, y: 810, w: 62, h: 70 }, settable: true,
    app: { desk: 'pong', title: 'Pong', publisher: 'HOST', context: { gid: 'glurff-game-room', host: 'HOST' } } },
  { id: 'doomur-tv', scene: 'main', rect: { x: 1367, y: 714, w: 47, h: 48 }, settable: true,
    app: { desk: 'doomur', title: 'Doomur', publisher: 'HOST', context: { gid: 'glurff-game-room', host: 'HOST' } } },
  { id: 'boardroom-table', scene: 'main', rect: { x: 145, y: 790, w: 198, h: 57 }, settable: true },
];
const SCREEN_RECTS = { amphitheatre: { x: 650, y: 36, w: 240, h: 64 }, movie: { x: 1197, y: 113, w: 131, h: 56 } };
const MAIN_RETURN = { x: 44.6, y: 27.75, dir: 'left' };
const VATICAN_PHRASE = 'vatican city', VATICAN_ROOM = 'game', UNLOCK_ROOM = 'library';
import { validate, SCHEMA } from '../src/world/world-doc.js';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILE = 32;
const RUMORS = 'war';
const DICE = VATICAN_ROOM;   //  the Game Room: dice, and the way to Vatican City
const COMMONS_ID = 99;

/* Each image: its hash, bytes and pixel size, read from its header. */
const assets = {};
const image = (name) => {
  const file = path.join(ui, 'public/map', name);
  const bytes = fs.readFileSync(file);
  const src = crypto.createHash('sha256').update(bytes).digest('hex');
  const mime = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
  let w, h;
  if (mime === 'image/png') { w = bytes.readUInt32BE(16); h = bytes.readUInt32BE(20); }
  else for (let i = 2; i < bytes.length;) {
    const m = bytes[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { h = bytes.readUInt16BE(i + 5); w = bytes.readUInt16BE(i + 7); break; }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  assets[src] = { mime, size: bytes.length, w, h, file: `map/${name}` };
  return { src, w, h };
};

/* The main map's rooms, each the run of cells the designation layer gave it:
 * build_map.py's one run-length list of room numbers, split per room. */
const runsByRoom = new Map();
for (let i = 0, at = 0; i < main.runs.length; i += 2) {
  const id = main.runs[i], count = main.runs[i + 1];
  if (id !== COMMONS_ID && id !== 0) {
    const r = runsByRoom.get(id) ?? [];
    if (r.length && r[r.length - 2] + r[r.length - 1] === at) r[r.length - 1] += count;
    else r.push(at, count);
    runsByRoom.set(id, r);
  }
  at += count;
}
const traits = (slug) => [...(slug === RUMORS ? ['rumors'] : []), ...(slug === UNLOCK_ROOM ? ['unlock'] : []),
  ...(slug === DICE ? ['dice'] : [])];
const mainAreas = main.rooms.map((r) => ({
  id: r.slug, num: r.id, name: r.name, mode: 'room', call: 'room', lease: true,
  ...(traits(r.slug).length ? { traits: traits(r.slug) } : {}),
}));
/* The open floor is the map's MAIN AREA, the world's own chat with nearby
 * huddles: painted over the whole map first, the rooms over it. */
const commons = { id: 'commons', num: 0, name: 'The Commons', mode: 'world', call: 'huddle' };
const whole = (m, a) => ({ t: 'rect', x: 0, y: 0, w: m.width, h: m.height, a });
const zones = [whole(main, 'commons'), ...main.rooms.map((r) => ({ t: 'runs', x: 0, y: 0, cell: main.cell, cols: main.cols, r: runsByRoom.get(r.id) ?? [], a: r.slug }))];

/* The hotspots: screens, the jukebox, and the spots that open an app. */
const SCREEN_AREAS = { amphitheatre: 'presentation', movie: 'movie' };
const rect = (r) => ({ t: 'rect', x: r.x, y: r.y, w: r.w, h: r.h });
const items = HOTSPOTS.filter((h) => h.scene === 'main').map((h) => {
  const base = { id: h.id, name: h.app?.title ?? ({ jukebox: 'Jukebox', amphitheatre: 'Amphitheatre screen', movie: 'Movie Theater screen' }[h.id] ?? h.id), shape: rect(h.rect) };
  if (SCREEN_RECTS[h.id]) return { ...base, do: { kind: 'video', screen: SCREEN_RECTS[h.id], area: SCREEN_AREAS[h.id] } };
  if (h.id === 'jukebox') return { ...base, do: { kind: 'video' } };
  if (h.app) return { ...base, settable: true, do: { kind: 'app', desk: h.app.desk, publisher: h.app.publisher, title: h.app.title, context: h.app.context } };
  return { ...base, name: 'Board Room table', settable: true, do: { kind: 'none' } };
});
items.push({
  id: 'vatican-door', name: 'The way to Vatican City',
  do: { kind: 'portal', to: 'vatican-spawn', trigger: 'phrase', phrase: VATICAN_PHRASE, area: VATICAN_ROOM },
});

const doc = {
  schema: SCHEMA,
  world: { name: 'Glurff', entry: 'main-spawn' },
  maps: [
    {
      id: 'main', num: 0, name: 'Glurff',
      size: [main.width, main.height],
      image: image('world.jpg'), over: image('over.png'),
      unit: TILE, grid: main.cell,
      /* Collision is tested 24 pixels above the feet, against a boundary
       * drawn 12 pixels higher than its artwork (world/places, 2026-09). */
      character: { scale: 4, speed: 4.4, label: 9, probe: 24 }, shiftY: -12,
      walk: [{ t: 'bits', x: 0, y: 0, cell: main.cell, cols: main.cols, rows: main.rows, data: main.solid }],
      areas: [commons, ...mainAreas], zones,
      arrivals: [
        { id: 'main-spawn', name: 'Arrival', x: main.spawn[0], y: main.spawn[1], dir: 'down' },
        { id: 'game-return', name: 'Under the Game Room plant', x: MAIN_RETURN.x * TILE, y: MAIN_RETURN.y * TILE, dir: MAIN_RETURN.dir },
      ],
      spawn: 'main-spawn',
      items,
    },
    {
      id: 'vatican', num: 1, name: 'Vatican City',
      size: [vatican.width, vatican.height],
      image: image('vatican.jpg'), over: image('vatican-over.png'),
      unit: vatican.tile, grid: vatican.cell,
      character: { scale: 1, speed: 2.24, label: 5, probe: 6 }, shiftY: 0,
      walk: [{ t: 'bits', x: 0, y: 0, cell: vatican.cell, cols: vatican.cols, rows: vatican.rows, data: vatican.solid }],
      /* One room, the whole painting: everybody there shares its roster, chat
       * and call. 900 is the number it has always had on the wire, and it was
       * never leasable: the agent only ever leased rooms 1-15. */
      areas: [{ id: 'vatican-main', num: 0, name: 'Main area', mode: 'world', call: 'huddle' },
        { id: 'vatican-city', num: 900, name: 'Vatican City', mode: 'room', call: 'room', lease: false }],
      zones: [whole(vatican, 'vatican-main'), { t: 'rect', x: 0, y: 0, w: vatican.width, h: vatican.height, a: 'vatican-city' }],
      arrivals: [{ id: 'vatican-spawn', name: 'Arrival', x: vatican.spawn[0], y: vatican.spawn[1], dir: 'down' }],
      spawn: 'vatican-spawn',
      items: [{
        id: 'vatican-exit', name: 'The way home',
        shape: { t: 'bits', x: 0, y: 0, cell: vatican.cell, cols: vatican.cols, rows: vatican.rows, data: vatican.exit },
        do: { kind: 'portal', to: 'game-return', trigger: 'walk', oneWay: true },
      }],
    },
  ],
  assets: Object.fromEntries(Object.entries(assets).map(([h, { file, ...a }]) => [h, a])),
};

const errors = validate(doc);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const out = path.join(ui, 'src/world/legacy-world.js');
fs.writeFileSync(out, `/* Generated by tools/build_world_doc.mjs from the current map data. Do not edit by hand.
 * Nolset's world as a schema-1 world document (world/world-doc). */
export default ${JSON.stringify(doc)};
/* Where the app keeps each image itself, for the built-in world. */
export const FILES = ${JSON.stringify(Object.fromEntries(Object.entries(assets).map(([h, a]) => [h, a.file])))};
`);
console.log(`wrote ${path.relative(ui, out)}: ${JSON.stringify(doc).length} bytes, ${doc.maps.length} maps, ` +
  `${doc.maps.reduce((n, m) => n + m.areas.length, 0)} areas, ${doc.maps.reduce((n, m) => n + m.items.length, 0)} items`);
