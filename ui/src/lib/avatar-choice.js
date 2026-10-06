/* WHICH PICTURE TO SHOW FOR SOMEBODY: their profile picture if they have one;
 * else their SIGIL, which Noltbook draws on our own ship at
 * /apps/noltbook/sigil/~ship -- the same image Noltbook itself shows, cached
 * for good; else, on a ship whose Noltbook is older than that, two letters.
 *
 * Each falls through to the next when it will not load, and is remembered, so
 * a dead picture link shows the sigil (never a broken image) and a missing
 * sigil route is asked for once, not once per face. Pure: the page wires it to
 * Noltbook's profiles and to the DOM (ui/avatar).
 */
export const shipOk = (s) => typeof s === 'string' && /^~[a-z-]{3,56}$/.test(s);
export const sigilUrl = (ship) => `/apps/noltbook/sigil/${encodeURIComponent(ship)}`;
/* Noltbook's own fallback: the first two letters of the name. */
export const letters = (ship) => String(ship ?? '').replace(/^~/, '').slice(0, 2);

export function createAvatarChoice({ avatarUrl = () => null } = {}) {
  const deadPictures = new Set();
  /* Off once a sigil will not load: every ship gets the same route, so one
   * failure means this ship's Noltbook does not draw them yet. */
  let sigils = true;
  return {
    /* {src, step: 'picture' | 'sigil'}, or null for letters. */
    pictureFor(ship) {
      const url = avatarUrl(ship);
      if (url && !deadPictures.has(url)) return { src: url, step: 'picture' };
      if (sigils && shipOk(ship)) return { src: sigilUrl(ship), step: 'sigil' };
      return null;
    },
    /* A picture of this step, from this address, would not load. */
    failed(step, src) {
      if (step === 'picture') deadPictures.add(src);
      else if (step === 'sigil') sigils = false;
    },
    sigilsOn: () => sigils,
  };
}
