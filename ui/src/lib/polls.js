import { freshIds } from './fresh-id.js';
/* POLLS, IN ANY CHAT (2026-11-08): "/poll Pizza or tacos? | Pizza | Tacos"
 * -- or "/poll Pizza tonight?" for Yes and No -- puts a poll in the chat it
 * is said in.
 *
 * Nothing is kept on any ship. The app of whoever started a poll holds it:
 * it counts the votes, one a ship -- Urbit says which ship each came from,
 * so nobody votes twice -- and tells everybody the count again after every
 * vote and every little while, which is how somebody who walks in later
 * sees it. Voting again changes your vote. A poll ends when its creator ends
 * it, walks out of its chat, or after half an hour; a creator who leaves the
 * Glurff altogether stops being heard, and it ends for everybody soon after.
 * The result goes into the chat as a line, which is all that stays.
 *
 * Its messages go to everybody in the Glurff with the place they are for
 * (main's sendWorldAction); each app shows the polls of the chat it is in. */
export const POLL_MAX = { question: 200, option: 60, options: 6 };
export const POLL_MS = { beat: 15_000, quiet: 50_000, life: 30 * 60_000, linger: 60_000, settle: 400 };
const USAGE = 'Try /poll Pizza or tacos? | Pizza | Tacos';

/* What was typed, as a poll: {question, options}, {error}, or null when it
 * is not a poll at all. */
export function parsePoll(text) {
  const m = /^\/poll(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const parts = (m[1] ?? '').split('|').map((p) => p.trim().replace(/\s+/g, ' '));
  const question = parts[0] ?? '';
  let options = parts.slice(1).filter(Boolean);
  if (!question) return { error: USAGE };
  if (!options.length) options = ['Yes', 'No'];
  if (options.length < 2) return { error: 'A poll needs two choices or more.' };
  if (options.length > POLL_MAX.options) return { error: `Up to ${POLL_MAX.options} choices.` };
  if (question.length > POLL_MAX.question) return { error: `A question of up to ${POLL_MAX.question} letters.` };
  if (options.some((o) => o.length > POLL_MAX.option)) return { error: `Choices of up to ${POLL_MAX.option} letters each.` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: 'Each choice once.' };
  return { question, options };
}

const okId = (id) => typeof id === 'string' && /^[a-z0-9-]{8,64}$/i.test(id);
const okText = (t, max) => typeof t === 'string' && t.trim().length > 0 && t.length <= max;
const okPoll = (e) => okId(e.id) && Number.isSafeInteger(e.place) && okText(e.question, POLL_MAX.question) &&
  Array.isArray(e.options) && e.options.length >= 2 && e.options.length <= POLL_MAX.options &&
  e.options.every((o) => okText(o, POLL_MAX.option)) &&
  Array.isArray(e.counts) && e.counts.length === e.options.length && e.counts.every((n) => Number.isSafeInteger(n) && n >= 0);

/* The line that stays: "📊 Pizza or tacos? Pizza 4, Tacos 2". */
export const resultText = (p) => `📊 ${p.question} ${p.options.map((o, i) => `${o} ${p.counts[i]}`).join(', ')}`;

/* send(event): to everybody in the Glurff. allowed(ship): somebody whose
 * polls and votes count -- in it, and not blocked or muted there. */
export function createPolls({ our, send, allowed = () => true, now = () => Date.now(), random = freshIds }) {
  const polls = new Map();          //  id -> poll
  const listeners = new Set();
  const changed = (poll = null) => listeners.forEach((fn) => { try { fn(poll); } catch (e) { console.error(e); } });
  const counted = (p) => p.options.map((_, i) => [...p.votes.values()].filter((v) => v === i).length);
  const wire = (p) => ({ kind: 'poll', id: p.id, place: p.place, question: p.question, options: p.options, counts: p.counts, open: p.open });
  const tell = (p) => { p.told = now(); Promise.resolve(send(wire(p))).catch(() => {}); };
  /* A creator's poll, told again shortly after a vote -- not once a vote,
   * when a room votes at once. */
  const soon = (p) => { clearTimeout(p.timer); p.timer = setTimeout(() => { if (p.open) tell(p); }, POLL_MS.settle); };

  function start(place, { question, options }) {
    if ([...polls.values()].some((p) => p.by === our && p.open && p.place === place)) throw new Error('End your poll here first.');
    const id = random.randomUUID();
    const p = { id, by: our, place, question, options, votes: new Map(), counts: options.map(() => 0), mine: null, open: true, at: now(), heard: now() };
    polls.set(id, p);
    tell(p); changed(p);
    return p;
  }
  function vote(id, choice) {
    const p = polls.get(id);
    if (!p?.open || !Number.isInteger(choice) || choice < 0 || choice >= p.options.length || p.mine === choice) return;
    const was = p.mine;
    p.mine = choice;
    if (p.by === our) { p.votes.set(our, choice); p.counts = counted(p); soon(p); }
    else {
      /* Ours shows at once; the creator's next count is the word. */
      p.counts = p.counts.map((n, i) => n - (i === was ? 1 : 0) + (i === choice ? 1 : 0)).map((n) => Math.max(0, n));
      Promise.resolve(send({ kind: 'poll-vote', id, place: p.place, choice })).catch(() => {});
    }
    changed(p);
  }
  /* Our poll ends: everybody is told, and the result is the caller's to
   * put in the chat. */
  function end(id) {
    const p = polls.get(id);
    if (!p || p.by !== our || !p.open) return null;
    p.open = false; p.ended = now(); clearTimeout(p.timer);
    tell(p); changed(p);
    return p;
  }
  function receive(who, e) {
    if (!who || who === our || !allowed(who) || !e) return false;
    if (e.kind === 'poll') {
      if (!okPoll(e)) return false;
      const p = polls.get(e.id);
      if (p && p.by !== who) return false;
      if (!p && e.open === false) return false;
      const next = p ?? { id: e.id, by: who, place: e.place, question: e.question, options: e.options, mine: null, at: now() };
      Object.assign(next, { counts: e.counts, open: e.open !== false, heard: now() });
      if (!next.open) next.ended ??= now();
      polls.set(e.id, next);
      changed(p ? null : next);
      return true;
    }
    if (e.kind === 'poll-vote') {
      const p = polls.get(e.id);
      if (!p || p.by !== our || !p.open || !Number.isInteger(e.choice) || e.choice < 0 || e.choice >= p.options.length) return false;
      p.votes.set(who, e.choice); p.counts = counted(p); soon(p); changed(null);
      return true;
    }
    return false;
  }
  /* Every few seconds: our polls told again, or ended when they have run
   * their time; others' that went quiet, ended; the ended, after a while,
   * gone. Returns our polls that just ran out, for their results. */
  function tick() {
    const t = now(), expired = [];
    let any = false;
    for (const p of [...polls.values()]) {
      if (p.open && p.by === our && t - p.at > POLL_MS.life) { end(p.id); expired.push(p); continue; }
      if (p.open && p.by === our && t - (p.told ?? 0) > POLL_MS.beat) tell(p);
      if (p.open && p.by !== our && t - p.heard > POLL_MS.quiet) { p.open = false; p.ended = t; any = true; }
      if (!p.open && t - (p.ended ?? t) > POLL_MS.linger) { polls.delete(p.id); any = true; }
    }
    if (any) changed(null);
    return expired;
  }
  return {
    start, vote, end, receive, tick,
    in: (place) => [...polls.values()].filter((p) => p.place === place).sort((a, b) => a.at - b.at),
    mine: () => [...polls.values()].filter((p) => p.by === our && p.open),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
