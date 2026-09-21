import test from 'node:test';
import assert from 'node:assert/strict';
import main from './map-data.js';
import vatican from './vatican-data.js';
import { POOL_CHECKPOINTS, PLANT, MAIN_RETURN } from './secret-room.js';

const bytes = encoded => Buffer.from(encoded, 'base64');
const marked = (encoded, index) => {
  const data = bytes(encoded);
  return index >= 0 && Boolean(data[index >> 3] & (1 << (index & 7)));
};
const cell = (map, x, y) => {
  const tile = map.tile ?? 32;
  const cx = Math.floor(x * tile / map.cell), cy = Math.floor(y * tile / map.cell);
  if (cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows) return -1;
  return cy * map.cols + cx;
};
const solid = (map, x, y) => {
  const at = cell(map, x, y);
  return at < 0 || marked(map.solid, at);
};
const solidPixel = (map, x, y) => solid(map, x / map.tile, y / map.tile);
const centre = b => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

test('all game-room checkpoints, plant and return point are reachable floor', () => {
  for (const point of [...POOL_CHECKPOINTS.map(centre), centre(PLANT), MAIN_RETURN]) {
    assert.equal(solid(main, point.x, point.y), false, `${point.x},${point.y}`);
  }
});

test('the hidden spawn and supplied exit are connected by walkable floor', () => {
  const start = cell(vatican, vatican.spawn[0] / vatican.tile, vatican.spawn[1] / vatican.tile);
  assert.ok(start >= 0 && !marked(vatican.solid, start));
  const seen = new Set([start]), queue = [start];
  let reachedExit = marked(vatican.exit, start);
  while (queue.length && !reachedExit) {
    const at = queue.shift(), x = at % vatican.cols, y = Math.floor(at / vatican.cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * vatican.cols + nx;
      if (nx < 0 || ny < 0 || nx >= vatican.cols || ny >= vatican.rows ||
          seen.has(next) || marked(vatican.solid, next)) continue;
      seen.add(next);
      queue.push(next);
      if (marked(vatican.exit, next)) reachedExit = true;
    }
  }
  assert.equal(reachedExit, true);
});

test('narrow Vatican doorways retain continuous walkable centre lines', () => {
  assert.equal(vatican.cell, 2);
  const vertical = [
    [362, 402, 442],
    [362, 588, 640],
  ];
  for (const [x, y0, y1] of vertical) {
    for (let y = y0; y < y1; y += vatican.cell) {
      assert.equal(solidPixel(vatican, x, y), false, `blocked at ${x},${y}`);
    }
  }

  const horizontal = [
    [787, 296, 312],
    [835, 296, 312],
    [887, 296, 312],
  ];
  for (const [y, x0, x1] of horizontal) {
    for (let x = x0; x < x1; x += vatican.cell) {
      assert.equal(solidPixel(vatican, x, y), false, `blocked at ${x},${y}`);
    }
  }
});

test('hidden coordinates fit the existing frontend movement envelope', () => {
  assert.ok(vatican.width / vatican.tile < 64);
  assert.ok(vatican.height / vatican.tile < 46);
});
