export const NOLTBOOK_DESK = 'noltbook';
export const NOLTBOOK_PUBLISHER = '~nolset';

const owns = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

export function dependencyFromCharge(charge) {
  if (!charge) return { status: 'missing' };
  const chad = charge.chad ?? {};
  if (owns(chad, 'site') || owns(chad, 'glob')) return { status: 'ready' };
  if (owns(chad, 'hung')) return { status: 'failed', error: String(chad.hung || 'Installation failed') };
  return { status: 'installing' };
}

/* Docket sends one initial map, then tagged add/delete deltas. Ignore updates
 * for every other desk so an unrelated app install cannot repaint our prompt. */
export function reduceDependency(state, fact, desk = NOLTBOOK_DESK) {
  if (!fact || typeof fact !== 'object') return state;
  if (owns(fact, 'initial')) return dependencyFromCharge(fact.initial?.[desk]);
  const added = fact['add-charge'];
  if (added?.desk === desk) return dependencyFromCharge(added.charge);
  if (fact['del-charge'] === desk) return { status: 'missing' };
  return state;
}
