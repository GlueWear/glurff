export const messageKey = m => m.meta?.eid || (m.msgIdRaw ? `${m.author}:${m.msgIdRaw}` : `${m.author}:${m.id}`);
export const messageOrder = (a, b) => (a.id ?? a.at ?? 0) - (b.id ?? b.at ?? 0) || messageKey(a).localeCompare(messageKey(b));
const equal = (a, b) => a === b || (a != null && b != null && typeof a === 'object' && typeof b === 'object' &&
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k])));

/* Index legacy aliases as well as EIDs. A missing EID must not turn a history
 * snapshot into a quadratic scan, or merge distinct exact IDs in the same ms. */
export function mergeMessages(previous, incoming, retained = null) {
  const result = new Map(), byTime = new Map(), byRaw = new Map();
  const add = (index, alias, key) => {
    if (!index.has(alias)) index.set(alias, new Set());
    index.get(alias).add(key);
  };
  const put = row => {
    const key = messageKey(row); result.set(key, row);
    add(byTime, `${row.author}:${row.id}`, key);
    if (row.msgIdRaw) add(byRaw, `${row.author}:${row.msgIdRaw}`, key);
  };
  previous.forEach(put);
  for (const m of incoming) {
    const key = messageKey(m);
    let old = result.get(key);
    if (!old) {
      const candidates = m.msgIdRaw
        ? new Set([...(byRaw.get(`${m.author}:${m.msgIdRaw}`) ?? []), ...(byTime.get(`${m.author}:${m.id}`) ?? [])])
        : byTime.get(`${m.author}:${m.id}`) ?? [];
      for (const priorKey of candidates) {
        const row = result.get(priorKey);
        if (!row || (row.meta?.eid && m.meta?.eid)) continue;
        if (row.msgIdRaw && m.msgIdRaw && row.msgIdRaw !== m.msgIdRaw) continue;
        old = row; break;
      }
    }
    if (old?.edited && !m.edited) continue;
    if (old?.meta?.rev > m.meta?.rev) continue;
    const merged = {...old, ...m, meta: {...old?.meta, ...m.meta}};
    const row = old && equal(old, merged) ? old : merged;
    if (old) result.delete(messageKey(old));
    put(row);
  }
  let rows = [...result.values()].sort(messageOrder);
  if (rows.length > 500 && retained?.size) {
    const pinned = rows.filter(m => retained.has(messageKey(m))).slice(-500);
    const extra = rows.filter(m => !retained.has(messageKey(m)));
    rows = [...pinned, ...(pinned.length < 500 ? extra.slice(-(500 - pinned.length)) : [])].sort(messageOrder);
  } else rows = rows.slice(-500);
  return rows.length === previous.length && rows.every((m, i) => m === previous[i]) ? previous : rows;
}

export function chatLines(messages, name, anonymous = false) {
  const byId = new Map(messages.map(m => [String(m.id), messageKey(m)]));
  return messages.map(m => ({eid: messageKey(m), sendEid: m.meta?.eid ?? null,
    parent: m.meta?.replyToEid ?? (m.replyTo != null ? byId.get(String(m.replyTo)) : null),
    who: anonymous ? null : name(m.author), text: m.text ?? '', at: m.timestamp ?? m.id, via: m.via}));
}

/* Break only cyclic parent edges, then aggregate the forest once, bottom up.
 * Iterative walks also work for deep, valid histories without stack overflow. */
export function thread(msgs) {
  const byId = new Map(msgs.map(m => [m.eid, m])), parent = new Map();
  for (const m of msgs) parent.set(m.eid, byId.has(m.parent) ? m.parent : null);
  const finished = new Set();
  for (const m of msgs) {
    const path = new Set(); let id = m.eid;
    while (id != null && !finished.has(id)) {
      if (path.has(id)) { parent.set(id, null); break; }
      path.add(id); id = parent.get(id);
    }
    for (const id of path) finished.add(id);
  }
  const kids = new Map(), roots = [];
  for (const m of msgs) {
    const p = parent.get(m.eid);
    if (p == null) roots.push(m);
    else { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(m); }
  }
  const order = (a, b) => (a.at ?? 0) - (b.at ?? 0) || String(a.eid).localeCompare(String(b.eid));
  for (const list of kids.values()) list.sort(order);
  const stats = new Map(), stack = [...roots], traversal = [];
  while (stack.length) { const m = stack.pop(); traversal.push(m); for (const k of kids.get(m.eid) ?? []) stack.push(k); }
  for (let i = traversal.length - 1; i >= 0; i--) {
    const m = traversal[i]; let newest = m.at ?? 0, replies = 0;
    for (const k of kids.get(m.eid) ?? []) { const s = stats.get(k.eid); newest = Math.max(newest, s.newest); replies += 1 + s.replies; }
    stats.set(m.eid, {newest, replies});
  }
  roots.sort((a, b) => stats.get(a.eid).newest - stats.get(b.eid).newest || order(a, b));
  const out = [], walk = roots.slice().reverse().map(m => [m, 0]);
  while (walk.length) {
    const [m, depth] = walk.pop();
    // Noltbook indents five levels and no deeper; so do we.
    out.push({...m, parent: parent.get(m.eid), depth: Math.min(depth, 5), replies: stats.get(m.eid).replies});
    const children = kids.get(m.eid) ?? [];
    for (let i = children.length - 1; i >= 0; i--) walk.push([children[i], depth + 1]);
  }
  return out;
}

/* Include ancestors so the compact view and paged expansion retain context. */
export function recentLines(all, limit) {
  const byId = new Map(all.map(m => [m.eid, m]));
  const recent = new Set([...all].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-limit).map(m => m.eid));
  for (const id of [...recent]) {
    let p = byId.get(id)?.parent;
    while (p && byId.has(p) && !recent.has(p)) { recent.add(p); p = byId.get(p).parent; }
  }
  return all.filter(m => recent.has(m.eid));
}
