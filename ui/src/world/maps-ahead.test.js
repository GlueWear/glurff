/* 2026-11-11: the maps ahead (world/ahead), the picture queue giving way
 * (world/picture-queue, main.js), and Pixi in a file of its own
 * (vite.config.js). Renewing passes less often is tested in
 * implementation/asking-less. */
import './test-world.js';   //  the world, set before anything reads it
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapsAhead, fetchWhole, AHEAD_BUDGET, AHEAD_DOORS, AHEAD_WAIT_MS } from './ahead.js';
import { createPictureQueue } from './picture-queue.js';
import { SCENE_IDS, sceneImages, scenePaintTiles, assetBytes } from './places.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

/* A Glurff of seven maps: a -> b -> c -> d -> e, a -> f, and g no door reaches. */
const DOORS = { a: ['b', 'f'], b: ['a', 'c'], c: ['b', 'd'], d: ['c', 'e'], e: ['d'], f: ['a'], g: [] };
const ids = Object.keys(DOORS), neighbours = (s) => DOORS[s];

test('a small Glurff comes whole, nearest doors first; a big one two doors ahead, topped up as you go', () => {
  assert.equal(AHEAD_BUDGET, 3 * 1024 * 1024);
  assert.equal(AHEAD_DOORS, 2);
  assert.deepEqual(mapsAhead('a', { ids, neighbours, whole: true }), ['b', 'f', 'c', 'd', 'e', 'g']);
  assert.deepEqual(mapsAhead('a', { ids, neighbours, whole: false }), ['b', 'f', 'c']);
  assert.deepEqual(mapsAhead('c', { ids, neighbours, whole: false }), ['b', 'd', 'a', 'e']);
  assert.deepEqual(mapsAhead('g', { ids, neighbours, whole: false }), [], 'nothing reached from a map with no doors');
  assert.deepEqual(mapsAhead('g', { ids, neighbours, whole: true }), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('whole or not is the pictures together, each counted once', () => {
  const w = { x: 2_000_000, y: 1_000_000, z: 500_000 };
  assert.equal(fetchWhole(['x', 'y', 'x', 'y'], (u) => w[u]), true, 'a picture two maps share is one picture');
  assert.equal(fetchWhole(['x', 'y', 'z'], (u) => w[u]), false);
  assert.equal(fetchWhole(['x', 'y', 'z'], (u) => w[u], 4_000_000), true);
  /* The official Glurff (its old copy, as the tests have it) is fetched whole. */
  const all = SCENE_IDS.flatMap((s) => [...Object.values(sceneImages(s)).filter(Boolean), ...scenePaintTiles(s).map((t) => t.url)]);
  assert.ok(all.every((u) => assetBytes(u) > 0), 'every picture weighed from the document');
  assert.equal(fetchWhole(all, assetBytes), true);
});

/* A queue whose fetches finish when the test says. */
function harness() {
  const started = [], pending = new Map();
  const q = createPictureQueue({ fetch: (url) => { started.push(url); return new Promise((ok) => pending.set(url, ok)); } });
  const finish = async (url) => { pending.get(url)(`tex:${url}`); pending.delete(url); await tick(); await tick(); };
  return { q, started, pending, finish };
}

test('pictures for later wait while held, then go one at a time, and only when nothing is needed now', async () => {
  const { q, started, finish } = harness();
  q.ahead(['b1', 'b2', 'c1']);
  await tick();
  assert.deepEqual(started, [], 'held until the page lets go');
  q.hold(false);
  await tick();
  assert.deepEqual(started, ['b1'], 'one at a time');
  const now = q.picture('a1', true);
  q.picture('a2', true); q.picture('a3', true);
  await tick();
  assert.deepEqual(started, ['b1', 'a1'], 'needed now: up to two at once, beside the one for later on its way');
  await finish('b1');
  assert.deepEqual(started, ['b1', 'a1', 'a3'], 'the newest needed-now next; nothing for later while any wait');
  await finish('a1');
  assert.equal(await now, 'tex:a1');
  await finish('a3');
  assert.deepEqual(started.slice(3), ['a2']);
  await finish('a2');
  assert.deepEqual(started.slice(4), ['b2'], 'for later again, once nothing is needed now');
  q.hold(true);
  await finish('b2');
  assert.equal(started.length, 5, 'held again: c1 waits (joining a call)');
  q.hold(false);
  await tick();
  assert.deepEqual(started.slice(5), ['c1']);
});

test('walking into a map not in yet hurries its pictures; maps no longer ahead are dropped, and asked for again if needed', async () => {
  const { q, started, finish } = harness();
  q.hold(false);
  const got = [];
  q.ahead(['b1', 'c1', 'd1'], (url) => got.push(url));
  await tick();
  assert.deepEqual(got, ['b1', 'c1', 'd1']);
  assert.deepEqual(started, ['b1']);
  const d = q.picture('d1', true);                              //  through the door to d
  await tick();
  assert.deepEqual(started, ['b1', 'd1'], 'd1 jumps the queue');
  q.ahead(['e1', 'c1'], (url) => got.push(url));                //  from d: e and c ahead, b behind us
  await finish('b1');
  assert.deepEqual(started.slice(2), [], 'nothing for later while d1 is needed');
  await finish('d1');
  assert.equal(await d, 'tex:d1');
  assert.deepEqual(started.slice(2), ['e1'], 'the new order: e1 before c1');
  assert.deepEqual(got.slice(3), ['e1'], 'only e1 was newly asked for');
  const again = q.picture('x1');                               //  a picture asked for twice is one fetch
  assert.equal(q.picture('x1'), again);
});

test('the page holds the maps ahead while it joins a call or has no pass, at most AHEAD_WAIT_MS at a stretch', () => {
  assert.equal(AHEAD_WAIT_MS, 30000);
  const main = read('../main.js');
  assert.match(main, /import \{ Game, startZoom, holdAhead \} from 'world\/game';/);
  assert.match(main, /const JOINING=new Set\(\['requesting','transitioning','connecting'\]\);/);
  assert.match(main, /holdAhead\(JOINING\.has\(R\.rooms\.voice\)\|\|\(passlessSince!==null&&Date\.now\(\)-passlessSince<AHEAD_WAIT_MS\)\);/);
  assert.match(main, /ticker=setInterval\(\(\)=>\{\n  checkAsleep\(\);\n  giveWay\(\);/);
  const game = read('./game.js');
  assert.match(game, /const PICTURES_AT_ONCE = 2;\nconst AHEAD_AT_ONCE = 1;/);
  assert.match(game, /this\.whole = fetchWhole\(SCENE_IDS\.flatMap\(paintings\), assetBytes\);/);
  assert.match(game, /setTimeout\(\(\) => queue\.unheld\(\), AHEAD_WAIT_MS\);/);
  assert.match(game, /if \(next !== previous\) this\.fetchAhead\(next\);/);
  assert.doesNotMatch(game, /laterMaps/);
});

test('Pixi is its own published file, named by its version, so an update sends only our code', () => {
  const vite = read('../../vite.config.js');
  assert.match(vite, /const PIXI_FILE = `assets\/pixi-\$\{PIXI_VERSION\.replace\(\/\\\.\/g, '-'\)\}\.js`;/);
  assert.match(vite, /external: \['pixi\.js'\], output: \{ paths: \{ 'pixi\.js': `\/apps\/glurff\/\$\{PIXI_FILE\}` \} \}/);
  assert.match(vite, /source: fs\.readFileSync\('node_modules\/pixi\.js\/dist\/pixi\.min\.mjs'\)/);
  assert.doesNotMatch(vite, /manualChunks/);
});
