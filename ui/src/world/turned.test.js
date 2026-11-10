/* 2026-11-10: pictures and pasted drawing turned about their middles; the
 * editor's keys that move the map; setting where an NPC walks; the door
 * wording; and "Traveling to" on the way in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalTurn, snapTurn, turnBy, turnedCorners, turnedShape, turnedBounds, toLocal, fromLocal,
  resizeCorner, resizeSide, inside, turnHandle } from './turned.js';
import { validate, wallsOf, covers } from './world-doc.js';
import legacy from './legacy-world.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const near = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= e);

test('a turn is kept between -180 and 180, a tenth of a degree, straight as 0', () => {
  assert.equal(normalTurn(0), 0);
  assert.equal(normalTurn(-0.04), 0);
  assert.equal(normalTurn(360), 0);
  assert.equal(normalTurn(270), -90);
  assert.equal(normalTurn(-180), 180);
  assert.equal(normalTurn(45.26), 45.3);
  assert.equal(normalTurn(undefined), 0);
  assert.equal(normalTurn(NaN), 0);
});

test('a turn settles on straight near a quarter turn, and steps by 15 with Shift', () => {
  assert.equal(snapTurn(3), 0);
  assert.equal(snapTurn(87), 90);
  assert.equal(snapTurn(30), 30);
  assert.equal(snapTurn(37, true), 30);
  assert.equal(snapTurn(38, true), 45);
  /* Dragged a quarter of the way round its middle, from its right. */
  assert.equal(turnBy([0, 0, 100, 50], 0, { x: 100, y: 25 }, { x: 50, y: 100 }), 90);
  assert.equal(turnBy([0, 0, 100, 50], 90, { x: 100, y: 25 }, { x: 50, y: 100 }), 180);
});

test('turned about its middle, clockwise as the screen shows', () => {
  const at = [0, 0, 100, 50];
  assert.ok(near(turnedCorners(at, 0)[1], [100, 0]));
  /* A quarter turn: its top right corner comes round to the bottom right. */
  assert.ok(near(turnedCorners(at, 90)[1], [75, 75]));
  assert.ok(near(toLocal(at, 30, ...fromLocal(at, 30, 12, -7)), [12, -7]));
  assert.ok(near(turnedBounds(at, 90), [25, -25, 75, 75]));
  assert.ok(inside(at, 90, 50, 70) && !inside(at, 90, 5, 25));
  assert.deepEqual(turnedShape(at, 0), { t: 'rect', x: 0, y: 0, w: 100, h: 50 });
  assert.equal(turnedShape(at, 45).t, 'poly');
  assert.ok(near(turnHandle(at, 0, 10), [110, -10]));
});

test('a turned box resizes as a straight one does, in its own frame', () => {
  const at = [0, 0, 100, 50];
  /* Straight: as before -- the corner across stays, the shape is kept. */
  assert.ok(near(resizeCorner(at, 0, 2, { x: 200, y: 60 }), [0, 0, 200, 100]));
  assert.ok(near(resizeSide(at, 0, 1, { x: 150, y: 999 }), [0, 0, 150, 50]));
  assert.ok(near(resizeSide(at, 0, 3, { x: 500, y: 0 }), [96, 0, 4, 50]), 'never thinner than 4');
  /* A quarter turn: the corner across from the one dragged stays where it is on the map. */
  const fixed = turnedCorners(at, 90)[0], to = turnedCorners(at, 90)[2];
  const nb = resizeCorner(at, 90, 2, { x: to[0] - 50, y: to[1] + 10 });
  assert.ok(near(turnedCorners(nb, 90)[0], fixed, 1e-6));
  assert.ok(Math.abs(nb[2] / nb[3] - 2) < 1e-9, 'in proportion');
  const side = resizeSide(at, 90, 1, { x: 50, y: 125 });
  assert.ok(near(turnedCorners(side, 90)[0], fixed, 1e-6));
  assert.ok(near([side[2], side[3]], [150, 50]));
});

test('a picture keeps its turn, and blocks people where it is, turned', () => {
  const doc = structuredClone(legacy);
  const m = doc.maps[0];
  const item = { id: 'turned-test', name: 'Turned', image: { ...m.image, at: [100, 100, 200, 20], turn: 90, blocks: true }, do: { kind: 'none' } };
  m.items = [...(m.items ?? []), item];
  assert.ok(!validate(doc).some((e) => /turned-test/.test(e)), validate(doc).filter((e) => /turned-test/.test(e)).join('; '));
  const wall = wallsOf(m).at(-1);
  assert.equal(wall.t, 'poly');
  assert.ok(covers(wall, 200, 190) && !covers(wall, 120, 110), 'stood up on its end, not lying as it was');
  item.image.turn = 'sideways';
  assert.ok(validate(doc).some((e) => /turn is degrees/.test(e)));
  const hoon = read('../../../desk/lib/glurff-world.hoon');
  assert.match(hoon, /image turn is degrees, -360 to 360/);
  assert.match(hoon, /\?:  \?&\(\?=\(\^ turn\) !=\(zero u\.turn\)\)  ~/, 'the ship leaves a turned one to the editor');
});

test('the game draws a placed picture turned', () => {
  const game = read('./game.js');
  assert.match(game, /s\.rotation = \(it\.turn \* Math\.PI\) \/ 180;/);
  assert.match(game, /ctx\.rotate\(\(p\.turn \* Math\.PI\) \/ 180\)/, 'and in the ground the foreground is cut from');
  assert.match(read('./places.js'), /turn: normalTurn\(it\.image\.turn\)/);
});

test('the editor: pictures and pasted drawing turn, pasted drawing stretches', () => {
  const ed = read('../editor/editor.js');
  assert.match(ed, /if \(s\.turned\) \{ const h = turnedHandleAt\(s\.turned, p\); return h && \{ \.\.\.h, s \}; \}/);
  assert.match(ed, /if \(d\.turning\) s\.place\(at, turnBy\(at, turn, d\.from, p, !!e\?\.shiftKey\)\);/);
  assert.match(ed, /if \(d\.turning\) \{ f\.turn = turnBy\(at, turn, d\.from, p, !!e\?\.shiftKey\); return; \}/);
  assert.match(ed, /resizeSide\(at, turn, d\.side, p, 1 \/ kx\)/, 'a paste stretches from its sides');
  assert.match(ed, /\{ flip: f\.flip, smooth: !S\.paintHard, turn: f\.turn \}/);
  assert.match(ed, /'Straighten'/);
  assert.match(read('../editor/paint-layer.js'), /if \(turn\) g\.rotate\(\(turn \* Math\.PI\) \/ 180\);/);
});

test('the editor: W A S D slide the map, + and - zoom', () => {
  const ed = read('../editor/editor.js');
  assert.match(ed, /const PAN_KEYS = \{ w: \[0, -1\], a: \[-1, 0\], s: \[0, 1\], d: \[1, 0\] \};/);
  assert.match(ed, /if \(PAN_KEYS\[k\]\) return holdPan\(k\);/);
  assert.match(ed, /if \(e\.key === '\+' \|\| e\.key === '='\) return zoomKey\(1\.25\);/);
  assert.match(ed, /if \(e\.key === '-' \|\| e\.key === '_'\) return zoomKey\(1 \/ 1\.25\);/);
  assert.match(ed, /window\.addEventListener\('blur', \(\) => held\.clear\(\)\);/);
  /* None of them a tool's key. */
  const tools = ed.match(/const tool = \{([^}]*)\}\[k\]/)[1];
  for (const k of 'wasd') assert.doesNotMatch(tools, new RegExp(`\\b${k}:`));
});

test('the editor: where an NPC walks is set with nothing else in the way', () => {
  const ed = read('../editor/editor.js');
  assert.match(ed, /if \(S\.walkBox\) return walkBoxDown\(p\);/);
  assert.match(ed, /if \(S\.walkBox\) return box\.replaceChildren\(walkBoxBar\(roamer\(\)\)\);/);
  assert.match(ed, /'Set where it walks…'/);
  assert.match(ed, /if \(on\) walkBoxStart\(it\);/, 'ticking it goes straight there');
  assert.match(ed, /if \(S\.walkBox && e\.key === 'Escape'\) return walkBoxDone\(\);/);
  assert.match(ed, /S\.drag\?\.roaming\) return box\.replaceChildren\(\)/, 'its card steps aside while the box is dragged');
});

test('a door leads to another door on this Glurff; the way in says where to', () => {
  assert.match(read('../editor/editor.js'), /'to another door on this Glurff'/);
  assert.match(read('../../index.html'), /<p class="loading-to">Traveling to<\/p>\s*<h1 class="loading-name">/);
  assert.match(read('../../public/style.css'), /\.loading-quiet \.loading-to \{ display: none; \}/);
  assert.match(read('../../public/loading.js'), /card\.style\.setProperty\('--title-h'/);
});
