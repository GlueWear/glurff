/* Presentation rules for Noltbook's social graph.
 *
 * Noltbook remains the authority. Glurff only turns the live pal/contact maps
 * into rows: incoming requests first, blocked ships last, and names in between.
 */
export const PAL_PRESENTATION = {
  mutual: { label: 'PALS', tone: 'mutual' },
  requesting: { label: 'REQUESTING', tone: 'requesting' },
  requested: { label: 'REQUESTED', tone: 'requested' },
  blocked: { label: 'BLOCKED', tone: 'blocked' },
  none: { label: 'ADD PAL', tone: 'none' },
};

export const palPresentation = (status) =>
  PAL_PRESENTATION[status] ?? PAL_PRESENTATION.none;

export function contactRows({ pals = {}, contacts = {}, profiles = {} } = {}, self = '') {
  const ships = new Set([
    ...Object.keys(pals),
    ...Object.keys(contacts).filter((ship) => contacts[ship]),
  ]);
  ships.delete(self);
  const rank = (status) => status === 'requested' ? 0 : status === 'blocked' ? 2 : 1;
  return [...ships].map((ship) => ({
    ship,
    status: pals[ship] ?? 'none',
    name: profiles[ship]?.displayName || ship,
    contact: !!contacts[ship],
  })).sort((a, b) => rank(a.status) - rank(b.status) ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.ship.localeCompare(b.ship));
}

export const incomingPalRequests = (social, self = '') =>
  contactRows(social, self).filter((row) => row.status === 'requested');

