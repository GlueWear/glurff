/* 2026-11-09, the second round: app tiles coloured as Landscape's dark theme
 * colours them, card channels that really close, and versions a host can
 * delete. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tileColor, tileInk } from '../lib/app-spots.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a tile colour is the docket colour with its lightness turned over, as Landscape draws it dark', () => {
  assert.equal(tileColor('0xe7.e7e7'), '#181818', "Glurff's own: almost black behind its picture");
  assert.equal(tileColor('0xff.ffff'), '#0d0d0d', 'nothing past 95% lightness first');
  assert.equal(tileColor('0x14.1820'), '#dfe3eb', 'the dark colour Glurff had came out light: the corner specks');
  assert.equal(tileColor('#0000ff'), '#0000ff', 'a colour at half lightness stays as it is');
  assert.equal(tileColor(null), '');
  assert.equal(tileColor('not a colour'), '');
});

test('letters on a tile are dark on a light one and white on a dark one', () => {
  assert.equal(tileInk('#eeeeee'), '#1a1d24');
  assert.equal(tileInk('#181818'), '#fff');
  assert.equal(tileInk(''), '#fff');
});

test("Glurff's docket colour is the light one", () => {
  assert.match(read('../../../desk/desk.docket-0'), /^ {2}color\+0xe7\.e7e7$/m);
});

test("a Glurff's card is asked on a channel that is closed for good once answered", () => {
  const src = read('../lib/world-card.js');
  assert.match(src, /api\.reset\(\)/, 'reset() stops the stream; delete() alone left it open');
  assert.doesNotMatch(src, /api\.delete\(\)/);
  assert.match(src, /removeEventListener\('beforeunload', api\.delete\)/);
});

test('a host can delete any version but the live one', () => {
  const hoon = read('../../../desk/app/glurff.hoon');
  assert.match(hoon, /\[%forget ~\]\n {4}\?\.  \?=\(%'POST' method\)/);
  assert.match(hoon, /\?:  =\(live\.u\.home n\)/, 'never the one visitors are given');
  assert.match(hoon, /\(~\(int in shown\.u\.home\) u\.named\)/, 'what visitors may fetch only ever shrinks');
  assert.match(read('../editor/host-api.js'), /export const forget = \(n\) => call\(`forget\?release=\$\{n\}`/);
});
