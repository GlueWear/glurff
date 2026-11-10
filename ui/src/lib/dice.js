/* DICE, IN ANY CHAT (2026-11-08): "/roll" is one six-sided die, "/roll 2d20"
 * two twenty-sided ones, "/roll d100+3" a hundred-sided one and three more.
 *
 * Our own app rolls -- crypto's randomness, no host in the way -- and says
 * what came up as a line of the chat: in a chat kept by Noltbook, an ordinary
 * line of text, saved like any other (and so as easily typed by hand); in a
 * chat that is only for the session, a roll of its own that everybody's app
 * checks and words the same way. This replaced the Game Room's button. */
export const ROLL_MAX = { count: 20, sides: 1000, mod: 1000 };
const USAGE = 'Try /roll, /roll 2d20 or /roll d100+3.';

/* What was typed, as a roll: {count, sides, mod}, {error} for a roll that
 * will not do, or null when it is not a roll at all. */
export function parseRoll(text) {
  const m = /^\/roll(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const spec = (m[1] ?? '').replace(/\s+/g, '').toLowerCase();
  if (!spec) return { count: 1, sides: 6, mod: 0 };
  const d = /^(\d{0,3})d(\d{1,5})([+-]\d{1,5})?$/.exec(spec);
  if (!d) return { error: USAGE };
  const roll = { count: d[1] ? Number(d[1]) : 1, sides: Number(d[2]), mod: d[3] ? Number(d[3]) : 0 };
  return rollError(roll) ? { error: rollError(roll) } : roll;
}

/* Why a roll will not do, or null. */
export function rollError({ count, sides, mod }) {
  if (!Number.isInteger(count) || count < 1 || count > ROLL_MAX.count) return `Up to ${ROLL_MAX.count} dice at once.`;
  if (!Number.isInteger(sides) || sides < 2 || sides > ROLL_MAX.sides) return `Dice have 2 to ${ROLL_MAX.sides} sides.`;
  if (!Number.isInteger(mod) || Math.abs(mod) > ROLL_MAX.mod) return `Add or take away up to ${ROLL_MAX.mod}.`;
  return null;
}

/* The dice, fairly: a number past the last whole set of `sides` is drawn
 * again rather than folded over, which would favour the low faces. */
export function rollDice({ count, sides }, random = globalThis.crypto) {
  const out = [], one = new Uint32Array(1), limit = Math.floor(0x100000000 / sides) * sides;
  while (out.length < count) { random.getRandomValues(one); if (one[0] < limit) out.push((one[0] % sides) + 1); }
  return out;
}

/* A roll somebody else's app sent: what it says came up, checked. */
export const validRoll = (r) => !!r && !rollError(r) && Array.isArray(r.dice) && r.dice.length === r.count &&
  r.dice.every((n) => Number.isInteger(n) && n >= 1 && n <= r.sides);

export const rollName = ({ count, sides, mod }) => `${count}d${sides}${mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''}`;

/* The line the chat shows: "🎲 rolled 2d20+3: 14 + 6 + 3 = 23". */
export function rollText(roll, dice) {
  const total = dice.reduce((a, b) => a + b, 0) + roll.mod;
  if (dice.length === 1 && !roll.mod) return `🎲 rolled ${rollName(roll)}: ${total}`;
  const sum = `${dice.join(' + ')}${roll.mod ? ` ${roll.mod > 0 ? '+' : '-'} ${Math.abs(roll.mod)}` : ''}`;
  return `🎲 rolled ${rollName(roll)}: ${sum} = ${total}`;
}
