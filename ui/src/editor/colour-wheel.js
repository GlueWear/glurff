/* A COLOUR WHEEL (2026-11-08), the same in every browser: hue round the
 * wheel, strength from its middle out, brightness on a slider beside it,
 * and the colour's hex to type. `onChange(hex)` as it moves. */
import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, HEX_COLOUR } from './paint-layer.js';

export function colourWheel({ value, onChange, size = 168, doc = globalThis.document }) {
  let [h, s, v] = rgbToHsv(hexToRgb(value));
  const wheel = doc.createElement('canvas'); wheel.width = wheel.height = size; wheel.className = 'wheel';
  const bright = doc.createElement('input'); Object.assign(bright, { type: 'range', min: 0, max: 100, value: Math.round(v * 100) });
  bright.className = 'bright'; bright.setAttribute('aria-label', 'Brightness');
  const hex = doc.createElement('input'); Object.assign(hex, { type: 'text', value, maxLength: 7, spellcheck: false });
  hex.className = 'hex'; hex.setAttribute('aria-label', 'Colour as hex');
  const swatch = doc.createElement('span'); swatch.className = 'swatch';
  const g = wheel.getContext('2d'), R = size / 2;

  function paint() {
    const img = g.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, r = Math.hypot(dx, dy) / (R - 1);
      if (r > 1) continue;
      const [cr, cg, cb] = hsvToRgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r, v), i = (y * size + x) * 4;
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(255 * Math.min(1, (1 - r) * (R - 1) + 0.5));
    }
    g.putImageData(img, 0, 0);
    const a = (h * Math.PI) / 180, mx = R + Math.cos(a) * s * (R - 1), my = R + Math.sin(a) * s * (R - 1);
    g.lineWidth = 2; g.strokeStyle = v > 0.5 ? '#000' : '#fff';
    g.beginPath(); g.arc(mx, my, 6, 0, Math.PI * 2); g.stroke();
    const now = rgbToHex(hsvToRgb(h, s, v));
    swatch.style.background = now;
    bright.style.background = `linear-gradient(to right, #000, ${rgbToHex(hsvToRgb(h, s, 1))})`;
    return now;
  }
  const changed = () => { const now = paint(); hex.value = now; onChange(now); };
  const pick = (e) => {
    const b = wheel.getBoundingClientRect(), k = size / b.width;
    const dx = (e.clientX - b.left) * k - R, dy = (e.clientY - b.top) * k - R;
    h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    s = Math.min(1, Math.hypot(dx, dy) / (R - 1));
    if (v < 0.05) { v = 1; bright.value = 100; }
    changed();
  };
  wheel.addEventListener('pointerdown', (e) => { wheel.setPointerCapture(e.pointerId); pick(e); });
  wheel.addEventListener('pointermove', (e) => { if (wheel.hasPointerCapture(e.pointerId)) pick(e); });
  bright.addEventListener('input', () => { v = bright.value / 100; changed(); });
  hex.addEventListener('change', () => {
    let t = hex.value.trim(); if (!t.startsWith('#')) t = `#${t}`;
    if (!HEX_COLOUR.test(t)) { hex.value = rgbToHex(hsvToRgb(h, s, v)); return; }
    [h, s, v] = rgbToHsv(hexToRgb(t)); bright.value = Math.round(v * 100);
    changed();
  });
  paint();
  const box = doc.createElement('div'); box.className = 'colour-wheel';
  const side = doc.createElement('div'); side.className = 'side';
  side.append(swatch, bright, hex);
  box.append(wheel, side);
  /* Set from outside (the eyedropper, a recent colour). */
  box.set = (hexValue) => { [h, s, v] = rgbToHsv(hexToRgb(hexValue)); bright.value = Math.round(v * 100); hex.value = hexValue; paint(); };
  return box;
}
