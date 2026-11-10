/* FOR TESTS ONLY (2026-11-10): the app carries no map of its own any more
 * (lib/world-config), so a test that loads the modules reading the world's
 * document -- world/places and everything built on it -- sets the official
 * map's old copy as the world first. Imported before them, it runs before
 * them. Nothing in the app imports this. */
import { setWorld, DEFAULT_HOST, DEFAULT_NOTE } from '../lib/world-config.js';
import legacy from './legacy-world.js';

setWorld({ host: DEFAULT_HOST, note: DEFAULT_NOTE, doc: legacy });
