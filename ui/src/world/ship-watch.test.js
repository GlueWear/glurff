/* 2026-11-14: no ship, no world (lib/ship-watch, main.js). A page that is
 * signed out of its ship leaves the world at once; one whose ship has gone
 * leaves after SHIP_GONE_MS and comes back when it answers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createShipWatch, probeShip, PROBE_MS, RECHECK_MS, SHIP_GONE_MS, GONE_TRIES, PROBE_PATH } from '../lib/ship-watch.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/* Timers that run when the test says; `jump` moves the clock without running
 * any, as a sleeping laptop does. */
function harness(answers = []) {
  let t = 1_000_000, seq = 0;
  const timers = [], events = [], asked = [];
  const w = createShipWatch({
    probe: async () => { asked.push(t); return answers.length ? answers.shift() : 'ok'; },
    onSignedOut: () => events.push(['signed-out', t]),
    onGone: () => events.push(['gone', t]),
    onBack: () => events.push(['back', t]),
    now: () => t,
    later: (fn, ms) => { const id = ++seq; timers.push({ id, at: t + ms, fn }); return id; },
    cancel: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = async (ms) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > end) break;
      const next = timers.shift();
      t = Math.max(t, next.at);
      next.fn();
      await flush();
    }
    t = end;
  };
  return { w, events, asked, answers, timers, advance, jump: (ms) => { t += ms; }, now: () => t };
}

test('one ask of our own ship: signed in, signed out, or not there', async () => {
  const seen = [];
  const answer = (status, type = 'basic') => async (path, opts) => { seen.push([path, opts]); return { status, ok: status >= 200 && status < 300, type }; };
  assert.equal(await probeShip({ fetch: answer(200) }), 'ok');
  assert.equal(await probeShip({ fetch: answer(401) }), 'refused', 'a revoked session (Eyre: "bad session auth")');
  assert.equal(await probeShip({ fetch: answer(403) }), 'refused', 'no session at all');
  assert.equal(await probeShip({ fetch: answer(0, 'opaqueredirect') }), 'refused', 'a login wall');
  assert.equal(await probeShip({ fetch: answer(502) }), 'unreachable', "a stopped ship behind Manor's proxy");
  assert.equal(await probeShip({ fetch: answer(500) }), 'unreachable');
  assert.equal(await probeShip({ fetch: async () => { throw new TypeError('Failed to fetch'); } }), 'unreachable');
  assert.equal(PROBE_PATH, '/~/scry/glurff/lease.json', 'a scry: nothing is written on the ship');
  const [path, opts] = seen[0];
  assert.equal(path, PROBE_PATH);
  assert.equal(opts.cache, 'no-store');
  assert.equal(opts.redirect, 'manual');
  assert.equal(opts.credentials, 'same-origin');
  assert.ok(opts.signal, 'never waits forever');
  /* Safari before 16: no AbortSignal.timeout. Asked without one, never failed for it. */
  const timeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = undefined;
    assert.equal(await probeShip({ fetch: answer(200) }), 'ok');
    assert.equal(seen.at(-1)[1].signal, undefined);
  } finally { AbortSignal.timeout = timeout; }
});

test('signed out: two refusals running and we leave at once, and stop asking', async () => {
  const h = harness(['ok']);
  h.w.start();
  await h.advance(PROBE_MS);
  assert.deepEqual(h.events, []);
  h.answers.push('refused', 'refused');
  const revoked = h.now();
  await h.advance(PROBE_MS);
  assert.deepEqual(h.events, [], 'one refusal is checked again first');
  await h.advance(RECHECK_MS);
  assert.deepEqual(h.events.map((e) => e[0]), ['signed-out']);
  assert.equal(h.events[0][1] - revoked, PROBE_MS + RECHECK_MS);
  assert.equal(h.timers.length, 0, 'nothing more to ask');
  h.w.start();
  assert.equal(h.timers.length, 0, 'and it does not start again');
  assert.equal(h.w.state().left, 'signed-out');
});

test('a channel failing asks at once, so a revoked login is noticed in seconds', async () => {
  const h = harness(['refused', 'refused']);
  h.w.start();
  h.w.nudge();
  await h.advance(0);
  await h.advance(RECHECK_MS);
  assert.deepEqual(h.events.map((e) => e[0]), ['signed-out']);
  assert.ok(h.events[0][1] - 1_000_000 <= RECHECK_MS);
});

test('one refusal then an answer is nothing', async () => {
  const h = harness(['refused', 'ok', 'ok']);
  h.w.start();
  await h.advance(PROBE_MS + RECHECK_MS + PROBE_MS);
  assert.deepEqual(h.events, []);
  assert.equal(h.w.state().refusals, 0);
});

test('a ship gone two minutes: we leave, keep asking, and come back when it answers', async () => {
  const h = harness(Array(20).fill('unreachable'));
  h.w.start();
  await h.advance(PROBE_MS);
  const first = h.now();
  await h.advance(SHIP_GONE_MS - PROBE_MS);
  assert.deepEqual(h.events, [], 'a slow ship -- 36 s stalls, say -- is never thrown out');
  await h.advance(PROBE_MS);
  assert.deepEqual(h.events.map((e) => e[0]), ['gone']);
  assert.equal(h.events[0][1] - first, SHIP_GONE_MS, 'counted from the first failure');
  assert.ok(h.w.state().failures >= GONE_TRIES);
  const asked = h.asked.length;
  await h.advance(PROBE_MS * 3);
  assert.equal(h.asked.length, asked + 3, 'still asking');
  assert.deepEqual(h.events.map((e) => e[0]), ['gone'], 'and leaving only once');
  h.answers.length = 0;
  await h.advance(PROBE_MS);
  assert.deepEqual(h.events.map((e) => e[0]), ['gone', 'back']);
  assert.equal(h.timers.length, 0, 'coming back reloads the page: nothing left to ask');
});

test('waking a laptop is not a ship that went away; an answer in between starts the count again', async () => {
  const h = harness(['ok', 'unreachable', 'ok']);
  h.w.start();
  await h.advance(PROBE_MS);
  h.jump(60 * 60 * 1000);            //  an hour asleep: no timer ran
  await h.advance(0);                //  the overdue ask, as the network wakes
  assert.deepEqual(h.events, [], 'an hour since the last answer, but one failure');
  assert.equal(h.w.state().failures, 1);
  await h.advance(PROBE_MS);
  assert.equal(h.w.state().failures, 0);
  assert.equal(h.w.state().failingSince, null);
  h.answers.push(...Array(GONE_TRIES - 1).fill('unreachable'), 'ok', ...Array(GONE_TRIES).fill('unreachable'));
  await h.advance(PROBE_MS * (2 * GONE_TRIES));
  assert.deepEqual(h.events, [], 'failures either side of an answer are not added together');
});

test('gone, then back without our login: signed out', async () => {
  const h = harness([...Array(9).fill('unreachable'), 'refused', 'refused']);
  h.w.start();
  await h.advance(PROBE_MS * 10 + RECHECK_MS);
  assert.deepEqual(h.events.map((e) => e[0]), ['gone', 'signed-out']);
  assert.equal(h.timers.length, 0);
});

test('stopped, it asks nothing more', async () => {
  const h = harness();
  h.w.start();
  h.w.stop();
  await h.advance(PROBE_MS * 4);
  assert.equal(h.asked.length, 0);
  h.w.nudge();
  await h.advance(0);
  assert.equal(h.asked.length, 0, 'a nudge does not restart it');
});

test('the page: watched from when the world is up; leaving says why; the channel nudges', () => {
  const main = read('../main.js');
  assert.match(main, /import \{ createShipWatch \} from 'lib\/ship-watch';/);
  assert.match(main, /onSignedOut: \(\) => standDown\('signed-out'\),\n  onGone: \(\) => standDown\('ship-gone'\),\n  onBack: \(\) => location\.reload\(\),/);
  assert.match(main, /window\.addEventListener\('glurff-channel-trouble', \(\) => shipWatch\.nudge\(\)\);/);
  assert.match(main, /if \(!WORLD_PREVIEW\) sessionLease\.start\(\);\n  shipWatch\.start\(\);/);
  /* Made before the tab guard, which may stand us down at once. */
  assert.ok(main.indexOf('const shipWatch = createShipWatch') < main.indexOf('const tabGuard = createTabGuard'));
  assert.ok(main.indexOf('const LEFT = {') < main.indexOf('const tabGuard = createTabGuard'));
  /* Only a ship that went away is still watched -- a superseded tab never comes back on its own. */
  assert.match(main, /function standDown\(reason\) \{\n  if \(reason !== 'ship-gone'\) shipWatch\.stop\(\);/);
  assert.match(main, /'signed-out': \['You are signed out of this ship, so Glurff has left the world\.', 'Sign in'\]/);
  assert.match(main, /reason === 'signed-out' \? signIn\(\) : location\.reload\(\)/);
  assert.match(main, /location\.href = '\/~\/login\?redirect=' \+ encodeURIComponent/);
  const conn = read('../lib/connection.js');
  assert.match(conn, /function recover\(\) \{\n    if \(stopped \|\| timer \|\| rebuilding\) return;\n    \/\*[^*]*\*\/\n    try \{ globalThis\.dispatchEvent\?\.\(new Event\('glurff-channel-trouble'\)\); \} catch \{\}/);
});
