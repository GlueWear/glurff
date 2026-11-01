/* THE GLURFF'S MEMBERS (2026-10-31): everybody in the note behind it, here or
 * not, as its note has them -- and who may do what to whom there.
 *
 * Nothing here is a second record. Who is a member, an admin, muted or blocked
 * is the note's (Noltbook's members scry, lib/noltbook loadGlurffMembers), and
 * every change is a request to Noltbook that shows only once the note says so.
 *
 *   host    the note's creator: everything, to anybody else
 *   admin   one of the note's admins: mute, unmute and block ordinary
 *           members, and unblock -- never the host or another admin
 *   member  nothing
 *
 * Blocking is the note's removal, unblocking its re-adding; muting is its
 * note-wide mute. The host alone makes and removes admins. Noltbook's rules,
 * not new ones -- with one narrowing: on a public note Noltbook lets any member
 * re-add somebody, and here only the host and admins are offered it.
 */

export const FILTERS = ['all', 'admins', 'muted', 'blocked'];

/* What Noltbook calls each, and the answer it gives when it is done. */
export const ACTIONS = {
  mute: 'mute-member', unmute: 'unmute-member',
  block: 'remove-member', unblock: 'add-member',
  promote: 'make-admin', demote: 'remove-admin',
};
export const LABELS = {
  mute: 'Mute', unmute: 'Unmute', block: 'Block from Glurff', unblock: 'Unblock',
  promote: 'Make admin', demote: 'Remove admin',
};

const RANK = { host: 2, admin: 1, member: 0 };
/* The host is the host whether or not Noltbook counts them among the note's
 * members. */
export const roleOf = (rows, ship, host = null) => ship && ship === host ? 'host'
  : rows.find((r) => r.ship === ship && !r.removed)?.role ?? 'member';

/* What `actor` may do to this row, in the order offered. */
export function actionsFor(rows, actor, row, host = null) {
  if (!row || !actor || row.ship === actor || row.role === 'host' || row.ship === host) return [];
  const mine = roleOf(rows, actor, host);
  if (mine === 'member') return [];
  if (row.removed) return ['unblock'];
  if (mine === 'admin' && RANK[row.role] >= RANK.admin) return [];
  const out = [row.muted ? 'unmute' : 'mute', 'block'];
  if (mine === 'host') out.unshift(row.role === 'admin' ? 'demote' : 'promote');
  return out;
}

/* Has the note come to say what was asked? */
export function settled(row, op) {
  switch (op) {
    case 'mute': return !!row?.muted;
    case 'unmute': return !!row && !row.muted;
    case 'block': return !!row?.removed;
    case 'unblock': return !!row && !row.removed;
    case 'promote': return row?.role === 'admin';
    case 'demote': return !!row && row.role !== 'admin';
    default: return false;
  }
}

export const counts = (rows) => ({
  all: rows.filter((r) => !r.removed).length,
  admins: rows.filter((r) => !r.removed && r.role !== 'member').length,
  muted: rows.filter((r) => !r.removed && r.muted).length,
  blocked: rows.filter((r) => r.removed).length,
});

/* Searched by name or ship, and narrowed to one kind. Everybody blocked stays
 * findable under Blocked, which is where Unblock is. The host first, then
 * admins, then everybody else, by name. */
export function visibleRows(rows, { query = '', filter = 'all', name = (s) => s } = {}) {
  const q = String(query).trim().toLowerCase().replace(/^~/, '');
  const keep = (r) => filter === 'blocked' ? r.removed
    : r.removed ? false
    : filter === 'admins' ? r.role !== 'member'
    : filter === 'muted' ? r.muted : true;
  return rows.filter(keep)
    .filter((r) => !q || r.ship.toLowerCase().replace(/^~/, '').includes(q) || String(r.name ?? name(r.ship)).toLowerCase().includes(q))
    .sort((a, b) => RANK[b.role] - RANK[a.role] ||
      String(a.name ?? name(a.ship)).toLowerCase().localeCompare(String(b.name ?? name(b.ship)).toLowerCase()) ||
      a.ship.localeCompare(b.ship));
}

/* ASK, THEN WAIT FOR THE NOTE TO SAY SO. `request` is Noltbook's API; `reload`
 * reads the members again; `after` runs once it is true (the host putting it
 * into effect in every call). Resolves 'done', 'waiting' (asked, and accepted,
 * but the note has not said so yet) or throws Noltbook's refusal. */
export async function manage(op, ship, { request, reload, after = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), tries = [400, 800, 1600, 3200, 4800] }) {
  const action = ACTIONS[op];
  if (!action) throw new Error(`unknown member action ${op}`);
  await request(action, ship);
  for (const ms of [0, ...tries]) {
    if (ms) await wait(ms);
    let rows;
    try { rows = await reload(); } catch { continue; }
    if (settled(rows.find((r) => r.ship === ship), op)) {
      try { after(op, ship); } catch {}
      return 'done';
    }
  }
  return 'waiting';
}
