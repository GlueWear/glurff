/* Named rectangles on a painted scene. Coordinates are source-image pixels,
 * not screen pixels, so hit testing survives every camera zoom and pan. */

export const HOTSPOTS = [
  { id:'jukebox', scene:'main', rect:{ x:108, y:166, w:35, h:58 } },
  { id:'amphitheatre', scene:'main', rect:{ x:646, y:32, w:248, h:73 } },
  { id:'movie', scene:'main', rect:{ x:1192, y:108, w:148, h:68 } },
  /* SPOTS THAT OPEN AN APP (see ui/app-panel). The patch of map is painted in;
   * which app it opens is the world's host's to set (`settable`), from their
   * agent -- see spotsFor below. `app` here is what a spot opens until the
   * host sets something else; HOST stands for the world's host ship
   * (lib/world-config), who publishes the app and keeps the table. */
  /* The Game Room's ping pong table: %pong, at the world's own table. */
  { id:'pong-table', scene:'main', rect:{ x:1368, y:810, w:62, h:70 }, settable:true,
    app:{ desk:'pong', title:'Pong', publisher:'HOST', context:{ gid:'glurff-game-room', host:'HOST' } } },
  /* The Game Room's TV, on its stand by the far wall: %doomur, four-player Doom
   * deathmatch, in the world's own room -- kept by the world's host too. */
  { id:'doomur-tv', scene:'main', rect:{ x:1367, y:714, w:47, h:48 }, settable:true,
    app:{ desk:'doomur', title:'Doomur', publisher:'HOST', context:{ gid:'glurff-game-room', host:'HOST' } } },
  /* The Board Room's long table: nothing until the host puts an app there. */
  { id:'boardroom-table', scene:'main', rect:{ x:145, y:790, w:198, h:57 }, settable:true },
];

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

/* The spots as this world has them: the host's choice for a settable spot,
 * else what the map gives it; a settable spot with neither is left out --
 * nothing to zoom, nothing to click. `set` is the host's map of spot id to
 * app, as sent. */
export function spotsFor(hotspots, set = {}) {
  const out = [];
  for (const h of hotspots) {
    if (!h.settable) { out.push(h); continue; }
    const chosen = Object.hasOwn(set ?? {}, h.id) ? hostSpotApp(set[h.id]) : null;
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

export const SCREEN_RECTS = {
  amphitheatre: { x:650, y:36, w:240, h:64 },
  movie: { x:1201, y:113, w:131, h:56 },
};

export const pointInRect = (point, rect) => !!point && point.x >= rect.x && point.y >= rect.y &&
  point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;

export function hotspotAt(hotspots, scene, point) {
  return hotspots.find(h => h.scene === scene && pointInRect(point, h.rect)) ?? null;
}

