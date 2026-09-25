import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyFromCharge, reduceDependency } from '../lib/dependency-state.js';
import { createDependencyWatch } from '../lib/dependency-watch.js';

test('Docket charge states distinguish an installed dependency from progress and failure', () => {
  assert.deepEqual(dependencyFromCharge(null), { status: 'missing' });
  assert.deepEqual(dependencyFromCharge({ chad: { install: null } }), { status: 'installing' });
  assert.deepEqual(dependencyFromCharge({ chad: { site: null } }), { status: 'ready' });
  assert.deepEqual(dependencyFromCharge({ chad: { glob: null } }), { status: 'ready' });
  assert.deepEqual(dependencyFromCharge({ chad: { hung: 'bad desk' } }),
    { status: 'failed', error: 'bad desk' });
});

test('only Noltbook Docket facts change the dependency state', () => {
  let state = { status: 'checking' };
  state = reduceDependency(state, { initial: { glurff: { chad: { site: null } } } });
  assert.deepEqual(state, { status: 'missing' });
  state = reduceDependency(state, { 'add-charge': { desk: 'other', charge: { chad: { site: null } } } });
  assert.deepEqual(state, { status: 'missing' });
  state = reduceDependency(state, { 'add-charge': { desk: 'noltbook', charge: { chad: { install: null } } } });
  assert.deepEqual(state, { status: 'installing' });
  state = reduceDependency(state, { 'add-charge': { desk: 'noltbook', charge: { chad: { site: null } } } });
  assert.deepEqual(state, { status: 'ready' });
  state = reduceDependency(state, { 'del-charge': 'noltbook' });
  assert.deepEqual(state, { status: 'missing' });
});

test('dependency watcher scries the current charges because the watch has no initial fact', async () => {
  let watched = null;
  const client = {
    subscribe: async (options) => { watched = options; return 7; },
    scry: async () => ({ initial: {} }),
    unsubscribe: async () => {},
  };
  const watch = createDependencyWatch({ client, send: async () => {} });
  await new Promise((resolve) => {
    const off = watch.on((state) => {
      if (state.status === 'checking') return;
      off(); resolve();
    });
  });
  assert.equal(watch.state.status, 'missing');
  assert.equal(watched.app, 'docket');
  assert.equal(watched.path, '/charges');
  watch.close();
});

test('a charge delta that races the snapshot is replayed after it', async () => {
  let event = null, release;
  const snapshot = new Promise((resolve) => { release = resolve; });
  const client = {
    subscribe: async (options) => { event = options.event; return 8; },
    scry: async () => snapshot,
    unsubscribe: async () => {},
  };
  const watch = createDependencyWatch({ client, send: async () => {} });
  await Promise.resolve();
  event({ 'add-charge': { desk: 'noltbook', charge: { chad: { site: null } } } });
  release({ initial: {} });
  await new Promise((resolve) => watch.on((state) => state.status === 'ready' && resolve()));
  assert.equal(watch.state.status, 'ready');
  watch.close();
});
