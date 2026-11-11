/* WHICH OF A GLURFF'S OTHER MAPS COME AHEAD OF YOU (2026-11-11).
 *
 * The map you start on is fetched before you walk. The others follow in the
 * background, so a door opens straight onto its map -- but every picture is
 * sent by the Glurff's host and passes through your ship, so a big Glurff
 * fetched whole costs its host and you for maps you may never enter. So:
 *
 *   SMALL (its pictures together within AHEAD_BUDGET): all of it, nearest
 *   doors first -- as it always was; once in, every door opens at once.
 *
 *   BIG: only the maps within AHEAD_DOORS doors of where you are, nearest
 *   first, topped up as you go. Crossing a whole map in less time than its
 *   neighbour takes to arrive is the only way to meet a loading screen.
 *
 * Pure: the game says what the doors are and what the pictures weigh.
 */
export const AHEAD_BUDGET = 3 * 1024 * 1024;
export const AHEAD_DOORS = 2;
/* How long background fetching waits for our movement pass before going on
 * anyway (main.js): a host whose relay never comes up must not keep its
 * maps from arriving. */
export const AHEAD_WAIT_MS = 30000;

/* Whether a Glurff is small enough to fetch whole: every picture once,
 * however many of its maps share it. */
export function fetchWhole(urls, bytes, budget = AHEAD_BUDGET) {
  let total = 0;
  for (const url of new Set(urls)) total += bytes(url);
  return total <= budget;
}

/* The maps to fetch ahead from `scene`, nearest first: those its doors lead
 * to, then theirs, and so on -- up to `doors` away, or all of them (the rest,
 * which no door reaches, last) for a Glurff fetched whole. */
export function mapsAhead(scene, { ids, neighbours, whole, doors = AHEAD_DOORS }) {
  const out = [], seen = new Set([scene]);
  let ring = [scene];
  for (let d = 1; ring.length && (whole || d <= doors); d++) {
    const next = [];
    for (const s of ring) for (const n of neighbours(s)) if (!seen.has(n)) { seen.add(n); next.push(n); }
    out.push(...next);
    ring = next;
  }
  if (whole) out.push(...ids.filter((s) => !seen.has(s)));
  return out;
}
