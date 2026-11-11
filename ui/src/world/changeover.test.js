/* 2026-11-10, before the changeover: everybody builds (EDIT GLURFF, the note
 * at the first publish); the app carries no map of its own; a host that does
 * not answer is said so, with Try again, and its late answer lets us in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createMovementSession, WORLD_WAIT_MS, WORLD_TERM } from '../lib/movement-session.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a Glurff with a host is its host\'s room or nothing: no room of our own, ever', () => {
  let clock = 0;
  const changes = [];
  const s = createMovementSession({ our: '~zod', now: () => clock, world: '~nolset', onChange: (c, why) => changes.push([c?.host ?? null, c?.term ?? null, why]) });
  s.start(); s.tick();
  assert.deepEqual(s.current(), { host: '~nolset', term: WORLD_TERM, place: s.current().place });
  /* Somebody announces a session of their own, live: it pulls nobody. */
  s.hear('~bus', { host: '~bus', term: 3, live: true, age: 90000 }, clock);
  for (clock = 1000; clock <= 10 * 60 * 1000; clock += 1000) s.tick();
  assert.equal(s.current().host, '~nolset', 'never set aside, never a room of our own');
  assert.ok(changes.every(([host]) => host === '~nolset'), JSON.stringify(changes));
});

test('the host not letting us in is said after WORLD_WAIT_MS; Try again starts over; its answer, however late, ends it', () => {
  let clock = 0;
  const s = createMovementSession({ our: '~zod', now: () => clock, world: '~nolset' });
  s.start(); s.tick();
  s.relay('opening');
  clock = WORLD_WAIT_MS - 1; s.tick();
  assert.equal(s.stuck(), false);
  clock = WORLD_WAIT_MS; s.tick();
  assert.equal(s.stuck(), true);
  s.retry();
  assert.equal(s.stuck(), false, 'asked again: finding, not stuck');
  clock += WORLD_WAIT_MS * 3; s.tick();
  assert.equal(s.stuck(), true);
  s.relay('live');                       //  the pass came, late
  assert.equal(s.stuck(), false);
  assert.equal(s.current().host, '~nolset');
  assert.equal(s.stats().world.stuck, false);
});

test('the page says so, with Try again, and asks the host now', () => {
  const main = read('../main.js');
  assert.match(main, /stuck \? `\$\{WORLD_HOST\} is not answering: nobody can see you move\.`/);
  assert.match(main, /netRetry\.addEventListener\('click', \(\) => \{ movement\?\.retry\?\.\(\); paintConnectivity\(\); \}\);/);
  const mv = read('../lib/movement.js');
  assert.match(mv, /retry\(\) \{\n      if \(!current \|\| !started\) return;\n      session\.retry\?\.\(\);/);
  assert.match(mv, /requestAccess\(true\);/);
  assert.doesNotMatch(read('../lib/movement-session.js'), /WORLD_RETRY_MS|worldFailed/, 'nothing set aside for minutes');
});

test('the app carries no map of its own; the official Glurff is offline like any other', () => {
  const config = read('../lib/world-config.js');
  assert.doesNotMatch(config, /legacy-world/);
  assert.match(config, /export let WORLD_DOC = null;/);
  assert.match(config, /export const assetUrl = \(hash\) => `\/apps\/glurff\/world\/\$\{WORLD_HOST\}\/asset\/\$\{hash\}`;/);
  assert.ok(!existsSync(new URL('../../public/map', import.meta.url)), 'its pictures are not in the app');
  assert.doesNotMatch(read('./game.js'), /isBuiltIn|versioned/);
  const glurffs = read('../lib/glurffs.js');
  assert.match(glurffs, /const offline = !isHere && isOffline\(/);
  assert.match(glurffs, /if \(!r\.waiting && !r\.here\) follow\(r\.host, again\);/);
});

test('everybody builds: EDIT GLURFF on our own card, the editor starts hosting, the note waits for the first publish', () => {
  assert.match(read('../main.js'), /worldEditable = !WORLD_PREVIEW;/);
  const api = read('../editor/host-api.js');
  assert.match(api, /export const start = \(\) => call\('start', \{ method: 'POST' \}, WAIT\.save\);/);
  assert.match(api, /export const setNote = \(id\) => call\(`note\?id=\$\{encodeURIComponent\(id\)\}`/);
  const ed = read('../editor/editor.js');
  assert.match(ed, /if \(!opened\.home\.hosting \|\| !opened\.home\.edit\) \{ await host\.start\(\); opened = await host\.openProject\(\); \}/);
  assert.doesNotMatch(ed, /glurff-operator/, 'no Dojo');
  assert.match(ed, /if \(first\) await makeNote\(\);/);
  assert.match(ed, /action: 'create-note', requestId: rid, data: \{ name \}/);
  assert.match(ed, /path: '\/api\/results'/);
  assert.match(ed, /visibility: 'public'/);
  assert.match(ed, /emptyWorld\(`\$\{host\.ourShip\(\)\}'s Glurff`\)/);
  const hoon = read('../../../desk/app/glurff.hoon');
  assert.match(hoon, /\?:  =\(~\['start'\] rest\)/);
  assert.match(hoon, /=\.  home  \?~\(home `\[\*@ta & ~ ~ ~ ~ ~\] `u\.home\(edit &\)\)/);
  assert.match(hoon, /\[%note ~\]/);
  assert.match(hoon, /\?\.  =\('' note\.u\.home\)  \(out \(error-out 409 ~\['this world has its note already'\]\)\)/);
  assert.match(hoon, /\?:  =\('' note\.u\.home\)  \(out \(error-out 409 ~\['it needs its note first'\]\)\)/);
  assert.match(hoon, /::  Not published yet, and no note: nothing for anybody to see\.\n  \?:  =\('' note\.u\.home\)  ~/);
});

test('a new version, so it reads as one', () => {
  assert.match(read('../../../desk/desk.docket-0'), /version\+\[0 3 0\]/);
});

/* The official Glurff joined on the way in (2026-11-10): its map is refused
 * to somebody not in its note yet, and nothing is shown to press. */
const official = { host: '~nolset', note: 'note-official', name: 'Glurff', live: { release: 1, doc: 'a'.repeat(64) } };
function fakeShip({ admits = true, refuses = false } = {}) {
  const seen = { joins: [], fetches: 0 };
  let member = false;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('/~/channel/') && init.method === 'PUT') {
      for (const a of JSON.parse(init.body)) if (a.json?.action === 'request-join') { seen.joins.push(a.json.data); if (admits) member = true; }
      return { ok: !refuses, status: refuses ? 403 : 204 };
    }
    if (String(url).includes('/asset/')) {
      seen.fetches++;
      const legacy = (await import('./legacy-world.js')).default;
      return member ? { ok: true, status: 200, json: async () => legacy } : { ok: false, status: 403 };
    }
    throw new Error(`unexpected ${url}`);
  };
  return seen;
}

test('the official Glurff, refused to somebody not in it yet, is joined for them and opens', async () => {
  const { joinOfficial } = await import('../boot.js');
  const seen = fakeShip();
  const doc = await joinOfficial(official, 500, 10);
  assert.ok(doc?.maps?.length, 'its map came');
  assert.deepEqual(seen.joins, [{ noteId: 'note-official', host: '~nolset' }]);
});

test('one that does not let them in is said so, with Try again; a refused request too', async () => {
  const { joinOfficial } = await import('../boot.js');
  fakeShip({ admits: false });
  await assert.rejects(joinOfficial(official, 60, 10), (e) => e.title === 'Could not join Glurff' && /has not let you in yet/.test(e.detail));
  fakeShip({ refuses: true });
  await assert.rejects(joinOfficial(official, 60, 10), (e) => e.title === 'Could not join Glurff' && /refused/.test(e.detail));
});

test('only the official Glurff is joined for us; any other still asks, with Join', () => {
  const boot = read('../boot.js');
  assert.match(boot, /\.catch\(\(e\) => \(e\.join && host === DEFAULT_HOST \? joinOfficial\(e\.join\) : Promise\.reject\(e\)\)\)\n      \.catch\(\(e\) => Promise\.reject\(Object\.assign\(e, \{ host \}\)\)\);/,
    'a failure says which Glurff, so the official one offers no way back to itself');
  assert.match(boot, /action: e\.join \? \{ label: 'Join', run: \(\) => joinFrom\(e\.join\) \}/);
});

test('private and secret are greyed: "Feature unavailable"', () => {
  const ed = read('../editor/editor.js');
  assert.match(ed, /const ACCESS_SOON = new Set\(\['private', 'secret'\]\);/);
  assert.match(ed, /disabled: ACCESS_SOON\.has\(v\), title: ACCESS_SOON\.has\(v\) \? 'Feature unavailable' : null,/);
  assert.doesNotMatch(ed, /Coming soon/);
});
