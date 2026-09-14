/* The version of the static files Vite does not fingerprint -- sprites and the
 * noise worklet. It is a hash of their content, computed at build time (see
 * vite.config.js), so artwork that has not changed keeps its URL and stays in
 * the browser's cache across deploys, while changed artwork is fetched fresh.
 * Outside a build (tests) nothing is versioned and nothing breaks.
 */
/* global __ASSET_VERSION__ */
export const ASSET_VERSION = typeof __ASSET_VERSION__ === 'string' ? __ASSET_VERSION__ : null;

export const versioned = (url) => (ASSET_VERSION ? `${url}?v=${ASSET_VERSION}` : url);
