/* THE WORLD THIS PAGE VISITS (2026-11-05).
 *
 * One Glurff per host ship: its host, the Noltbook note whose members are its
 * members, and the document its host published (world/world-doc). The
 * official shared world is the default. A page visits exactly one world --
 * src/boot.js settles which, and sets it here, BEFORE the app is loaded, so
 * every module reads the right host and maps from its first line. Going to
 * another Glurff loads the page again.
 *
 * A note's display name never grants authority.
 */
export const DEFAULT_HOST = '~nolset';
export const DEFAULT_NOTE = 'note-~2026.09.26..03.54.17..5634';

export let WORLD_HOST = DEFAULT_HOST;
export let WORLD_NOTE = DEFAULT_NOTE;
export let WORLD_ID = `${WORLD_HOST}/${WORLD_NOTE}`;
export let WORLD_NAME = 'Glurff';
/* The world's document, and which release of it: its host's published one.
 * The app carries no map of its own (2026-11-10): the official Glurff's is
 * its host's, as anybody's Glurff is theirs, and a host that cannot be
 * reached is a Glurff that is down -- never a stand-in map that only looks
 * like it. Set by src/boot.js (or a playtest) before the app loads. */
export let WORLD_DOC = null;
export let WORLD_RELEASE = null;
/* A PLAYTEST (2026-11-06): the host walking their own draft in the real app,
 * announced to nobody -- no presence, no relay, no session, no call, nothing
 * said. See src/playtest/playtest.js. */
export let WORLD_PREVIEW = false;
export function setWorld({ host, note, name = 'Glurff', doc, release = null, preview = false }) {
  WORLD_HOST = host;
  WORLD_NOTE = note;
  WORLD_ID = `${host}/${note}`;
  WORLD_NAME = name;
  WORLD_DOC = doc;
  WORLD_RELEASE = release;
  WORLD_PREVIEW = preview;
}

/* An image of this world's, by its hash: from its host, through our own
 * ship. */
export const assetUrl = (hash) => `/apps/glurff/world/${WORLD_HOST}/asset/${hash}`;
