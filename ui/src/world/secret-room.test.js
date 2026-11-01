import test from 'node:test';
import assert from 'node:assert/strict';
import { isVaticanPhrase, opensVatican, VATICAN_ROOM } from './secret-room.js';
import { roomBySlug } from './places.js';

/* "vatican city" in the Game Room's chat is the way in (2026-10-31). */
test('the phrase, however it is cased, with spaces round it', () => {
  for (const said of ['vatican city', 'Vatican City', 'VATICAN CITY', '  vatican city  ', 'vatican   city', '\tVatican city\n'])
    assert.equal(isVaticanPhrase(said), true, JSON.stringify(said));
});

test('a longer message that merely contains it is ordinary chat', () => {
  for (const said of ['let us go to vatican city', 'vatican city!', 'vatican city please', 'vaticancity', 'vatican', '', null])
    assert.equal(isVaticanPhrase(said), false, JSON.stringify(said));
});

test('only in the Game Room', () => {
  assert.equal(VATICAN_ROOM, 'game');
  assert.ok(roomBySlug('game'), 'the Game Room exists');
  assert.equal(opensVatican('vatican city', 'game'), true);
  for (const room of ['library', 'rumors', undefined]) assert.equal(opensVatican('vatican city', room), false, String(room));
});

test('the pool table walk opens nothing any more', async () => {
  const fs = await import('node:fs');
  const game = fs.readFileSync(new URL('./game.js', import.meta.url), 'utf8');
  assert.doesNotMatch(game, /SecretRoomQuest|secretRoom\.update/, 'the walking sequence is gone from the game loop');
  assert.match(game, /enterVatican\(\)/);
});
