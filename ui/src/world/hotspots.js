/* Named rectangles on a painted scene. Coordinates are source-image pixels,
 * not screen pixels, so hit testing survives every camera zoom and pan. */
import { siteFrom } from '../lib/sites.js';
import { ITEMS } from './places.js';
import { covers } from './world-doc.js';

/* THE SPOTS, as the world's document places them (2026-11-05): every item
 * that is clicked -- a screen, the jukebox, a spot that opens an app or a
 * site, a portal -- with the box round it (`rect`, map pixels) and its
 * `shape`. A spot that opens an app keeps the app's own shape, {desk, title,
 * publisher, context}: `settable` ones are the world's host's to change from
 * their agent (see spotsFor below), and HOST stands for the world's host ship
 * (lib/world-config), who publishes the app and keeps the table. */
/* A placed image that does nothing is just a picture, not a spot. */
/* A character of the world's is tapped where it stands now, not where it
 * was put (world/game npcAt). */
const clicked = (it) => it.rect && (it.do?.trigger ?? 'click') === 'click' && (it.do?.kind !== 'none' || it.settable) && it.do?.kind !== 'npc';
export function spotOf(it) {
  const spot = { id: it.id, scene: it.scene, rect: it.rect, shape: it.shape, name: it.name, item: it };
  if (it.settable) spot.settable = true;
  if (it.do.kind === 'app') spot.app = { desk: it.do.desk, title: it.do.title ?? it.name, publisher: it.do.publisher, context: it.do.context ?? {} };
  if (it.do.kind === 'web') spot.web = { url: it.do.url, host: new URL(it.do.url).host, title: it.do.title ?? it.name };
  return spot;
}
export const HOTSPOTS = ITEMS.filter(clicked).map(spotOf);

/* A spot's app as the host's agent sends it ({desk, publisher, title,
 * context}), checked: it came from another ship. null if it will not do. */
export function hostSpotApp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { desk, publisher, title, context } = raw;
  if (typeof desk !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(desk)) return null;
  if (typeof publisher !== 'string' || !/^~[a-z-]{3,56}$/.test(publisher)) return null;
  const ctx = {};
  if (context && typeof context === 'object')
    for (const [k, v] of Object.entries(context).slice(0, 8))
      if (/^[a-z][a-z0-9-]{0,31}$/i.test(k) && typeof v === 'string' && v.length <= 200) ctx[k] = v;
  return { desk, publisher, title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 64) : desk, context: ctx };
}

/* A WEBSITE on a spot, as the host's agent sends it ({url, title}), checked:
 * https only, never our own ship's address. {url, host, title}, or null. */
export function hostSpotWeb(raw, origin = null) {
  if (!raw || typeof raw !== 'object') return null;
  const site = siteFrom(raw.url, origin);
  if (site.error) return null;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 64) : site.host;
  return { url: site.url, host: site.host, title };
}

/* The spots as this world has them: the host's choice for a settable spot --
 * an Urbit app (`set`) or a website (`webs`), both maps of spot id as sent --
 * else what the map gives it; a settable spot with none of these is left out:
 * nothing to zoom, nothing to click. */
export function spotsFor(hotspots, set = {}, webs = {}, origin = null) {
  const out = [];
  for (const h of hotspots) {
    if (!h.settable) { out.push(h); continue; }
    const chosen = Object.hasOwn(set ?? {}, h.id) ? hostSpotApp(set[h.id]) : null;
    const web = !chosen && Object.hasOwn(webs ?? {}, h.id) ? hostSpotWeb(webs[h.id], origin) : null;
    if (web) { const { app, ...rest } = h; out.push({ ...rest, web }); continue; }
    const app = chosen ?? h.app ?? null;
    if (app) out.push({ ...h, app });
  }
  return out;
}

/* A spot's app, with HOST filled in as the world's host ship. */
export function spotApp(app, host) {
  if (!app) return null;
  const fill = (v) => (v === 'HOST' ? host : v);
  return { ...app, publisher: fill(app.publisher),
    context: Object.fromEntries(Object.entries(app.context ?? {}).map(([k, v]) => [k, fill(v)])) };
}

/* Where each screen plays (map pixels), and for whose room: the document's
 * videos that have a screen. */
export const SCREEN_RECTS = Object.fromEntries(ITEMS.filter((it) => it.do?.kind === 'video' && it.do.screen)
  .map((it) => [it.id, it.do.screen]));
export const SCREEN_AREAS = Object.fromEntries(ITEMS.filter((it) => it.do?.kind === 'video' && it.do.screen)
  .map((it) => [it.id, it.do.area]));
/* Every video surface: screens and personal players like the jukebox. */
export const SURFACES = ITEMS.filter((it) => it.do?.kind === 'video').map((it) => it.id);
export const surfaceScene = (id) => ITEMS.find((it) => it.id === id)?.scene ?? null;

export const pointInRect = (point, rect) => !!point && point.x >= rect.x && point.y >= rect.y &&
  point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;

/* The spot under a point: inside its shape, which for most is its box. */
export function hotspotAt(hotspots, scene, point) {
  return hotspots.find(h => h.scene === scene && !h.hidden?.() && pointInRect(point, h.rect) &&
    (!h.shape || h.shape.t === 'rect' || covers(h.shape, point.x, point.y))) ?? null;
}

