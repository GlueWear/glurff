/* SPOTS THAT OPEN APPS: the rules, apart from the page (see ui/app-panel).
 *
 * Noltbook's plugin conventions, so any Noltbook plugin works from a spot:
 * docket's word for whether a desk is installed and running, the frame
 * permissions a "media" app gets, and where the app opens -- its own pages
 * only, with the spot's context in the address.
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
/* Noltbook's frame permissions: a "media" app may reach its own agent. */
export function frameSandbox(media) {
  let s = 'allow-scripts allow-forms allow-popups allow-downloads';
  if (media) s += ' allow-presentation allow-same-origin';
  return s;
}
/* Where the app opens: its manifest's own launch page if that is one of its
 * own, else /apps/<desk>/ -- with the spot's context in the address too, for
 * pages that read it there. Never anywhere but the desk's own pages. */
export function launchHref(desk, manifest, context = {}, origin = 'https://ship.invalid') {
  const base = `/apps/${desk}`;
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

