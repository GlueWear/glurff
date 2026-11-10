/* A SIGN ON THE MAP (2026-11-08): an item that shows text, made into a sign
 * (`do.sign` in the document), has its words drawn inside its shape, in the
 * game's pixel face -- the same drawing in the editor and in Glurff, so what
 * the host sees is what visitors see. Tapping it still opens all of it.
 *
 * The words are sized from how tall people are on the map (world-doc
 * signFontSize), so a sign reads the same against a person on any map. What
 * does not fit ends in "…". */
import { PIXEL_FONT } from '../ui/fonts.js';
import { wrapLines, fitLines } from './sign-wrap.js';

export const SIGN_COLOUR = '#fff6dc';
const PLAQUE = 'rgba(23,20,31,0.82)';
const LINE = 1.3;

/* The sign as a canvas `k` canvas pixels to the map pixel: `w` x `h` map
 * pixels, words `size` map pixels tall. */
export function paintSign(text, { w, h, size, colour = SIGN_COLOUR, plaque = true }, k = 1, doc = globalThis.document) {
  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k);
  const pad = plaque ? Math.max(2, size * 0.45) : Math.max(1, size * 0.2);
  if (plaque) {
    ctx.fillStyle = PLAQUE;
    const r = Math.min(size * 0.4, w / 2, h / 2);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, h, r) : ctx.rect(0, 0, w, h); ctx.fill();
  }
  ctx.font = `400 ${size}px "${PIXEL_FONT}", ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const width = Math.max(1, w - 2 * pad), measure = (s) => ctx.measureText(s).width;
  const rows = Math.max(1, Math.floor((h - 2 * pad) / (size * LINE)));
  const lines = fitLines(wrapLines(text, width, measure), rows, width, measure);
  const top = h / 2 - ((lines.length - 1) * size * LINE) / 2;
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const y = top + i * size * LINE;
    if (!plaque) { ctx.lineWidth = Math.max(1, size * 0.28); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(line, w / 2, y); }
    ctx.fillStyle = colour; ctx.fillText(line, w / 2, y);
  });
  return canvas;
}
