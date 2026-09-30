/* CLOCKS IN THE SKY: which planets we keep, where, and the time on each.
 *
 * Every planet is a twelve-hour clock. The SUN goes round once in twelve hours
 * -- the hour hand, twelve o'clock at the top -- and a small MOON goes round
 * once an hour on a tighter orbit, the minute hand. Morning and evening are
 * told apart by colour: from 06:00 to 18:00 the planet is in its day colours,
 * otherwise its night greys, fading from one to the other over an hour at dawn
 * and at dusk.
 *
 * The first planet is OURS: its time zone is our time zone (UTC unless we say
 * otherwise). We can add more, each with its own time zone and its own
 * letters, move them anywhere in the sky and make them bigger or smaller.
 *
 * These are OUR settings: they follow us to any glurff and any browser, kept
 * by our own agent as JSON it never reads (see `prefs` in sur/glurff.hoon).
 * The host's own "home planet" is a later step.
 */
export const MAX_CLOCKS = 6;
/* A planet's text. Longer text still fits -- it repeats around each ring of
 * letters -- but the widest ring shows about thirty across, so a long phrase
 * reads less like a word and more like a texture. */
export const LABEL_MAX = 25;
export const SIZE_MIN = 0.6;
export const SIZE_MAX = 1.8;
export const DEFAULT_ZONE = 'UTC';
export const DEFAULT_LABEL = 'GLURFF';
export const CORNERS = ['tl', 'tr', 'bl', 'br'];
/* Where the first planet sits by default: its centre, from the top-right
 * corner, clear of the top bar and the ship name. */
export const HOME_AT = { corner: 'tr', dx: 145, dy: 185 };
/* Added planets start in a row to its left. */
export const ROW_GAP = 270;

/* ------------------------------------------------------------ time zones */

const formatters = new Map();
export function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}
/* Every time zone the browser knows, for the picker. */
export function allZones() {
  try { const list = Intl.supportedValuesOf?.('timeZone'); if (list?.length) return ['UTC', ...list.filter((z) => z !== 'UTC')]; } catch {}
  return ['UTC'];
}
/* How far a zone is from UTC right now, as "UTC+9" or "UTC-4:30"; empty
 * where the browser cannot say. */
const offsets = new Map();          //  zone -> {at, value}: kept an hour
export function zoneOffset(zone, ms = Date.now()) {
  const kept = offsets.get(zone);
  if (kept && Math.abs(ms - kept.at) < 3600000) return kept.value;
  const value = offsetNow(zone, ms);
  offsets.set(zone, { at: ms, value });
  return value;
}
function offsetNow(zone, ms) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? '';
    return part.replace(/^GMT/, 'UTC') === 'UTC' ? 'UTC+0' : part.replace(/^GMT/, 'UTC');
  } catch { return ''; }
}
/* THE PICKER'S CHOICES: UTC first, then every zone by region, each named by
 * its city with its offset -- "Tokyo (UTC+9)". A dropdown, not a text box
 * with suggestions: those only suggest what matches what is already typed,
 * so a box starting "UTC" offered nothing else. `keep` is shown even if the
 * browser's own list lacks it, so a saved zone is always there to see. */
export function zoneChoices(keep = null, ms = Date.now()) {
  const zones = allZones().filter((z) => z !== 'UTC');
  if (keep && validZone(keep) && keep !== 'UTC' && !zones.includes(keep)) zones.unshift(keep);
  const groups = new Map();
  for (const zone of zones) {
    const parts = zone.split('/');
    const region = parts.length > 1 ? parts[0] : 'Other';
    const city = (parts.length > 1 ? parts.slice(1).join(' / ') : zone).replace(/_/g, ' ');
    const off = zoneOffset(zone, ms);
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push({ zone, label: off ? `${city} (${off})` : city });
  }
  return [{ region: null, zones: [{ zone: 'UTC', label: 'UTC' }] },
    ...[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([region, list]) =>
      ({ region, zones: list.sort((a, b) => a.label.localeCompare(b.label)) }))];
}
export const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_ZONE; } catch { return DEFAULT_ZONE; } };

/* The time of day in `zone` at `ms`: hours 0-23, minutes, seconds. */
export function zoneTime(ms, zone = DEFAULT_ZONE) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: validZone(zone) ? zone : DEFAULT_ZONE,
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    formatters.set(zone, f);
  }
  const out = { h: 0, m: 0, s: 0 };
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type === 'hour') out.h = Number(p.value) % 24;
    else if (p.type === 'minute') out.m = Number(p.value);
    else if (p.type === 'second') out.s = Number(p.value);
  }
  return out;
}

/* The hands, as angles clockwise from twelve o'clock. */
export function hands({ h, m, s }) {
  const TAU = Math.PI * 2;
  return {
    hour: (((h % 12) + m / 60 + s / 3600) / 12) * TAU,
    minute: ((m + s / 60) / 60) * TAU,
  };
}

/* How much of day it is, 0 (night) to 1 (day), with an hour of fade at dawn
 * (05:30-06:30) and at dusk (17:30-18:30). */
export function dayness({ h, m, s = 0 }) {
  const t = h + m / 60 + s / 3600;
  if (t >= 6.5 && t < 17.5) return 1;
  if (t >= 5.5 && t < 6.5) return t - 5.5;
  if (t >= 17.5 && t < 18.5) return 1 - (t - 17.5);
  return 0;
}

/* Six shades from lit to shadow, for night and for day. The same order in
 * both, so every step of a fade reads the same way. */
export const NIGHT = ['#eceef2', '#c3c8d0', '#9aa0aa', '#737984', '#4d525b', '#30343b'];
export const DAY = ['#fff3c4', '#f6d27a', '#e0a93e', '#b97d24', '#8a5a1a', '#5a3a12'];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function blend(a, b, f) {
  const x = rgb(a), y = rgb(b), k = Math.max(0, Math.min(1, f));
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
/* A DAY COLOUR OF OUR OWN. Each planet may have a hue (0-359); its six day
 * shades are made at fixed steps of lightness, the same steps as the gold, so
 * whatever the colour the letters go light to dark in the same order and stay
 * as easy to read. No hue is the warm gold itself. Night is always the greys. */
export const GOLD_HUE = 40;
const DAY_L = [88, 72, 57, 44, 32, 21];
const DAY_S = [95, 85, 72, 67, 68, 67];
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
export const validHue = (h) => Number.isInteger(h) && h >= 0 && h < 360;
export const dayColors = (hue = null) => (validHue(hue) ? DAY_L.map((l, i) => hsl(hue, DAY_S[i], l)) : DAY);
export const palette = (day, hue = null) => { const d = dayColors(hue); return NIGHT.map((n, i) => blend(n, d[i], day)); };

/* ------------------------------------------------------------- settings */

const clampSize = (s) => (Number.isFinite(s) ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, s)) : 1);
export function cleanLabel(text, fallback = DEFAULT_LABEL) {
  const t = String(text ?? '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LABEL_MAX);
  return t || fallback;
}
/* A city's name from its zone, as an added planet's first letters. */
export const zoneLabel = (zone) => cleanLabel(String(zone).split('/').pop().replace(/_/g, ' ').toUpperCase(), 'UTC');
const cleanAt = (at, fallback) => {
  if (!at || !CORNERS.includes(at.corner) || !Number.isFinite(at.dx) || !Number.isFinite(at.dy)) return { ...fallback };
  return { corner: at.corner, dx: Math.max(0, Math.min(4000, Math.round(at.dx))), dy: Math.max(0, Math.min(4000, Math.round(at.dy))) };
};
export const defaultAt = (i) => ({ corner: 'tr', dx: HOME_AT.dx + i * ROW_GAP, dy: HOME_AT.dy });

export function defaults() {
  return { clocks: [{ id: 'home', label: DEFAULT_LABEL, zone: DEFAULT_ZONE, size: 1, hue: null, at: defaultAt(0) }] };
}

/* Whatever arrived -- ours, an older client's, or nonsense -- as settings that
 * can be drawn. Unknown keys at the top are kept for whatever else uses them. */
export function normalize(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(base.clocks) ? base.clocks : [];
  const seen = new Set();
  const clocks = [];
  for (const c of list) {
    if (!c || typeof c !== 'object' || clocks.length >= MAX_CLOCKS) continue;
    const id = typeof c.id === 'string' && /^[a-z0-9-]{1,24}$/.test(c.id) && !seen.has(c.id) ? c.id : `c${clocks.length}-${seen.size}`;
    seen.add(id);
    const zone = validZone(c.zone) ? c.zone : DEFAULT_ZONE;
    clocks.push({ id, zone, size: clampSize(c.size), hue: validHue(c.hue) ? c.hue : null,
      label: cleanLabel(c.label, clocks.length ? zoneLabel(zone) : DEFAULT_LABEL),
      at: cleanAt(c.at, defaultAt(clocks.length)) });
  }
  if (!clocks.length) clocks.push(defaults().clocks[0]);
  return { ...base, clocks };
}

export function parse(text) {
  if (!text) return defaults();
  try { return normalize(JSON.parse(text)); } catch { return defaults(); }
}

/* A new planet for `zone`, placed after the others. Null when full. */
export function addClock(settings, zone = DEFAULT_ZONE) {
  if (settings.clocks.length >= MAX_CLOCKS) return null;
  const ids = new Set(settings.clocks.map((c) => c.id));
  let n = settings.clocks.length, id;
  do { id = `c${n++}`; } while (ids.has(id));
  const z = validZone(zone) ? zone : DEFAULT_ZONE;
  return normalize({ ...settings, clocks: [...settings.clocks,
    { id, zone: z, label: zoneLabel(z), size: 1, hue: null, at: defaultAt(settings.clocks.length) }] });
}

/* ------------------------------------------------------------- position */

/* A planet's centre on a `w` x `h` screen, kept on it. `r` is its outer radius. */
export function place(at, w, h, r = 0) {
  const x = at.corner.endsWith('l') ? at.dx : w - at.dx;
  const y = at.corner.startsWith('t') ? at.dy : h - at.dy;
  return { x: Math.max(r, Math.min(w - r, x)), y: Math.max(r, Math.min(h - r, y)) };
}
/* Where a planet dropped at (x, y) is kept: from whichever corner is nearest,
 * so it stays put when the window changes size. */
export function anchor(x, y, w, h) {
  const corner = (y < h / 2 ? 't' : 'b') + (x < w / 2 ? 'l' : 'r');
  return { corner, dx: Math.round(corner.endsWith('l') ? x : w - x), dy: Math.round(corner.startsWith('t') ? y : h - y) };
}

/* ------------------------------------------------------------- storage */

/* The settings, kept in step with our agent: loaded from it, saved to it a
 * moment after the last change, and never overwritten by the echo of a save
 * of our own that is still on its way. */
export function createClockSettings({ save, later = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id), delay = 800 } = {}) {
  let settings = defaults(), timer = null, sent = null, loaded = false;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(settings); } catch (e) { console.error(e); } });
  return {
    get: () => settings,
    loaded: () => loaded,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /* From the agent. */
    load(text) {
      loaded = true;
      if (timer !== null) return;                  //  a change of ours is about to be saved
      if (sent !== null && text === sent) return;  //  our own save, coming back
      settings = parse(text);
      notify();
    },
    update(fn) {
      const next = normalize(fn(structuredClone(settings)) ?? settings);
      settings = next;
      notify();
      cancel(timer);
      timer = later(() => {
        timer = null;
        sent = JSON.stringify(settings);
        Promise.resolve(save(sent)).catch(() => {});
      }, delay);
    },
  };
}
