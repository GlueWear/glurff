/* THE PIXEL FACE (2026-10-21): Silkscreen, for the names over heads, panel
 * headings and the small labels that belong to the game rather than to a form.
 * Everything else reads in the system's own face (see --font-ui in style.css).
 *
 * Chosen over Pixelify Sans, Tiny5 and others for one glyph: an @p begins
 * with a tilde, and theirs is a flat dash -- "~nec" read "-nec". Silkscreen's
 * is unmistakable, it stays crisp at the small sizes labels need, and its
 * capitals are how names over heads were always shown.
 *
 * SIL Open Font License 1.1; the licence travels with the site
 * (public/licenses/silkscreen-license.html). Two weights of about 8 KB each,
 * inlined into the bundle, so they arrive with it and are cached with it -- and
 * need no file type of their own on the ship.
 */
import regular from './fonts/silkscreen-latin-400-normal.woff2?inline';
import bold from './fonts/silkscreen-latin-700-normal.woff2?inline';

export const PIXEL_FONT = 'Silkscreen';
/* Long enough for a slow first paint, short enough that a font that will not
 * load never holds the world back: the fallbacks in style.css stand in. */
const WAIT_MS = 1500;

function load() {
  if (typeof document === 'undefined' || typeof FontFace !== 'function') return Promise.resolve(false);
  const faces = [[regular, '400'], [bold, '700']].map(([src, weight]) => {
    const face = new FontFace(PIXEL_FONT, `url(${src})`, { weight, style: 'normal', display: 'swap' });
    document.fonts.add(face);
    return face.load();
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), WAIT_MS));
  return Promise.race([Promise.all(faces).then(() => true, () => false), timeout]);
}

export const fontsReady = load();
