import { characterLayers, completeLook, equipmentOf, wholeFrame, companionReach } from 'world/parts';
/* One character, drawn onto a canvas.
 *
 * The builder's preview and the profile card use this rather than the world's
 * renderer: the panel sits dead centre and the camera keeps you dead centre,
 * so the only thing you could not see while editing was yourself.
 *
 * Sheets arrive over the network on first open. Anything not loaded yet simply
 * is not drawn, and `onLoad` repaints when it lands.
 */
const sheets = new Map();
function sheet(url, onLoad) {
  let img = sheets.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    sheets.set(url, img);
  }
  if (onLoad && !img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}

/* The drawn pixels of one frame of a sheet, as [x0, y0, x1, y1] inside the
 * frame, or null for an empty one: a 32px frame is mostly air, and sizing by
 * the frame rather than the drawing is what made the preview shrink. */
const inks = new Map();
function inkOf(img, f) {
  const id = `${f.url}|${f.x},${f.y},${f.w},${f.h}`;
  if (inks.has(id)) return inks.get(id);
  let box = null;
  try {
    const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    const d = g.getImageData(0, 0, f.w, f.h).data;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (d[(y * f.w + x) * 4 + 3]) {
      box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)] : [x, y, x + 1, y + 1];
    }
  } catch { box = [0, 0, f.w, f.h]; }
  inks.set(id, box);
  return box;
}

/* ONE CHARACTER, ON A CANVAS: the editor's preview, and the profile card's.
 * One fixed scale, so a character never changes size as things are added --
 * a mount, a weapon, a companion -- with the feet on the same spot every time
 * (`anchor` of the way across: left of centre leaves room for a companion).
 * Only something that would not fit at all (a very tall creature on a mount)
 * is drawn a whole step smaller, so pixels stay square. */
export function paintStage(canvas, look, dir, frame, { scale = 9, width = 380, height = 300, anchor = 0.4 } = {}, onLoad = null) {
  const dpr = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const worn = completeLook(look);
  const layers = characterLayers(worn, dir, frame);
  const companion = equipmentOf('companion', worn.companion?.part);
  /* Beside us, as far as it keeps in the world (world/parts companionReach). */
  if (companion) layers.push({ ...wholeFrame(companion, dir, 0), dx: companionReach(companion) + 2, dy: 2 });
  const ax = Math.round(width * anchor), ay = height - Math.round(height * 0.13);
  /* Everything drawn, in art pixels around the feet. */
  let left = -1, right = 1, top = -1, bottom = 1;
  const ready = [];
  for (const f of layers) {
    const img = sheet(f.url, onLoad);
    if (!img.complete || !img.naturalWidth) continue;
    ready.push([f, img]);
    const ink = inkOf(img, f);
    if (!ink) continue;
    const dx = f.dx ?? 0, dy = f.dy ?? 0, half = f.w / 2;
    const x0 = f.flip ? -(ink[2] - half) : ink[0] - half, x1 = f.flip ? -(ink[0] - half) : ink[2] - half;
    left = Math.min(left, dx + x0); right = Math.max(right, dx + x1);
    top = Math.min(top, dy + ink[1] - f.feet); bottom = Math.max(bottom, dy + ink[3] - f.feet);
  }
  const fit = Math.min(scale, ax / -left, (width - ax) / right, ay / -top, (height - ay) / bottom);
  const s = Math.max(1, Math.floor(fit)) * dpr;
  for (const [f, img] of ready) {
    ctx.save();
    ctx.translate(ax * dpr + (f.dx ?? 0) * s, ay * dpr + (f.dy ?? 0) * s);
    ctx.scale(f.flip ? -s : s, s);
    ctx.drawImage(img, f.x, f.y, f.w, f.h, -f.w / 2, -f.feet, f.w, f.h);
    ctx.restore();
  }
}
