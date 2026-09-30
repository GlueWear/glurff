/* The small part of search the page needs before anybody searches: kept apart
 * from lib/search so that importing it does not bring in urbit-ob. */
export const MIN_BODY_QUERY = 2;
export const normalizeSearch = (s) => String(s ?? '').trim().toLowerCase().replace(/^[@~]+/, '');
