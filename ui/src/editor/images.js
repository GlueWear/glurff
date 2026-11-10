/* IMPORTED PAINTINGS (2026-11-05).
 *
 * The owner's file is kept on the host as it came. A map may use a part of it
 * (a floor of a composite sheet), cut here into a copy of its own -- the
 * map's MASTER, whose pixels are the map's coordinates. Visitors are sent a
 * smaller copy when the master is big: no side over VISITOR_SIDE and, for a
 * painting, about VISITOR_BYTES -- over Urbit a visitor's first visit fetches
 * it at roughly 0.15 MB/s (the mignes/dolten transport benchmark,
 * 2026-11-05), so a megabyte is about seven seconds. Geometry never moves:
 * every copy is drawn at the map's size.
 */
export const VISITOR_SIDE = 4096;
export const VISITOR_BYTES = 1_000_000;
export const MBPS = 0.15;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('That image could not be read.'));
  img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
});

const toBlob = (canvas, mime, quality) => new Promise((resolve) => canvas.toBlob(resolve, mime, quality));

/* Does any pixel show through? Sampled, so a big painting is cheap. */
export function hasAlpha(img) {
  const c = document.createElement('canvas'), w = Math.min(img.naturalWidth, 512), h = Math.min(img.naturalHeight, 512);
  c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

/* A part of an image, at a size, as a file: JPEG for an opaque painting,
 * PNG for anything that shows through. */
async function render(img, crop, w, h, alpha, quality = 0.9) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, w, h);
  const mime = alpha ? 'image/png' : 'image/jpeg';
  return { blob: await toBlob(c, mime, alpha ? undefined : quality), mime, w, h };
}

/* A MAP'S PAINTING from an imported file and the part of it to use
 * ([x, y, w, h] of its pixels; the whole if none): {original, master,
 * visitor}, each {blob, mime, w, h}. The master is the original itself when
 * the whole of it is used; the visitor's copy is the master unless that is
 * too big to send. */
export async function preparePainting(file, crop = null) {
  const img = await loadImage(file);
  const W = img.naturalWidth, H = img.naturalHeight;
  const original = { blob: file, mime: file.type, w: W, h: H };
  const part = crop ?? [0, 0, W, H];
  const whole = part[0] === 0 && part[1] === 0 && part[2] === W && part[3] === H;
  const alpha = file.type !== 'image/jpeg' && hasAlpha(img);
  const master = whole ? original : await render(img, part, part[2], part[3], alpha, 0.95);
  return { original, master, visitor: await visitorCopy(img, part, master, alpha) };
}

/* An item's image: kept as it is unless too big to send. */
export async function prepareItem(file) {
  const img = await loadImage(file);
  const original = { blob: file, mime: file.type, w: img.naturalWidth, h: img.naturalHeight };
  const part = [0, 0, original.w, original.h];
  return { original, master: original, visitor: await visitorCopy(img, part, original, hasAlpha(img)) };
}

async function visitorCopy(img, part, master, alpha) {
  const side = Math.max(part[2], part[3]);
  if (side <= VISITOR_SIDE && master.blob.size <= VISITOR_BYTES) return master;
  let k = Math.min(1, VISITOR_SIDE / side), copy = null;
  for (let tries = 0; tries < 8; tries++) {
    const w = Math.max(1, Math.round(part[2] * k)), h = Math.max(1, Math.round(part[3] * k));
    copy = await render(img, part, w, h, alpha, 0.85);
    if (copy.blob.size <= VISITOR_BYTES || Math.max(w, h) <= 1024) break;
    k *= 0.85;
  }
  return copy;
}

export const seconds = (bytes) => Math.max(1, Math.round(bytes / (MBPS * 1048576)));
export const megabytes = (bytes) => `${(bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1)} MB`;

/* A NOTE'S ICON (2026-11-07): the middle square of a picture, made small
 * enough for Noltbook, which keeps a note's icon only up to 50 KB. JPEG for
 * an opaque picture, WebP for one that shows through (PNG where a browser
 * cannot write WebP); smaller and smaller until it fits. */
export const ICON_BYTES = 51_200;
export async function iconOf(file) {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const crop = [(img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side];
  const mime = file.type !== 'image/jpeg' && hasAlpha(img) ? 'image/webp' : 'image/jpeg';
  for (let n = Math.min(256, side); n >= 24; n = Math.floor(n * 0.75)) {
    const c = document.createElement('canvas'); c.width = n; c.height = n;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, n, n);
    for (const q of [0.9, 0.75, 0.6]) {
      const blob = await toBlob(c, mime, q);
      if (blob && blob.size <= ICON_BYTES) return blob;
    }
  }
  throw new Error('it could not be made small enough');
}
