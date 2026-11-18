/* 2026-11-17: name tags and bubbles over the map's front. An NPC's speech
 * bubble was hidden by the Foreground painting -- the tag rode on the
 * character, and the front layer is drawn over every character. Tags now ride
 * a layer of their own, over the front and under the covers of shut rooms,
 * following their characters every frame. (Drawn and read back in a real
 * browser by implementation/name-tags/drive.mjs.) */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const game = fs.readFileSync(new URL('./game.js', import.meta.url), 'utf8');

test('the world is drawn: ground, people, the front, names, shut rooms', () => {
  assert.match(game, /this\.camera\.addChild\(this\.ground, this\.actors, this\.above, this\.labels, this\.shut\);/);
  assert.match(game, /this\.labels\.sortableChildren = true;/);
  /* Shut rooms' covers over the names, so a closed room still gives nothing away. */
  assert.match(game, /this\.shut\.addChild\(this\.covers\);/);
  assert.doesNotMatch(game, /this\.above\.addChild\(this\.covers\)/);
});

test('a tag rides the layer of names, and is placed after people move and before Pixi draws', () => {
  assert.match(game, /plate\.owner = node;[\s\S]{0,80}plate\.addChild\(nameplate\);\s*this\.labels\.addChild\(plate\);/);
  /* tick is NORMAL (0); Pixi's render is LOW (-25). */
  assert.match(game, /this\.app\.ticker\.add\(\(\) => this\.placeLabels\(\), null, -10\);/);
  assert.match(game, /if \(!node \|\| node\.destroyed\) \{ plate\.destroy\(\{ children: true \}\); continue; \}/);
  assert.match(game, /const shown = !!node\.parent && node\.worldVisible;/);
});
