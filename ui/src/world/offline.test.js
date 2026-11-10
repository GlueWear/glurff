/* 2026-11-10: one rule for a Glurff that cannot be visited -- taken down, or
 * its host not answering -- said the one way, "This Glurff is offline". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARD_WAIT_MS, OFFLINE, isOffline, whyOffline } from '../lib/glurff-online.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('online is its host answering with it published; anything else is offline', () => {
  const live = { release: 3, doc: 'x', size: 1 };
  assert.equal(isOffline({ card: { note: 'n', name: 'N', live } }), false);
  assert.equal(isOffline({ card: { note: 'n', name: 'N', live: null } }), true, 'taken down');
  assert.equal(isOffline({ card: null }), true, 'hosts none any more');
  assert.equal(isOffline({ card: undefined }), true, 'no answer in time');
  assert.equal(isOffline(undefined), false, 'not asked, and nothing known: as it looks');
  assert.equal(isOffline(undefined, true), true, 'not asked yet: as it last was');
  assert.equal(isOffline({ card: { live } }, true), false, 'an answer outranks what was known');
});

test('one wait for every question about a Glurff, twice what it was', () => {
  assert.equal(CARD_WAIT_MS, 20000);
  assert.match(read('../lib/world-card.js'), /export function cardOf\(host, ms = CARD_WAIT_MS\)/);
});

test('why, in a sentence', () => {
  assert.equal(OFFLINE, 'This Glurff is offline');
  assert.match(whyOffline({ card: undefined, host: '~sampel' }), /^~sampel did not answer\. Its ship may be down\.$/);
  assert.match(whyOffline({ card: { live: null }, name: 'The Library', host: '~sampel' }), /^The Library has been taken down by its host/);
  assert.match(whyOffline({ card: { live: null }, host: '~sampel' }), /^~sampel's Glurff has been taken down/);
  assert.match(whyOffline({ card: { live: null }, host: '~sampel', own: true }), /Publish it from the editor/);
});

test('the way in says offline, with another try', () => {
  const boot = read('../boot.js');
  assert.match(boot, /throw Object\.assign\(refusal\(OFFLINE, whyOffline\(\{ card, name: card\?\.name, host \}\)\), \{ host \}\);/);
  /* The official world too: the app carries no copy of it (2026-11-10). */
  assert.doesNotMatch(boot, /DEFAULT_NOTE/);
  assert.match(boot, /if \(card === null && host !== DEFAULT_HOST\)/);
  assert.match(boot, /label: 'Try again'/);
  assert.doesNotMatch(boot, /is not open yet/);
});

test('an offline Glurff stays in Your Glurffs, greyed, and can be visited again', () => {
  const panel = read('../ui/glurffs-panel.js');
  assert.match(panel, /r\.offline \? ' offline' : ''/);
  assert.match(panel, /title="\$\{OFFLINE\}"/);
  assert.match(panel, /!r\.here && `<button data-act="go">Visit<\/button>`/, 'Visit is kept: it asks again');
  assert.match(panel, /this\.glurffs\.check\(true\)/, 'opening the list asks the hosts again');
  const lib = read('../lib/glurffs.js');
  assert.match(lib, /path: `\/card\/\$\{host\}`/, 'the hosts are followed on the page channel');
  assert.match(lib, /setTimeout\(\(\) => \{ if \(mine\(\) && !f\.heard\) heard\(host, undefined\); \}, CARD_WAIT_MS\)/);
  assert.match(lib, /followSoon\(\);\n    notify\(\);\n  \}, \(c\) => \['notes'/, 'followed once the list has it, not only at the start');
  assert.doesNotMatch(lib, /unpublished/);
});

test('a profile card shows an offline Glurff greyed, not hidden', () => {
  const card = read('../ui/profile.js');
  assert.match(card, /const offline = g\.card === undefined \? !!g\.note : !!g\.card && !g\.card\.live;/);
  assert.match(card, /disabled title="\$\{OFFLINE\}">OFFLINE<\/button>/);
});

test('visiting one says offline with Try again; inside one taken down, the way home', () => {
  const main = read('../main.js');
  assert.match(main, /retry = await ask\(OFFLINE, \{ yes: 'TRY AGAIN', no: 'CANCEL'/);
  assert.match(main, /if \(retry\) void travelTo\(host, true\);/);
  assert.doesNotMatch(main, /if \(host === DEFAULT_HOST && !g\.card\?\.live\)/, 'the official world is offline like any other');
  assert.match(main, /<span>\$\{OFFLINE\}\.<\/span> <button type="button" data-do="home">Go home<\/button>/);
  assert.match(main, /if \(now === said\) return;/);
  assert.match(main, /away === WORLD_HOST \? `<span>\$\{OFFLINE\}\.<\/span>`/, 'no way home when it is home that is down');
});
