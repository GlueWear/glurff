import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretRoomQuest, POOL_CHECKPOINTS, PLANT } from './secret-room.js';

const GAME = 15;
const centre = b => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const point = (at, extra = {}) => ({ scene: 'main', room: GAME, ...centre(at), ...extra });

function walk(quest, order, began = 0) {
  let now = began;
  for (const index of order) {
    quest.update(point(POOL_CHECKPOINTS[index]), now += 100);
    quest.update({ scene: 'main', room: GAME, x: 41, y: 24 }, now += 20);
  }
  return now;
}

test('two complete counterclockwise circuits arm the plant', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 500 });
  const now = walk(quest, [0, 1, 2, 3, 0, 1, 2, 3, 0]);
  assert.equal(quest.update(point(PLANT), now + 100), false);
  assert.equal(quest.update(point(PLANT), now + 599), false);
  assert.equal(quest.update(point(PLANT), now + 600), true);
});

test('crossing a checkpoint on the way to the plant keeps completed laps armed', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 0 });
  const now = walk(quest, [0, 1, 2, 3, 0, 1, 2, 3, 0]);
  quest.update(point(POOL_CHECKPOINTS[3]), now + 100);
  assert.equal(quest.update(point(PLANT), now + 200), true);
});

test('a natural wide continuous loop around the table is detected', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 0 });
  const route = [
    { x: 38, y: 24.25 }, { x: 36.25, y: 25.75 },
    { x: 38, y: 27.25 }, { x: 40.75, y: 25.75 }, { x: 38, y: 24.25 },
    { x: 36.25, y: 25.75 }, { x: 38, y: 27.25 },
    { x: 40.75, y: 25.75 }, { x: 38, y: 24.25 },
  ];
  let now = 0;
  for (let leg = 1; leg < route.length; leg++) {
    const from = route[leg - 1], to = route[leg];
    for (let step = 0; step <= 20; step++) {
      const f = step / 20;
      quest.update({ scene: 'main', room: GAME,
        x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }, now += 16);
    }
  }
  assert.equal(quest.update(point(PLANT), now + 100), true);
});

test('continuous rotation works even when the rectangular checkpoints are clipped', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 0 });
  let now = 0;
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 - (Math.PI * 4 * i) / steps;
    quest.update({ scene: 'main', room: GAME,
      x: 38.3 + Math.cos(angle) * 2.8,
      y: 25.6 + Math.sin(angle) * 2.8 }, now += 16);
  }
  assert.equal(quest.update(point(PLANT), now + 100), true);
});

test('continuous clockwise rotation does not arm the plant', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 0 });
  let now = 0;
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 + (Math.PI * 4 * i) / steps;
    quest.update({ scene: 'main', room: GAME,
      x: 38.3 + Math.cos(angle) * 2.8,
      y: 25.6 + Math.sin(angle) * 2.8 }, now += 16);
  }
  assert.equal(quest.update(point(PLANT), now + 100), false);
});

test('clockwise travel never arms the plant', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 0 });
  const now = walk(quest, [0, 3, 2, 1, 0, 3, 2, 1, 0]);
  assert.equal(quest.update(point(PLANT), now + 100), false);
});

test('skipping a checkpoint starts over from the skipped-to side', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 0 });
  let now = walk(quest, [0, 2, 3, 0, 1, 2, 3, 0, 1]);
  assert.equal(quest.update(point(PLANT), now + 100), false);
  now = walk(quest, [2, 3, 0], now + 200);
  assert.equal(quest.update(point(PLANT), now + 100), true);
});

test('the plant is inert before the two laps are complete', () => {
  const quest = new SecretRoomQuest(GAME, { plantDwell: 0 });
  const now = walk(quest, [0, 1, 2, 3, 0]);
  assert.equal(quest.update(point(PLANT), now + 100), false);
});

test('leaving the game room or timing out clears progress', () => {
  const quest = new SecretRoomQuest(GAME, { timeout: 1000, plantDwell: 0 });
  let now = walk(quest, [0, 1, 2]);
  quest.update({ scene: 'main', room: 0, x: 0, y: 0 }, now + 10);
  now = walk(quest, [3, 0, 1, 2, 3, 0, 1, 2], now + 20);
  assert.equal(quest.update(point(PLANT), now + 100), false);

  quest.reset();
  now = walk(quest, [0, 1, 2, 3], 0);
  quest.update(point(POOL_CHECKPOINTS[0]), now + 2000);
  now = walk(quest, [1, 2, 3, 0, 1, 2, 3], now + 2010);
  assert.equal(quest.update(point(PLANT), now + 100), false);
});
