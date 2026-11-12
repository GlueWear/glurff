/* 2026-11-11: floor in no area never moves anybody (world/places regionAt).
 * Walking onto it keeps you in the area you were last in on that map;
 * arriving onto it -- the start, a door -- you are in no area until you step
 * into one. Callers without `stay` get what they always did. */
import { LIBRARY, SLIVER, COMMONS_FLOOR } from './no-area-world.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { regionAt, COMMONS, QUIET, roomsOf, MAIN_SCENE } from './places.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const LIB = roomsOf(MAIN_SCENE).find((r) => r.name === 'Library').id;

/* A walk, as the game does it: each step's answer is the next step's `stay`. */
function walk(points, stay = null, room = COMMONS) {
  const out = [];
  for (const p of points) {
    room = regionAt(p.x, p.y, MAIN_SCENE, room, stay);
    stay = room === QUIET ? null : room;
    out.push(room);
  }
  return out;
}

test('the sliver is floor in no area, and the cells either side are the Library and the Commons', () => {
  assert.equal(regionAt(SLIVER.x, SLIVER.y, MAIN_SCENE), QUIET, 'without stay: as it always was');
  assert.equal(regionAt(LIBRARY.x, LIBRARY.y, MAIN_SCENE), LIB);
  assert.equal(regionAt(COMMONS_FLOOR.x, COMMONS_FLOOR.y, MAIN_SCENE), COMMONS);
});

test('walking onto floor in no area keeps you where you were, either way', () => {
  assert.deepEqual(walk([LIBRARY, SLIVER, SLIVER, LIBRARY]), [LIB, LIB, LIB, LIB], 'from the Library: still in the Library');
  assert.deepEqual(walk([COMMONS_FLOOR, SLIVER, COMMONS_FLOOR]), [COMMONS, COMMONS, COMMONS], 'from the Commons: still in the Commons');
  assert.deepEqual(walk([LIBRARY, SLIVER, COMMONS_FLOOR, SLIVER, LIBRARY]), [LIB, LIB, COMMONS, COMMONS, LIB], 'an area entered is the area kept');
});

test('arriving onto floor in no area: in no area until you step into one', () => {
  assert.deepEqual(walk([SLIVER, SLIVER, LIBRARY, SLIVER]), [QUIET, QUIET, LIB, LIB]);
  assert.deepEqual(walk([SLIVER, COMMONS_FLOOR, SLIVER]), [QUIET, COMMONS, COMMONS]);
});

test('an area of another map is not kept', () => {
  assert.equal(regionAt(SLIVER.x, SLIVER.y, MAIN_SCENE, 900, 900), QUIET);
  assert.equal(regionAt(SLIVER.x, SLIVER.y, MAIN_SCENE, QUIET, QUIET), QUIET);
});

test('the game keeps the area, forgets it on arriving, and other players are judged the same way', () => {
  const game = read('./game.js');
  assert.match(game, /const rawRoom = regionAt\(this\.self\.x, this\.self\.y, this\.scene, this\.room, this\.stay\);\n    this\.stay = rawRoom === QUIET \? null : rawRoom;/);
  assert.match(game, /    this\.stay = null;                                   \/\/  arriving: in no area until we step into one\n    this\.room = regionAt\(this\.self\.x, this\.self\.y, next, this\.room\);/);
  assert.match(game, /this\.self\.x = spawn\.x; this\.self\.y = spawn\.y; this\.self\.dir = 'down';\n    this\.stay = null;/);
  assert.match(game, /regionAt\(this\.self\.x, this\.self\.y, this\.scene, this\.room, this\.stay\) !== portal\.area\.id/);
  /* Unchanged on purpose: where an NPC may wander, which rooms are shut, a door's far side. */
  assert.match(game, /\(x, y\) => regionAt\(x, y, scene, place\) === place;/);
  assert.match(game, /return this\.blocked\(regionAt\(x, y, this\.scene\)\);/);
  const rooms = read('../lib/rooms.js');
  assert.match(rooms, /const now=regionAt\(spot\.x,spot\.y,spot\.scene,was,st\?\.scene===spot\.scene\?st\.area:null\);/);
  assert.match(rooms, /peerStay\.set\(who,\{scene:spot\.scene,area:now===QUIET\?null:now\}\);/);
});
