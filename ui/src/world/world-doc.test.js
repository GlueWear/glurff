import './test-world.js';   //  the world, set before anything reads it
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, compile, rasterize, sample, walkable, covers, opError } from './world-doc.js';
import legacy from './legacy-world.js';
import { newMap, emptyWorld, SPACE_SIZE } from '../editor/project.js';
import main from './map-data.js';
import vatican from './vatican-data.js';
import { solidAt, regionAt, walkPortalAt, phrasePortal, ROOMS, MAIN_SCENE, SPAWN, TILE, COMMONS,
  sceneNum, sceneOfNum, sceneInfo, GAME_ROOM, RUMORS_ROOM, UNLOCK_SLUG, leasable, spotMax } from './places.js';

/* THE GAME AS IT WAS, before maps came from documents: places.js of
 * 2026-11-04, reading the generated map modules directly. The document-driven
 * places.js must answer every question exactly as this did. */
const was = (() => {
  const unpack = (s) => Buffer.from(s, 'base64');
  const mainSolid = unpack(main.solid), vatSolid = unpack(vatican.solid), vatExit = unpack(vatican.exit);
  const cells = new Uint8Array(main.cols * main.rows);
  for (let i = 0, at = 0; i < main.runs.length; i += 2) { cells.fill(main.runs[i] === 99 ? 0 : main.runs[i], at, at + main.runs[i + 1]); at += main.runs[i + 1]; }
  const M = { ...main, tile: 32 };
  const cellOf = (map, x, y) => {
    const per = map.tile / map.cell, cx = Math.floor(x * per), cy = Math.floor(y * per);
    return cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows ? -1 : cy * map.cols + cx;
  };
  const colY = (y, scene) => (scene === 'vatican' ? y - 6 / vatican.tile - 0 : y - 24 / 32 - -12 / 32);
  const solid = (x, y, scene) => {
    const i = cellOf(scene === 'vatican' ? vatican : M, x, colY(y, scene));
    return i < 0 ? true : bit(scene === 'vatican' ? vatSolid : mainSolid, i);
  };
  const region = (x, y, scene, previous = null) => {
    if (scene === 'vatican') return 900;
    const f = cellOf(M, x, y), feet = f < 0 ? 0 : cells[f];
    if (feet) return feet;
    if (f >= 0 && !bit(mainSolid, f)) return 0;
    const b = cellOf(M, x, colY(y, scene)), body = b < 0 ? 0 : cells[b];
    return body && body === previous ? body : 0;
  };
  const exit = (x, y) => bit(vatExit, cellOf(vatican, x, y));
  return { solid, region, exit };
})();

const clone = (v) => JSON.parse(JSON.stringify(v));
const bitsOf = (s) => Buffer.from(s, 'base64');
const bit = (b, i) => (b[i >> 3] & (1 << (i & 7))) !== 0;

/* The current world, as a document, IS the current world: cell for cell. */
test('the imported world is a valid document', () => {
  assert.deepEqual(validate(legacy), []);
});

test('its walls are the main map\'s walls, cell for cell', () => {
  const m = compile(legacy.maps[0]), solid = bitsOf(main.solid);
  assert.equal(m.walls.length, main.cols * main.rows);
  for (let i = 0; i < m.walls.length; i++) assert.equal(m.walls[i] === 1, bit(solid, i), `cell ${i}`);
});

test('its rooms are the designation layer\'s rooms, cell for cell', () => {
  const m = compile(legacy.maps[0]);
  const want = new Uint16Array(main.cols * main.rows);
  for (let i = 0, at = 0; i < main.runs.length; i += 2) {
    const id = main.runs[i], n = main.runs[i + 1];
    want.fill(id === 99 ? 0 : id, at, at + n); at += n;
  }
  assert.deepEqual([...m.zones], [...want]);
});

test('Vatican City: its walls, and the way home', () => {
  const v = legacy.maps[1], m = compile(v), solid = bitsOf(vatican.solid), exit = bitsOf(vatican.exit);
  for (let i = 0; i < m.walls.length; i++) assert.equal(m.walls[i] === 1, bit(solid, i), `wall ${i}`);
  const door = v.items.find((it) => it.id === 'vatican-exit');
  const grid = rasterize([door.shape], vatican.cols, vatican.rows, vatican.cell);
  for (let i = 0; i < grid.length; i++) assert.equal(grid[i] === 1, bit(exit, i), `exit ${i}`);
  assert.ok(m.zones.every((n) => n === 900), 'the whole painting is room 900');
});

/* The game's own questions, asked both ways, everywhere: the document's
 * places.js against the game as it was. */
test('walls, rooms and the way home answer as the game always has', () => {
  const [mm, vm] = legacy.maps;
  let checked = 0;
  for (let y = -40; y < main.height + 40; y += 3.7) for (let x = -40; x < main.width + 40; x += 5.3) {
    const tx = x / TILE, ty = y / TILE;
    assert.equal(solidAt(tx, ty, 'main'), was.solid(tx, ty, 'main'), `main wall ${x},${y}`);
    for (const previous of [null, 3, 14]) assert.equal(regionAt(tx, ty, 'main', previous), was.region(tx, ty, 'main', previous), `main room ${x},${y}`);
    if (x >= 0 && y >= 0 && x < main.width && y < main.height) assert.equal(!walkable(mm, x, y), was.solid(tx, ty, 'main'), `walkable ${x},${y}`);
    checked++;
  }
  for (let y = 0; y < vatican.height; y += 2.3) for (let x = 0; x < vatican.width; x += 1.9) {
    const t = vatican.tile, tx = x / t, ty = y / t;
    assert.equal(solidAt(tx, ty, 'vatican'), was.solid(tx, ty, 'vatican'), `vatican wall ${x},${y}`);
    assert.equal(regionAt(tx, ty, 'vatican'), 900);
    assert.equal(!!walkPortalAt(tx, ty, 'vatican'), was.exit(tx, ty), `exit ${x},${y}`);
    checked++;
  }
  assert.ok(checked > 100000);
  assert.equal(COMMONS, 0);
});

test('rooms keep their numbers, names and boxes', () => {
  for (const r of main.rooms) {
    const room = ROOMS.find((x) => x.id === r.id);
    assert.ok(room, `room ${r.id}`);
    assert.equal(room.slug, r.slug); assert.equal(room.name, r.name); assert.equal(room.cells, r.cells);
    assert.deepEqual([room.x, room.y, room.x + room.w, room.y + room.h].map((n) => n * TILE), r.bounds, `${r.slug} box`);
    assert.equal(room.scene, 'main');
  }
  const v = ROOMS.find((x) => x.id === 900);
  assert.deepEqual([v.x, v.y, v.w, v.h, v.cells], [0, 0, vatican.width / vatican.tile, vatican.height / vatican.tile, vatican.cols * vatican.rows]);
  assert.equal(GAME_ROOM, 15); assert.equal(RUMORS_ROOM, 13); assert.equal(UNLOCK_SLUG, 'library');
  assert.equal(leasable(1), true); assert.equal(leasable(900), false, 'the agent never leased Vatican City');
});

test('the scenes keep their sizes, speeds, spawn and wire numbers', () => {
  assert.equal(MAIN_SCENE, 'main');
  assert.deepEqual(SPAWN, { x: main.spawn[0] / TILE, y: main.spawn[1] / TILE, dir: 'down' });
  assert.deepEqual([sceneNum('main'), sceneNum('vatican'), sceneOfNum(0), sceneOfNum(1)], [0, 1, 'main', 'vatican']);
  const m = sceneInfo('main'), v = sceneInfo('vatican');
  assert.deepEqual([m.tile, m.characterScale, m.walkSpeed, m.nameSize, m.collisionOffsetY, m.boundaryShiftY], [32, 4, 4.4, 9, 24 / 32, -12 / 32]);
  assert.deepEqual([v.tile, v.characterScale, v.walkSpeed, v.nameSize, v.collisionOffsetY, v.boundaryShiftY], [24, 1, 2.24, 5, 6 / 24, 0]);
  /* Its pictures are its host's (2026-11-10: the app carries none of its own). */
  assert.match(m.image, /^\/apps\/glurff\/world\/~nolset\/asset\/[0-9a-f]{64}$/); assert.match(v.over, /^\/apps\/glurff\/world\/~nolset\/asset\/[0-9a-f]{64}$/);
  assert.deepEqual(spotMax(16), { x: 1024, y: 736 });
});

test('"vatican city" said in the Game Room leads there, and the way home leads back', () => {
  const into = phrasePortal('  Vatican   CITY ', 15);
  assert.equal(into.to.id, 'vatican-spawn'); assert.equal(into.to.scene, 'vatican');
  assert.deepEqual([into.to.x, into.to.y], [vatican.spawn[0] / vatican.tile, vatican.spawn[1] / vatican.tile]);
  assert.equal(phrasePortal('vatican city', 14), null, 'not in the Library');
  assert.equal(phrasePortal('let us go to vatican city', 15), null);
  const exit = legacy.maps[1].items[0];
  const anyCell = Buffer.from(exit.shape.data, 'base64').findIndex((b) => b);
  assert.ok(anyCell >= 0);
});

/* ------------------------------------------------------------- shapes */

test('shapes cover what they say', () => {
  assert.ok(covers({ t: 'rect', x: 10, y: 10, w: 5, h: 5 }, 12, 12));
  assert.ok(!covers({ t: 'rect', x: 10, y: 10, w: 5, h: 5 }, 15, 12), 'the far edge is outside');
  assert.ok(covers({ t: 'ellipse', x: 0, y: 0, rx: 10, ry: 5 }, 9, 0));
  assert.ok(!covers({ t: 'ellipse', x: 0, y: 0, rx: 10, ry: 5 }, 8, 4));
  const tri = { t: 'poly', p: [0, 0, 10, 0, 0, 10] };
  assert.ok(covers(tri, 2, 2)); assert.ok(!covers(tri, 8, 8));
  const wall = { t: 'line', p: [0, 0, 100, 0, 100, 100], r: 3 };
  assert.ok(covers(wall, 50, 2)); assert.ok(covers(wall, 98, 50)); assert.ok(!covers(wall, 50, 50));
  assert.ok(covers({ t: 'line', p: [5, 5], r: 2 }, 6, 6), 'one point is a dot');
});

test('later shapes win, and an eraser opens a door in a wall', () => {
  const ops = [{ t: 'rect', x: 0, y: 0, w: 40, h: 8 }, { t: 'rect', x: 16, y: 0, w: 8, h: 8, v: 0 }];
  const g = rasterize(ops, 5, 1, 8);
  assert.deepEqual([...g], [1, 1, 0, 1, 1]);
  assert.equal(sample(ops, 20, 3, 8), 0);
  assert.equal(sample(ops, 30, 3, 8), 1);
});

test('a big map with a few shapes only visits the cells under them', () => {
  const t0 = performance.now();
  const g = rasterize([{ t: 'ellipse', x: 2000, y: 4000, rx: 30, ry: 30 }], 1025, 2119, 4);
  assert.ok(performance.now() - t0 < 200);
  assert.equal(g.reduce((n, v) => n + v, 0) > 150, true);
});

test('a broken shape says what is wrong', () => {
  assert.match(opError({ t: 'rect', x: 0, y: 0, w: -1, h: 4 }), /rectangle/);
  assert.match(opError({ t: 'poly', p: [0, 0, 1, 1] }), /three corners/);
  assert.match(opError({ t: 'bits', x: 0, y: 0, cell: 1, cols: 100, rows: 100, data: 'AAAA' }), /shorter/);
  assert.match(opError({ t: 'spiral' }), /unknown shape/);
});

/* ------------------------------------------------------------- refusals */

const broken = (change) => { const d = clone(legacy); change(d); return validate(d); };
const refuses = (change, pattern) => {
  const errors = broken(change);
  assert.ok(errors.some((e) => pattern.test(e)), `wanted ${pattern}, got ${JSON.stringify(errors)}`);
};

test('a document that is not schema 1 is refused', () => {
  refuses((d) => { d.schema = 2; }, /unsupported schema/);
});

test('ids and wire numbers are unique', () => {
  refuses((d) => { d.maps[1].id = 'main'; }, /repeats an id/);
  refuses((d) => { d.maps[1].num = 0; }, /repeats a number/);
  refuses((d) => { d.maps[0].areas[2].num = d.maps[0].areas[1].num; }, /repeats a number/);
  refuses((d) => { d.maps[1].areas[0].id = 'bar'; }, /repeats an id/);
  refuses((d) => { d.maps[0].areas[1].num = 999; }, /1-998/);
  refuses((d) => { d.maps[0].areas[1].mode = 'world'; d.maps[0].areas[1].call = 'huddle'; delete d.maps[0].areas[1].lease; }, /world's chat, number 0/);
  refuses((d) => { for (const m of d.maps) { m.areas = m.areas.filter((a) => a.mode !== 'world'); m.zones.shift(); } }, /needs an area that is the world's chat/);
  assert.deepEqual(broken((d) => { d.maps[1].areas = d.maps[1].areas.filter((a) => a.mode !== 'world'); d.maps[1].zones.shift(); }), [], 'one map with the world\'s chat is enough');
  refuses((d) => { d.maps.push(...Array.from({ length: 9 }, () => clone(d.maps[1]))); }, /at most 10 maps/);
});

test('a sign needs text, unless people can write on it', () => {
  const sign = (d, act) => { const it = d.maps[0].items.find((x) => x.shape); it.do = act; };
  refuses((d) => sign(d, { kind: 'text', text: '  ' }), /needs text/);
  refuses((d) => sign(d, { kind: 'text', text: 'Hi', editable: 'yes' }), /editable is true or false/);
  assert.deepEqual(broken((d) => sign(d, { kind: 'text', text: '', editable: true })), [], 'a blank sign people write on');
  assert.deepEqual(broken((d) => sign(d, { kind: 'text', text: 'Welcome', editable: false })), []);
});

test('arrivals must be somewhere you can stand', () => {
  refuses((d) => { d.maps[0].arrivals[0].x = 2; d.maps[0].arrivals[0].y = 2; }, /inside a wall/);
  refuses((d) => { d.maps[0].arrivals[0].x = 99999; }, /outside the map/);
  refuses((d) => { d.world.entry = 'nowhere'; }, /entry/);
  refuses((d) => { d.maps[0].spawn = 'vatican-spawn'; }, /spawn/);
});

test('portals lead to real arrivals, and a phrase is said in an area', () => {
  refuses((d) => { d.maps[1].items[0].do.to = 'gone'; }, /leads to no arrival/);
  refuses((d) => { d.maps[0].items.find((i) => i.id === 'vatican-door').do.area = 'vatican-city'; }, /phrase is said in an area of this map/);
});

test('areas: a note is the note, and only an unbound area is leased', () => {
  refuses((d) => { Object.assign(d.maps[0].areas[1], { mode: 'note' }); }, /names none/);
  refuses((d) => { Object.assign(d.maps[0].areas[1], { mode: 'note', note: 'note-~2026.1.1..1.1.1..1', lease: true }); }, /cannot also be leased/);
  refuses((d) => { Object.assign(d.maps[0].areas[1], { mode: 'quiet', call: 'room' }); }, /quiet/);
  refuses((d) => { d.maps[0].zones[1].a = 'vatican-city'; }, /names no area of this map/);
  refuses((d) => { d.maps[0].areas[0].call = 'room'; }, /proximity calls or none/);
  assert.deepEqual(broken((d) => { Object.assign(d.maps[0].areas[1], { mode: 'note', note: 'note-~2026.1.1..1.1.1..1', lease: false }); delete d.maps[0].areas[1].call; }), []);
});

test('every image is in the assets table and held as listed', () => {
  refuses((d) => { d.maps[0].image.src = 'f'.repeat(64); }, /missing from the assets table/);
  const held = Object.fromEntries(Object.entries(legacy.assets).map(([h, a]) => [h, { mime: a.mime, size: a.size }]));
  assert.deepEqual(validate(legacy, held), []);
  const short = { ...held }; delete short[legacy.maps[0].image.src];
  assert.ok(validate(legacy, short).some((e) => /not held by the host/.test(e)));
  refuses((d) => { d.assets['a'.repeat(64)] = { mime: 'image/png', size: 4 }; }, /nothing uses it/);
});

/* A MAP IN SPACE (2026-11-08): no picture at all, as an empty map and a
 * cleared one are. */
test('a map can be in space, with no picture', () => {
  const d = clone(legacy), m = d.maps[0];
  delete d.assets[m.image.src]; delete d.assets[m.over.src];
  delete m.image; delete m.over;
  assert.deepEqual(validate(d), []);
});

test('a new map with no picture is in space, at the blank size, and valid', () => {
  const doc = emptyWorld(), m = newMap(doc, { name: 'Map 1' });
  assert.equal('image' in m, false);
  assert.deepEqual(m.size, SPACE_SIZE);
  m.areas.push({ id: 'world-chat', num: 0, name: 'The world\'s chat', mode: 'world', call: 'huddle' });
  m.zones.push({ t: 'rect', x: 1000, y: 600, w: 400, h: 400, a: 'world-chat' });
  doc.maps.push(m); doc.world.entry = m.spawn;
  assert.deepEqual(validate(doc), []);
});

test('behaviours say what they need', () => {
  refuses((d) => { d.maps[0].items[0].do = { kind: 'web', url: 'http://example.com' }; }, /https/);
  refuses((d) => { d.maps[0].items[0].do = { kind: 'travel', host: 'nolset' }; }, /host ship/);
  refuses((d) => { d.maps[0].items[0].do = { kind: 'app', desk: 'Pong', publisher: '~zod' }; }, /desk/);
  refuses((d) => { d.maps[0].items[0].do = { kind: 'web', url: 'https://example.com', trigger: 'phrase' }; }, /only a portal can be spoken/);
  assert.deepEqual(broken((d) => { d.maps[0].items[0].do = { kind: 'web', url: 'https://example.com', trigger: 'walk' }; }), [], 'anything can be walked into');
  refuses((d) => { d.maps[0].items[0].do = { kind: 'video', screen: { x: 0, y: 0, w: 1, h: 1 }, area: 'vatican-city' }; }, /plays for an area of this map/);
  assert.deepEqual(broken((d) => { d.maps[0].items[0].do = { kind: 'video', screen: { x: 0, y: 0, w: 1, h: 1 } }; }), [], 'a screen for everyone');
  assert.deepEqual(broken((d) => { d.maps[0].items[0].shape = { t: 'group', p: [{ t: 'rect', x: 0, y: 0, w: 4, h: 4 }, { t: 'ellipse', x: 9, y: 9, rx: 2, ry: 2 }] }; }), [], 'an item in two parts');
  refuses((d) => { d.maps[0].items[0].shape = { t: 'group', p: [{ t: 'group', p: [] }] }; }, /cannot hold a group/);
});

test('a map from before main areas keeps its open floor as the world\'s chat', () => {
  const old = structuredClone(legacy.maps[0]);
  old.areas = old.areas.filter((a) => a.mode !== 'world'); old.zones = old.zones.filter((z) => z.a !== 'commons');
  const now = compile(legacy.maps[0]).zones, then = compile(old).zones;
  assert.deepEqual([...then], [...now]);
});
