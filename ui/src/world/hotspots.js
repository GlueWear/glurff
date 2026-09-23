/* Named rectangles on a painted scene. Coordinates are source-image pixels,
 * not screen pixels, so hit testing survives every camera zoom and pan. */

export const HOTSPOTS = [
  { id:'jukebox', scene:'main', rect:{ x:108, y:166, w:35, h:58 } },
  { id:'amphitheatre', scene:'main', rect:{ x:646, y:32, w:248, h:73 } },
  { id:'movie', scene:'main', rect:{ x:1192, y:108, w:148, h:68 } },
];

export const SCREEN_RECTS = {
  amphitheatre: { x:650, y:36, w:240, h:64 },
  movie: { x:1201, y:113, w:131, h:56 },
};

export const pointInRect = (point, rect) => !!point && point.x >= rect.x && point.y >= rect.y &&
  point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;

export function hotspotAt(hotspots, scene, point) {
  return hotspots.find(h => h.scene === scene && pointInRect(point, h.rect)) ?? null;
}

