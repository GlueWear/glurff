/* SIGNS, CHARACTERS, COLLECTIBLES AND THE SOUND OF PLACES (2026-11-08):
 * what the document takes for each, and the parts of them that are worked
 * out rather than drawn. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './world-doc.js';
import legacy from './legacy-world.js';
import { wanderRoute, TURN_MS, chance } from './npc-walk.js';
import { wrapLines, fitLines } from './sign-wrap.js';
import { withFound, foundIn, elsewhere, foundFrom, SETTINGS_MAX } from '../lib/collection.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const broken = (change) => { const d = clone(legacy); change(d); return validate(d); };
const refuses = (change, pattern) => {
  const errors = broken(change);
  assert.ok(errors.some((e) => pattern.test(e)), `wanted ${pattern}, got ${JSON.stringify(errors)}`);
};
const item = (d) => d.maps[0].items[0];
const hash = (c) => c.repeat(64);

test('a text item made into a sign says how its words show', () => {
  assert.deepEqual(broken((d) => { item(d).do = { kind: 'text', text: 'Hello', sign: { size: 'large', color: '#ffcc00', plaque: false } }; }), []);
  assert.deepEqual(broken((d) => { item(d).do = { kind: 'text', text: 'Hello', sign: {} }; }), []);
  refuses((d) => { item(d).do = { kind: 'text', text: 'Hello', sign: { size: 'huge' } }; }, /small, medium, large/);
  refuses((d) => { item(d).do = { kind: 'text', text: 'Hello', sign: { color: 'red' } }; }, /#rrggbb/);
});

test('a character: its look, what it says, and choices that are what items do', () => {
  const npc = { kind: 'npc', look: { body: { part: 'human-paleskin', tint: null } }, dir: 'left', wander: true,
    lines: ['Hello!'], talk: 'Welcome.', choices: [{ label: 'A site', do: { kind: 'web', url: 'https://example.com' } }] };
  assert.deepEqual(broken((d) => { item(d).do = npc; }), []);
  refuses((d) => { item(d).do = { ...npc, trigger: 'walk' }; }, /a character is tapped/);
  refuses((d) => { item(d).do = { ...npc, lines: Array(9).fill('hi') }; }, /up to 8 lines/);
  refuses((d) => { item(d).do = { ...npc, choices: [{ label: 'Me', do: { kind: 'npc' } }] }; }, /does web, app/);
  refuses((d) => { item(d).do = { ...npc, choices: [{ label: 'Bad', do: { kind: 'web', url: 'http://x' } }] }; }, /choice 1: needs an https/);
  refuses((d) => { item(d).do = { ...npc, look: 'a pirate' }; }, /look/);
});

test('a collectible: what it says, close only, and a picture the world holds', () => {
  assert.deepEqual(broken((d) => { item(d).do = { kind: 'collect', text: 'A key!', near: true, trigger: 'walk' }; }), []);
  refuses((d) => { item(d).do = { kind: 'collect', text: 'x'.repeat(501) }; }, /500 letters/);
  refuses((d) => { item(d).do = { kind: 'collect', picture: { src: hash('a'), w: 4, h: 4 } }; }, /picture: uses an image missing/);
});

test('an area sound is a small audio asset the document lists', () => {
  const withSound = (mime, size, volume = 0.5) => (d) => {
    d.assets[hash('b')] = { mime, size };
    d.maps[0].areas[1].sound = { src: hash('b'), volume };
  };
  assert.deepEqual(broken(withSound('audio/mpeg', 1000)), []);
  refuses(withSound('image/png', 1000), /not a sound/);
  refuses(withSound('audio/ogg', 3 * 1024 * 1024), /bigger than 2 MB/);
  refuses(withSound('audio/mpeg', 1000, 2), /volume is 0 to 1/);
  refuses((d) => { d.assets[hash('b')] = { mime: 'audio/mpeg', size: 9 }; }, /nothing uses it/);
});

test('a wandering character is in the same place in every browser, and never in a wall', () => {
  const solid = (x, y) => x < 0 || y < 0 || x > 20 || y > 20 || (x > 9 && x < 11 && y < 15);
  const make = () => wanderRoute({ id: 'guide', home: { x: 5, y: 5 }, solid, speed: 1.5 });
  const a = make(), b = make();
  assert.ok(a && a.spots.length > 1);
  for (let t = 0; t < 40 * TURN_MS; t += 777) {
    const p = a.at(t), q = b.at(t);
    assert.deepEqual(p, q);
    assert.ok(!solid(p.x, p.y), `in a wall at ${t}`);
  }
  assert.equal(chance('x', 1), chance('x', 1));
  assert.notEqual(chance('x', 1), chance('x', 2));
});

test('a character given a box walks all over it, and never out of it', () => {
  const solid = (x, y) => x < 0 || y < 0 || x > 40 || y > 40;
  const box = [2, 3, 30, 12], inside = (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const route = wanderRoute({ id: 'roamer', home: { x: 6, y: 6 }, solid, inside, box, speed: 1.5 });
  assert.ok(route && route.spots.length > 3);
  assert.ok(route.spots.some((p) => p.x > 15), 'it goes further than near home');
  for (let t = 0; t < 60 * TURN_MS; t += 500) { const p = route.at(t); assert.ok(inside(p.x, p.y), `out of its box at ${t}`); }
});

test("a sign's words wrap at its width, and what does not fit ends in …", () => {
  const measure = (s) => s.length;
  assert.deepEqual(wrapLines('one two three four', 9, measure), ['one two', 'three', 'four']);
  assert.deepEqual(wrapLines('abcdefghij', 4, measure), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapLines('a\n\nb', 9, measure), ['a', '', 'b']);
  assert.deepEqual(fitLines(['one two', 'three', 'four'], 2, 9, measure), ['one two', 'three…']);
});

test('what we collect is kept by host, once each, and small', () => {
  const items = [{ id: 'key' }, { id: 'gem' }, { id: 'map' }];
  let s = { clocks: [] };
  s = withFound(s, '~zod', 'key'); s = withFound(s, '~zod', 'key'); s = withFound(s, '~nec', 'gem');
  assert.deepEqual(foundIn(s, '~zod', items), ['key']);
  assert.deepEqual(elsewhere(s, '~zod'), [{ host: '~nec', count: 1 }]);
  assert.deepEqual(foundFrom([0, 2, 2, 7, -1, 'x'], items), [0, 2]);
  assert.equal(withFound({ big: 'x'.repeat(SETTINGS_MAX) }, '~zod', 'key'), null);
});
