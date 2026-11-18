/* 2026-11-17: a ship opened over plain http://. Browsers give crypto.randomUUID
 * only to a secure page, and the page called it while starting, so on http://
 * the loading screen froze for good (~hacpen-davnym: "Cannot access 'xe' before
 * initialization", over and over). Now every random label comes from
 * lib/fresh-id, which works on any page, and the page says once what http://
 * leaves out (public/loading.js, ui/insecure-notice). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshId, freshIds } from '../lib/fresh-id.js';
import { createRoomEvents } from '../lib/room-events.js';
import { createPolls } from '../lib/polls.js';
import { insecureNoticeDue, INSECURE_SEEN_KEY, INSECURE_TITLE, INSECURE_DETAIL } from '../ui/insecure-notice.js';

const SRC = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/* The browser's crypto as an http:// page has it: random numbers, no randomUUID. */
function insecureCrypto(fn) {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const webcrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true,
    get: () => ({ getRandomValues: (b) => webcrypto.getRandomValues(b) }) });
  try { return fn(); } finally { Object.defineProperty(globalThis, 'crypto', real); }
}

test('a fresh label is the browser\'s own where it has one', () => {
  assert.equal(freshId({ randomUUID: () => 'from-the-browser' }), 'from-the-browser');
  assert.match(freshId(), UUID);
});

test('without randomUUID, a label of the same shape, from random numbers or at worst Math.random', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const a = freshId({ getRandomValues: (b) => globalThis.crypto.getRandomValues(b) });
    assert.match(a, UUID);
    seen.add(a);
  }
  assert.equal(seen.size, 2000);
  assert.match(freshId({}), UUID);
  assert.match(freshId(undefined), UUID);
  assert.match(freshId(null), UUID);
});

test('chat, rolls and polls make their labels on an http:// page', () => {
  insecureCrypto(() => {
    assert.equal(globalThis.crypto.randomUUID, undefined);
    assert.match(freshIds.randomUUID(), UUID);
    const sent = [];
    const events = createRoomEvents({ our: '~zod', room: () => 1, peers: () => ['~nec'], send: (...a) => sent.push(a) });
    events.chat('hello');
    events.roll({ count: 1, sides: 6, mod: 0 }, [4]);
    const polls = createPolls({ our: '~zod', send: (e) => sent.push([e]) });
    const poll = polls.start(1, { question: 'Pizza?', options: ['Yes', 'No'] });
    assert.match(poll.id, UUID);
    assert.ok(sent.length >= 3, 'chat, roll and poll were sent');
    for (const s of sent) {
      const ids = JSON.stringify(s).match(/"id":"([^"]+)"/g) ?? [];
      for (const m of ids) assert.match(m.slice(6, -1), UUID);
    }
  });
});

test('nothing but lib/fresh-id asks the browser for randomUUID', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(path.join(SRC, dir))) {
      const rel = path.join(dir, name);
      if (fs.statSync(path.join(SRC, rel)).isDirectory()) { walk(rel); continue; }
      if (!rel.endsWith('.js') || rel.endsWith('.test.js') || rel === path.join('lib', 'fresh-id.js')) continue;
      if (/crypto\s*\??\.\s*randomUUID/.test(read(rel))) offenders.push(rel);
    }
  };
  walk('.');
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(read('main.js'), /crypto\.randomUUID/);
});

test('the card is due only on an insecure page, until "Got it"', () => {
  const store = (v) => ({ v, getItem(k) { return k === INSECURE_SEEN_KEY ? this.v : null; }, setItem(k, x) { if (k === INSECURE_SEEN_KEY) this.v = x; } });
  assert.equal(insecureNoticeDue({ secure: true, storage: store(null) }), false);
  assert.equal(insecureNoticeDue({ secure: undefined, storage: store(null) }), false);
  assert.equal(insecureNoticeDue({ secure: false, storage: store(null) }), true);
  assert.equal(insecureNoticeDue({ secure: false, storage: store('1') }), false);
  /* A browser that will not remember: shown each visit, never a crash. */
  assert.equal(insecureNoticeDue({ secure: false, storage: null }), true);
  assert.equal(insecureNoticeDue({ secure: false, storage: { getItem() { throw new Error('blocked'); } } }), true);
});

test('what the card says, and where it is shown', () => {
  assert.equal(INSECURE_TITLE, 'Calls are off in this browser.');
  assert.equal(INSECURE_DETAIL, 'Your ship is open over http://, so your browser blocks the microphone and camera. '
    + 'You can walk around, chat and play as normal. To use voice, video and screen sharing, open your ship at its https:// address.');
  const notice = read('ui/insecure-notice.js');
  assert.match(notice, />Got it</);
  assert.doesNotMatch(notice, /addEventListener|onkeydown|onpointerdown|onmousedown/, 'only "Got it" closes it');
  /* Shown once we land, not under the loading screen, and not on a playtest. */
  const main = read('main.js');
  assert.match(main, /onLand: \(\) => \{ if \(!WORLD_PREVIEW\) void showInsecureNotice\(\); \}/);
  const loading = read('ui/loading.js');
  assert.match(loading, /if \(!arrived\) \{ arrived = true; try \{ onLand\(\); \} catch \{\} \}/);
  /* The line on the loading screen, from the first paint, by the plain script. */
  const screen = fs.readFileSync(path.join(SRC, '../public/loading.js'), 'utf8');
  assert.match(screen, /window\.isSecureContext === false && !plain/);
  assert.match(screen, /Opened over http: voice, video and screen sharing are off\./);
});
