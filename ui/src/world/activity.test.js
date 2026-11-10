/* What our character says we are doing while something is on the stage:
 * everybody in the world sees it, the editor included (2026-11-09). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityText } from '../lib/sites.js';

test('the editor on the stage says so', () => {
  assert.equal(activityText({ kind: 'editor', title: 'Glurff editor' }), 'in the Glurff editor');
});

test('an app, a website and a movie still say what they are', () => {
  assert.equal(activityText({ kind: 'app', title: 'Chess' }), 'playing Chess');
  assert.equal(activityText({ kind: 'web', host: 'example.com', title: 'Example' }), 'playing example.com');
  assert.equal(activityText({ kind: 'media' }), 'watching a movie');
  assert.equal(activityText(null), null);
});
