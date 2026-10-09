/* WEBSITES ON THE STAGE: the rules, apart from the page (see ui/sites and
 * ui/stage).
 *
 * Any https website can be opened on the stage -- from the magnifying glass in
 * the top bar, or from a spot its world's host put it on. It is walled off from
 * the player's ship by the browser itself: it comes from another address, so
 * it can keep its own saved data and use the mouse, sound and full screen, and
 * can never reach the ship. The first visit to each site asks once.
 *
 * Nothing opens a new tab by itself: a site that cannot be shown here -- one
 * on plain http, or one that refuses to be framed -- offers a button to.
 */

/* What a website on the stage may do. Its own origin's storage and cookies
 * (allow-same-origin is safe for an address that is not the ship's own --
 * see siteFrom), the mouse, popups that are ordinary windows, but never
 * navigating Glurff's page away. */
export const WEB_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox ' +
  'allow-pointer-lock allow-downloads allow-presentation allow-modals';
export const WEB_ALLOW = 'autoplay; fullscreen; gamepad; encrypted-media; picture-in-picture; clipboard-write; accelerometer; gyroscope';

const MAX_URL = 512;
export const RECENT_MAX = 10;
export const ALLOWED_MAX = 40;

/* What somebody typed, as a site to open: {url, host}, or {error, url?}.
 *   'bad'   not a web address
 *   'http'  plain http: a page on https cannot show it (url given, for a new tab)
 *   'self'  our own ship: it would get the ship's own access, so never here */
export function siteFrom(input, origin) {
  let text = String(input ?? '').trim();
  if (!text || /\s/.test(text) || text.length > MAX_URL) return { error: 'bad' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    if (!/^[^/?#]+\.[^/?#]+/.test(text)) return { error: 'bad' };
    text = `https://${text}`;
  }
  let u;
  try { u = new URL(text); } catch { return { error: 'bad' }; }
  if (origin && u.origin === origin) return { error: 'self' };
  if (u.username || u.password || !u.hostname.includes('.') && u.hostname !== 'localhost') return { error: 'bad' };
  if (u.protocol === 'http:') return { error: 'http', url: u.href };
  if (u.protocol !== 'https:') return { error: 'bad' };
  return { url: u.href, host: u.hostname.replace(/^www\./, '') };
}

/* The sites part of our saved settings, cleaned: recent ones (newest first)
 * and the hosts we have said yes to. Kept small: it rides in the same 8KB as
 * our clocks. */
export function sitesOf(settings) {
  const raw = settings?.sites && typeof settings.sites === 'object' ? settings.sites : {};
  const recent = [];
  for (const r of Array.isArray(raw.recent) ? raw.recent : []) {
    const s = r && typeof r.url === 'string' ? siteFrom(r.url) : null;
    if (s && !s.error && recent.length < RECENT_MAX && !recent.some((x) => x.url === s.url)) recent.push({ url: s.url, host: s.host });
  }
  const allowed = [...new Set((Array.isArray(raw.allowed) ? raw.allowed : [])
    .filter((h) => typeof h === 'string' && /^[a-z0-9.-]{1,80}$/.test(h)))].slice(0, ALLOWED_MAX);
  return { recent, allowed };
}
export const remembered = (sites, url, host) =>
  ({ ...sites, recent: [{ url, host }, ...sites.recent.filter((r) => r.url !== url)].slice(0, RECENT_MAX) });
export const allowedSite = (sites, host) =>
  ({ ...sites, allowed: [host, ...sites.allowed.filter((h) => h !== host)].slice(0, ALLOWED_MAX) });

/* WHAT WE ARE DOING, for the bubble over our head: everybody in the world sees
 * it. A website shows its address. */
export function activityText(source) {
  const cut = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  if (!source) return null;
  if (source.kind === 'media') return 'watching a movie';
  const what = cut(source.kind === 'web' ? source.host : source.title);
  return what ? `playing ${what}` : null;
}
