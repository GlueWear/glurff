/* /roll and /poll (2026-11-08): what they take, and how a poll is kept by
 * its creator's app alone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoll, rollDice, rollText, validRoll, ROLL_MAX } from '../lib/dice.js';
import { parsePoll, createPolls, resultText, POLL_MS } from '../lib/polls.js';

test('/roll reads dice, sides and what is added', () => {
  assert.deepEqual(parseRoll('/roll'), { count: 1, sides: 6, mod: 0 });
  assert.deepEqual(parseRoll('/roll 2d20'), { count: 2, sides: 20, mod: 0 });
  assert.deepEqual(parseRoll('/ROLL d100+3'), { count: 1, sides: 100, mod: 3 });
  assert.deepEqual(parseRoll('/roll 3d6 - 1'), { count: 3, sides: 6, mod: -1 });
  assert.equal(parseRoll('rolling along'), null);
  assert.equal(parseRoll('/rollercoaster'), null);
  assert.ok(parseRoll('/roll lots').error);
  assert.ok(parseRoll(`/roll ${ROLL_MAX.count + 1}d6`).error);
  assert.ok(parseRoll('/roll 1d1').error);
});

test('dice land on every face, and only on faces', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) for (const n of rollDice({ count: 3, sides: 6 })) { assert.ok(n >= 1 && n <= 6); seen.add(n); }
  assert.equal(seen.size, 6);
});

test('a roll says what came up, and one from another app is checked', () => {
  assert.equal(rollText({ count: 2, sides: 20, mod: 3 }, [14, 6]), '🎲 rolled 2d20+3: 14 + 6 + 3 = 23');
  assert.equal(rollText({ count: 1, sides: 6, mod: 0 }, [4]), '🎲 rolled 1d6: 4');
  assert.equal(rollText({ count: 1, sides: 100, mod: -2 }, [50]), '🎲 rolled 1d100-2: 50 - 2 = 48');
  assert.ok(validRoll({ count: 2, sides: 6, mod: 0, dice: [1, 6] }));
  assert.ok(!validRoll({ count: 2, sides: 6, mod: 0, dice: [1, 7] }));
  assert.ok(!validRoll({ count: 2, sides: 6, mod: 0, dice: [1] }));
});

test('/poll reads a question and its choices, or Yes and No', () => {
  assert.deepEqual(parsePoll('/poll Pizza or tacos? | Pizza | Tacos'), { question: 'Pizza or tacos?', options: ['Pizza', 'Tacos'] });
  assert.deepEqual(parsePoll('/poll Pizza tonight?'), { question: 'Pizza tonight?', options: ['Yes', 'No'] });
  assert.ok(parsePoll('/poll').error);
  assert.ok(parsePoll('/poll Q | only one').error);
  assert.ok(parsePoll('/poll Q | a | A').error);
  assert.equal(parsePoll('/polling'), null);
});

/* Two apps, wired to each other. */
function pair() {
  let t = 1000;
  const now = () => t, uuid = { randomUUID: () => `poll-${Math.random().toString(36).slice(2, 12)}` };
  const net = { a: [], b: [] };
  const a = createPolls({ our: '~zod', send: (e) => net.b.push(e), now, random: uuid });
  const b = createPolls({ our: '~nec', send: (e) => net.a.push(e), now, random: uuid });
  const flush = () => { while (net.a.length || net.b.length) { for (const e of net.a.splice(0)) a.receive('~nec', e); for (const e of net.b.splice(0)) b.receive('~zod', e); } };
  return { a, b, flush, at: (ms) => { t = ms; } };
}

test('a poll is counted by its creator, one vote a ship', async () => {
  const { a, b, flush } = pair();
  const p = a.start(7, { question: 'Pizza or tacos?', options: ['Pizza', 'Tacos'] });
  flush();
  assert.equal(b.in(7).length, 1);
  b.vote(p.id, 1); b.vote(p.id, 0); flush();
  a.vote(p.id, 0);
  await new Promise((r) => setTimeout(r, POLL_MS.settle + 50)); flush();
  assert.deepEqual(a.in(7)[0].counts, [2, 0]);
  assert.deepEqual(b.in(7)[0].counts, [2, 0]);
  const ended = a.end(p.id); flush();
  assert.equal(resultText(ended), '📊 Pizza or tacos? Pizza 2, Tacos 0');
  assert.equal(b.in(7)[0].open, false);
});

test('a poll whose creator goes quiet ends, and later goes', () => {
  const { a, b, flush, at } = pair();
  a.start(3, { question: 'Q?', options: ['Yes', 'No'] }); flush();
  at(1000 + POLL_MS.quiet + 1); b.tick();
  assert.equal(b.in(3)[0].open, false);
  at(1000 + POLL_MS.quiet + POLL_MS.linger + 2); b.tick();
  assert.equal(b.in(3).length, 0);
});

test('only its creator can say what a poll is', () => {
  const { a, b, flush } = pair();
  const p = a.start(1, { question: 'Q?', options: ['Yes', 'No'] }); flush();
  assert.equal(b.receive('~bus', { kind: 'poll', id: p.id, place: 1, question: 'Q?', options: ['Yes', 'No'], counts: [9, 9], open: true }), false);
  assert.deepEqual(b.in(1)[0].counts, [0, 0]);
});
