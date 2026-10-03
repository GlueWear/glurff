/* Named rectangles on a painted scene. Coordinates are source-image pixels,
 * not screen pixels, so hit testing survives every camera zoom and pan. */

export const HOTSPOTS = [
  { id:'jukebox', scene:'main', rect:{ x:108, y:166, w:35, h:58 } },
  { id:'amphitheatre', scene:'main', rect:{ x:646, y:32, w:248, h:73 } },
  { id:'movie', scene:'main', rect:{ x:1192, y:108, w:148, h:68 } },
  /* A SPOT THAT OPENS AN APP (see ui/app-panel): the Game Room's ping pong
   * table opens %pong at the world's own table. `app` is the spot's attribute
   * -- written here today, set by a builder later. HOST stands for the world's
   * host ship (lib/world-config), who publishes the app and keeps the table. */
  { id:'pong-table', scene:'main', rect:{ x:1368, y:810, w:62, h:70 },
    app:{ desk:'pong', title:'Pong', publisher:'HOST', context:{ gid:'glurff-game-room', host:'HOST' } } },
  /* The Game Room's TV, on its stand by the far wall: %doomur, four-player Doom
   * deathmatch, in the world's own room -- kept by the world's host too. */
  { id:'doomur-tv', scene:'main', rect:{ x:1367, y:714, w:47, h:48 },
    app:{ desk:'doomur', title:'Doomur', publisher:'HOST', context:{ gid:'glurff-game-room', host:'HOST' } } },
];

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

