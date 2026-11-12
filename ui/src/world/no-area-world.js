/* FOR TESTS ONLY (2026-11-11): the official map's old copy with one sliver
 * of floor in no area -- the cell between the Library and the Commons at
 * cell (118, 92), as drawing touching areas leaves them -- set as the world
 * before anything reads it. Nothing in the app imports this. */
import { setWorld, DEFAULT_HOST, DEFAULT_NOTE } from '../lib/world-config.js';
import legacy from './legacy-world.js';

const doc = structuredClone(legacy);
const main = doc.maps.find((m) => m.id === 'main');
main.zones.push({ t: 'rect', x: 118 * 8, y: 92 * 8, w: 8, h: 8, a: null });
setWorld({ host: DEFAULT_HOST, note: DEFAULT_NOTE, doc });

/* Cell centres, in the map's tiles (32 px; cells are 8 px). */
const at = (cx, cy) => ({ x: (cx * 8 + 4) / 32, y: (cy * 8 + 4) / 32 });
export const LIBRARY = at(117, 92), SLIVER = at(118, 92), COMMONS_FLOOR = at(119, 92);
