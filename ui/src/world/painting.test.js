/* A MAP'S PAINTING (2026-11-08): what the document takes for it, and the
 * painting layer's own arithmetic -- the same colour joined from a point,
 * a stroke's opacity, colours turned round the wheel. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, paintDims, PAINT_TILE } from './world-doc.js';
import legacy from './legacy-world.js';
import { floodRegion, blendInto, topUp, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from '../editor/paint-layer.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const hash = (c) => c.repeat(64);
const tile = { mime: 'image/png', size: 900, w: PAINT_TILE, h: PAINT_TILE };
const painted = (change = () => {}) => {
  const d = clone(legacy);
  d.assets[hash('c')] = { ...tile }; d.assets[hash('d')] = { ...tile };
  d.maps[0].paint = { w: 600, h: 400, size: [600, 400], tiles: [{ c: 0, r: 0, src: hash('c') }, { c: 1, r: 0, src: hash('d') }] };
  change(d);
  return validate(d);
};
const refuses = (change, pattern) => {
  const errors = painted(change);
  assert.ok(errors.some((e) => pattern.test(e)), `wanted ${pattern}, got ${JSON.stringify(errors)}`);
};

test('a painting is PNG tiles inside its size', () => {
  assert.deepEqual(painted(), []);
  refuses((d) => { d.maps[0].paint.tiles[1].c = 2; }, /tile outside it/);
  refuses((d) => { d.maps[0].paint.tiles[1].c = 0; }, /repeats a tile/);
  refuses((d) => { d.assets[hash('c')].mime = 'image/jpeg'; }, /not a PNG/);
  refuses((d) => { d.assets[hash('c')].w = 256; }, /512 pixels square/);
  refuses((d) => { d.maps[0].paint.w = 5000; }, /at most 4096/);
  refuses((d) => { d.maps[0].paint.size = [600]; }, /size it covers/);
  refuses((d) => { d.maps[0].paint.tiles[0].src = hash('e'); }, /missing from the assets table/);
  refuses((d) => { d.maps[0].paint.tiles = []; }, /nothing uses it/);
});

test('a painting is at most 4096 a side, in proportion', () => {
  assert.deepEqual(paintDims([2400, 1600]), { w: 2400, h: 1600 });
  assert.deepEqual(paintDims([16384, 8192]), { w: 4096, h: 2048 });
  assert.deepEqual(paintDims([5000, 30]), { w: 4096, h: 25 });
});

/* 4 x 3: two red columns, two blue -- and a red pixel only corner to corner
 * with the red, which a fill does not reach. */
const picture = () => {
  const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], d = new Uint8ClampedArray(4 * 3 * 4);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) d.set(x < 2 ? red : blue, (y * 4 + x) * 4);
  d.set(red, (0 * 4 + 3) * 4);
  d.set([0, 0, 255, 255], (1 * 4 + 1) * 4);
  return d;
};
test('fill joins the same colour, side to side, as near as the tolerance says', () => {
  const f = floodRegion(picture(), 4, 3, 0, 0, 0);
  assert.equal(f.region.reduce((n, v) => n + v, 0), 5, 'the left two columns but the blue pixel among them');
  assert.equal(f.region[3], 0, 'the red pixel only corner to corner is not reached');
  assert.deepEqual(f.box, [0, 0, 2, 3]);
  assert.equal(floodRegion(picture(), 4, 3, 0, 0, 255).region.reduce((n, v) => n + v, 0), 12, 'everything, at full tolerance');
  assert.equal(floodRegion(picture(), 4, 3, 9, 0, 0), null, 'outside the picture');
});

test('a stroke at half opacity is half, however often it passes', () => {
  const d = new Uint8ClampedArray(4);
  blendInto(d, 0, [255, 0, 0], topUp(0.5, 0, 0.5));
  blendInto(d, 0, [255, 0, 0], topUp(0.5, 0.5, 1));
  assert.deepEqual([...d], [255, 0, 0, 128]);
  assert.equal(topUp(0.5, 1, 1), 0, 'a pixel already covered takes no more');
  const over = new Uint8ClampedArray([0, 0, 255, 255]);
  blendInto(over, 0, [255, 255, 255], 0.5);
  assert.deepEqual([...over], [128, 128, 255, 255]);
});

test('colours go round the wheel and back', () => {
  for (const hex of ['#ff8000', '#1b1e28', '#ffffff', '#000000', '#3a7d44']) {
    const [h, s, v] = rgbToHsv(hexToRgb(hex));
    assert.equal(rgbToHex(hsvToRgb(h, s, v)), hex);
  }
});
