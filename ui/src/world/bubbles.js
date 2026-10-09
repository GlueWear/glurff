/* SPEECH BUBBLES over a character's name.
 *
 *   SLEEP  somebody idle -- no key, pointer or touch for IDLE_MS, and not in a
 *          call -- has a little "zzz…" bubble, the z's coming one at a time.
 *   WAVE   somebody who waved at us has a hand over their head, for us alone,
 *          for WAVE_MS. It wins over everything while it lasts.
 *   DOING  what somebody is doing on their stage -- "playing Doomur",
 *          "playing krunker.io", "watching a movie" -- for everybody, from
 *          their presence. It wins over sleep.
 *
 * What a bubble says is decided here, from the character's flags and the time;
 * the game only draws it, and only redraws it when the words change.
 */
export const IDLE_MS = 5 * 60 * 1000;
export const SLEEP_STEP_MS = 800;
export const SLEEP_FRAMES = ['z', 'zz', 'zzz', 'zzz…'];
export const WAVE_MS = 5000;
export const WAVE_TEXT = '👋';

/* The words for a character at `time` (performance ms), or null for none. */
export function bubbleText({ asleep = false, waveUntil = 0, activity = null } = {}, time = 0) {
  if (waveUntil && time < waveUntil) return WAVE_TEXT;
  if (activity) return activity;
  if (asleep) return SLEEP_FRAMES[Math.floor(time / SLEEP_STEP_MS) % SLEEP_FRAMES.length];
  return null;
}
