/* SPOTS THAT OPEN APPS: the rules, apart from the page (see ui/app-panel).
 *
 * Noltbook's plugin conventions, so any Noltbook plugin works from a spot:
 * docket's word for whether a desk is installed and running, the frame
 * permissions an app gets ("media", "pointer-lock") and from what it declares,
 * and where the app opens -- its own pages only, with the spot's context in
 * the address.
 */
export const PLUGIN_PROTOCOL = 1;
export const DEFAULT_SIZE = { width: 900, height: 640 };
export const FRAME_ALLOW = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share';

export const deskOk = (d) => typeof d === 'string' && /^[a-z0-9-]{1,64}$/.test(d);
export const shipOk = (s) => typeof s === 'string' && /^~[a-z-]{3,56}$/.test(s);
/* A docket charge's state: 'glob' or 'site' (installed, running), 'install',
 * 'suspend', 'hung' -- or '' for no charge. */
export function chadOf(charge) {
  const ch = charge?.chad;
  if (!ch) return '';
  if (typeof ch === 'string') return ch;
  return typeof ch === 'object' ? Object.keys(ch)[0] ?? '' : '';
}
export const running = (charge) => ['glob', 'site'].includes(chadOf(charge));
export function colorHex(col) {
  if (col == null) return '';
  let c = String(col).trim();
  if (c.startsWith('#')) return c;
  if (c.startsWith('0x')) c = c.slice(2);
  c = c.replace(/\./g, '');
  return /^[0-9a-fA-F]{1,6}$/.test(c) ? '#' + c.padStart(6, '0') : '';
}
/* Does one part of a manifest declare a permission? Noltbook's rule exactly:
 * `media: true` or `pointerLock: true` on it, or the name in its `permissions`. */
export function manifestPerm(src, perm) {
  if (!src || typeof src !== 'object') return false;
  if (perm === 'media' && src.media === true) return true;
  if (perm === 'pointer-lock' && src.pointerLock === true) return true;
  const p = Array.isArray(src.permissions) ? src.permissions : [];
  return p.some((x) => String(x).toLowerCase() === perm);
}
/* What an app opened at a spot is granted. A spot opens the app the way
 * Noltbook opens an embedded app: from its launch entry, which also takes
 * whatever the manifest declares at the top. Nothing from the spot itself, and
 * each grant on its own -- a game that only wants the mouse gets no
 * same-origin. */
export function frameGrants(manifest) {
  const launch = manifest?.launch && typeof manifest.launch === 'object' ? manifest.launch : null;
  if (!launch) return { media: false, pointerLock: false };
  return { media: manifestPerm(manifest, 'media') || manifestPerm(launch, 'media'),
    pointerLock: manifestPerm(manifest, 'pointer-lock') || manifestPerm(launch, 'pointer-lock') };
}
/* Noltbook's frame permissions: a "media" app may reach its own agent; a
 * "pointer-lock" app may hold the mouse (after a click in it; Esc lets go). */
export function frameSandbox(media, pointerLock = false) {
  let s = 'allow-scripts allow-forms allow-popups allow-downloads';
  if (media) s += ' allow-presentation allow-same-origin';
  if (pointerLock) s += ' allow-pointer-lock';
  return s;
}
/* WHERE AN APP LIVES on the ship: docket says, in the desk's charge -- a glob
 * served at /apps/<base>, or a site at its own path. Usually /apps/<desk>, but
 * not always: %fhloston-poker is served at /apps/poker. Only ever a plain path
 * under /apps; anything else falls back to /apps/<desk>. */
export function appRoot(desk, charge) {
  const href = charge?.href;
  const base = href?.glob?.base;
  if (typeof base === 'string' && /^[a-z0-9-]{1,64}$/.test(base)) return `/apps/${base}`;
  const site = href?.site;
  if (typeof site === 'string' && /^\/apps\/[a-z0-9-]{1,64}$/.test(site)) return site;
  return `/apps/${desk}`;
}
/* An app WITHOUT a manifest, the player has installed: it opens as it would
 * from Landscape -- able to reach its own agent, as any page of the ship can --
 * since installing it was the trust. Nothing extra: no pointer lock, and none
 * of the spot's context, so a host cannot steer an app that was never built to
 * be embedded. (An app WITH a manifest gets what it declares, and no more.) */
export const INSTALLED_GRANTS = Object.freeze({ media: true, pointerLock: false });

/* Where the app opens: its manifest's own launch page if that is one of its
 * own, else its root -- with the spot's context in the address too, for
 * pages that read it there. Never anywhere but the app's own pages. */
export function launchHref(desk, manifest, context = {}, origin = 'https://ship.invalid', root = `/apps/${desk}`) {
  const base = root;
  let href = `${base}/`;
  const want = manifest?.launch?.href;
  if (typeof want === 'string') {
    try {
      const u = new URL(want, origin);
      if (u.origin === origin && (u.pathname === base || u.pathname.startsWith(base + '/'))) href = u.pathname;
    } catch {}
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(context ?? {})) {
    if (/^[a-z][a-z0-9-]{0,31}$/i.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v).length <= 200) q.set(k, String(v));
  }
  const qs = q.toString();
  return qs ? `${href}?${qs}` : href;
}
/* The size a manifest asks for, kept on screen. */
export function frameSize(manifest, view = { width: 1440, height: 900 }) {
  const want = manifest?.launch ?? {};
  const w = Number.isFinite(want.width) ? want.width : DEFAULT_SIZE.width;
  const h = Number.isFinite(want.height) ? want.height : DEFAULT_SIZE.height;
  return { width: Math.round(Math.max(320, Math.min(view.width * 0.94, w))),
    height: Math.round(Math.max(240, Math.min(view.height * 0.86, h))) };
}

