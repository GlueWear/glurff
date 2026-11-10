/* 2026-11-09: the apps on our ship kept from the page's first look at them,
 * and who is talking read from the one place that says. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyCharges } from '../lib/dependency-state.js';
import { createDependencyWatch } from '../lib/dependency-watch.js';

const site = (title) => ({ title, chad: { site: null } });

test('the apps on our ship follow docket: its map, then each add and delete', () => {
  const first = applyCharges(null, { initial: { noltbook: site('Noltbook'), pong: site('Pong') } });
  assert.deepEqual(Object.keys(first).sort(), ['noltbook', 'pong']);
  const added = applyCharges(first, { 'add-charge': { desk: 'chess', charge: site('Chess') } });
  assert.equal(added.chess.title, 'Chess');
  assert.equal(first.chess, undefined, 'the map before is left as it was');
  const gone = applyCharges(added, { 'del-charge': 'pong' });
  assert.deepEqual(Object.keys(gone).sort(), ['chess', 'noltbook']);
  assert.equal(applyCharges(gone, { 'del-charge': 'nothing' }), gone, 'deleting what is not there changes nothing');
  assert.equal(applyCharges(null, { 'add-charge': { desk: 'chess', charge: site('Chess') } }), null, 'nothing before the map itself');
});

test('the watch keeps every app, changes that raced its first look included', async () => {
  let event;
  const client = {
    subscribe: async ({ event: e }) => { event = e; return 1; },
    scry: async () => { event({ 'add-charge': { desk: 'chess', charge: site('Chess') } }); return { initial: { noltbook: site('Noltbook') } }; },
    unsubscribe: async () => {},
  };
  const watch = createDependencyWatch({ client, send: async () => {} });
  const seen = [];
  watch.onCharges((all) => seen.push(Object.keys(all).sort().join(',')));
  assert.equal(watch.charges(), null, 'nothing until docket has said');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(Object.keys(watch.charges()).sort(), ['chess', 'noltbook']);
  assert.equal(watch.state.status, 'ready');
  event({ 'del-charge': 'chess' });
  assert.deepEqual(Object.keys(watch.charges()), ['noltbook']);
  assert.deepEqual(seen, ['chess,noltbook', 'noltbook']);
  watch.close();
});

test('a call says who is talking from one levels(), a Map by ship', () => {
  /* A second levels() further down the class -- each ship's playback volume,
   * as an object -- replaced this one, and the ring round a talking tile
   * never lit (lib/rooms reads a Map). */
  const src = readFileSync(new URL('../lib/sfu.js', import.meta.url), 'utf8');
  assert.equal(src.match(/^ {2}levels\(\) \{/gm)?.length, 1);
  assert.match(src, /levels\(\) \{\n {4}const out = new Map\(\);/);
});
