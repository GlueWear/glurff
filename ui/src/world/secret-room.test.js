import './test-world.js';   //  the world, set before anything reads it
import test from 'node:test';
import assert from 'node:assert/strict';
import { phrasePortal } from './secret-room.js';
import { roomBySlug } from './places.js';

/* "vatican city" in the Game Room's chat is the way in (2026-10-31): now a
 * phrase portal in the official world's document (2026-11-05). */
const GAME = roomBySlug('game').id;

test('the phrase, however it is cased, with spaces round it', () => {
  for (const said of ['vatican city', 'Vatican City', 'VATICAN CITY', '  vatican city  ', 'vatican   city', '\tVatican city\n'])
    assert.equal(phrasePortal(said, GAME)?.to.id, 'vatican-spawn', JSON.stringify(said));
});

test('a longer message that merely contains it is ordinary chat', () => {
  for (const said of ['let us go to vatican city', 'vatican city!', 'vatican city please', 'vaticancity', 'vatican', '', null])
    assert.equal(phrasePortal(said, GAME), null, JSON.stringify(said));
});

test('only in the Game Room', () => {
  assert.ok(roomBySlug('game'), 'the Game Room exists');
  assert.equal(phrasePortal('vatican city', GAME).area.slug, 'game');
  for (const room of ['library', 'war', 'bar']) assert.equal(phrasePortal('vatican city', roomBySlug(room).id), null, room);
  assert.equal(phrasePortal('vatican city', 0), null, 'not in the Commons');
});

test('the pool table walk opens nothing any more', async () => {
  const fs = await import('node:fs');
  const game = fs.readFileSync(new URL('./game.js', import.meta.url), 'utf8');
  assert.doesNotMatch(game, /SecretRoomQuest|secretRoom\.update/, 'the walking sequence is gone from the game loop');
  assert.match(game, /takePortal\(/);
});
