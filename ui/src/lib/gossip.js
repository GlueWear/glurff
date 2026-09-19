import { messageKey, messageOrder } from './timeline.js';

/* References are cheap; content requests are limited and scheduled separately.
 * Only requested notes fetch bodies. Unknown historical hops never grant a
 * distant author visibility while the companion snapshot is still arriving. */
export function createGossip({our, social, messages, fetch, changed = () => {}, now = Date.now,
  later = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id),
  schedule = fn => queueMicrotask(fn), backgroundReady = () => true,
  concurrency = 6, perAuthor = 3, history = 100}) {
  const notes = new Map(), jobs = new Map(), authors = new Map(), sending = new Set();
  const windows = new Map();
  const metrics={liveStarted:0,historyStarted:0,timeouts:0,maxLiveQueueMs:0,maxContentMs:0};
  let wanted = new Set(), scheduled = false, wake = null, closed = false;
  const note = id => {
    if (!notes.has(id)) notes.set(id, {refs: new Map(), snapshot: [], tombstones: new Set(), missing: new Set()});
    return notes.get(id);
  };
  const keyOf = (id, env) => `${id}/${messageKey(env)}`;
  const valid = env => env && typeof env.author === 'string' && Number.isFinite(env.id);
  const isDeleted = (n, env) => n.tombstones.has(messageKey(env)) || n.tombstones.has(`id:${env.id}`);
  /* The author answered that they no longer hold this body. Unlike a deletion
   * the envelope stays; there is simply nothing left to fetch. */
  const isMissing = (n, env) => (!!env.meta?.eid && n.missing.has(env.meta.eid)) || n.missing.has(`id:${env.id}`);
  function find(n, m) {
    return n?.refs.get(messageKey(m)) ?? n?.refs.get(`${m.author}:${m.id}`);
  }
  function visible(id, m) {
    if (m.author === (typeof our === 'function' ? our() : our)) return true;
    const {pals, dial, ready = true} = social();
    if (!ready || pals[m.author] === 'blocked') return false;
    const direct = ['mutual', 'requesting'].includes(pals[m.author]);
    if (Number(dial) === 0) return direct;
    const hops = find(notes.get(id), m)?.hops;
    return Number.isFinite(hops) ? hops <= Number(dial) + 1 : direct;
  }
  function requestPlan() {
    if (scheduled || closed) return;
    scheduled = true; schedule(() => { scheduled = false; if (!closed) plan(); });
  }
  function stop(job) { cancel(job.timer); job.timer = null; job.active = false; }
  function expire(job) {
    if (jobs.get(job.key) !== job || !job.active) return;
    stop(job);
    metrics.timeouts++;
    const author = authors.get(job.env.author) ?? {failures: 0, until: 0};
    author.failures++; author.until = now() + Math.min(30000, 5000 * 2 ** (author.failures - 1));
    authors.set(job.env.author, author);
    job.due = author.until; requestPlan();
  }
  function start(job) {
    job.active = true; job.tries++;
    job.started=now();metrics[job.live?'liveStarted':'historyStarted']++;
    if(job.live)metrics.maxLiveQueueMs=Math.max(metrics.maxLiveQueueMs,now()-job.arrived);
    const attempt = job.tries;
    sending.add(job);
    const settled = ok => {
      sending.delete(job);
      if (!closed && jobs.get(job.key) === job && job.active && job.tries === attempt) {
        // Start the remote-content timer only after the local poke ACK. A
        // stalled local request still occupies a slot, even after view changes
        // or content arriving ahead of its ACK. Never build another backlog.
        if (ok) job.timer = later(() => expire(job), 5000 * attempt);
        else expire(job);
      }
      requestPlan();
    };
    const data = {noteId: job.noteId, author: job.env.author, msgId: job.env.id};
    if (job.env.meta?.eid) data.eid = job.env.meta.eid;
    try { Promise.resolve(fetch(data)).then(() => settled(true), () => settled(false)); }
    catch { settled(false); }
  }
  function selected(id, incoming = []) {
    const n = note(id), pool = new Map();
    for (const ref of n.refs.values()) if (!isDeleted(n, ref.env) && visible(id, ref.env)) pool.set(messageKey(ref.env), ref.env);
    for (const m of messages(id)) if (visible(id, m)) pool.set(messageKey(m), m);
    for (const m of incoming) if (visible(id, m)) pool.set(messageKey(m), m);
    const byTime = new Map([...pool.values()].map(m => [m.id, messageKey(m)]));
    const rows = [...pool.values()].sort(messageOrder).reverse();
    const chosen = new Set(rows.slice(0, windows.get(id)??history).map(messageKey));
    for (const key of [...chosen]) {
      let m = pool.get(key), p;
      const chain = new Set([key]);
      while (m && chosen.size < 500) {
        p = m.meta?.replyToEid ?? (m.replyTo != null ? byTime.get(m.replyTo) : null);
        if (!p || chain.has(p) || !pool.has(p)) break;
        chain.add(p); chosen.add(p); m = pool.get(p);
      }
    }
    return chosen;
  }
  function plan() {
    cancel(wake); wake = null;
    const desired = new Set();
    for (const id of wanted) {
      const n = note(id), resolved = new Set(messages(id).map(messageKey));
      const resolvedLegacy = new Set(messages(id).map(m => `${m.author}:${m.id}`));
      for (const key of selected(id)) {
        const ref = n.refs.get(key);
        if (!ref || resolved.has(key) || isMissing(n, ref.env) || (!ref.env.meta?.eid && resolvedLegacy.has(`${ref.env.author}:${ref.env.id}`))) continue;
        const jobKey = keyOf(id, ref.env); desired.add(jobKey);
        let job = jobs.get(jobKey);
        if (!job) { job = {key: jobKey, noteId: id, env: ref.env, arrived:ref.at, tries: 0, due: 0, active: false}; jobs.set(jobKey, job); }
        job.live = ref.live;
      }
    }
    for (const [key, job] of jobs) if (!desired.has(key)) { stop(job); jobs.delete(key); }
    const active = [...new Set([...sending, ...[...jobs.values()].filter(j => j.active)])], counts = new Map();
    const sendingKeys = new Set([...sending].map(j => j.key));
    for (const j of active) counts.set(j.env.author, (counts.get(j.env.author) ?? 0) + 1);
    let total = active.length, next = Infinity;
    const pending = [...jobs.values()].filter(j => !j.active && j.tries < 3 && !sendingKeys.has(j.key))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.tries - b.tries || messageOrder(b.env, a.env));
    for (const job of pending) {
      if (!job.live && !backgroundReady()) { next = Math.min(next, now() + 1000); continue; }
      // A fresh live post gets its reserved slot even if older content from
      // this author timed out. Retries still obey both cooldown and limits.
      const due = Math.max(job.due, job.live && job.tries===0 ? 0 : authors.get(job.env.author)?.until ?? 0);
      if (due > now()) { next = Math.min(next, due); continue; }
      // Reserve capacity for new posts, globally and at an individual author.
      const max = job.live ? concurrency : concurrency - 1;
      const authorMax = job.live ? perAuthor : Math.max(1, perAuthor - 1);
      if (total >= max || (counts.get(job.env.author) ?? 0) >= authorMax) continue;
      counts.set(job.env.author, (counts.get(job.env.author) ?? 0) + 1); total++; start(job);
    }
    if (Number.isFinite(next)) wake = later(requestPlan, Math.max(1, next - now()));
  }
  function store(id, env, hops, live) {
    if (!valid(env)) return;
    const n = note(id); if (isDeleted(n, env)) return;
    const key = messageKey(env), old = n.refs.get(key);
    n.refs.set(key, {env: {...old?.env, ...env}, at:old?.at??now(), hops: Number.isFinite(hops) ? hops : old?.hops, live: live || old?.live || false});
  }
  return {
    visible,
    available:id=>new Set([
      ...[...(notes.get(id)?.refs.values()??[])].filter(r=>!isDeleted(notes.get(id),r.env) && visible(id,r.env)).map(r=>messageKey(r.env)),
      ...messages(id).filter(m=>visible(id,m)).map(messageKey),
    ]).size,
    setHistory(id,size) {const value=Math.max(0,Math.min(500,Math.trunc(size)));if(windows.get(id)!==value){windows.set(id,value);requestPlan();}},
    stats:()=>({...metrics,pending:jobs.size,localPending:sending.size,windows:Object.fromEntries(windows)}),
    // The fetch selection and the cache must agree about which old parents
    // are needed. Otherwise a successful fetch is trimmed and requested again.
    retained: (id, incoming) => wanted.has(id) ? selected(id, incoming) : null,
    wants: id => wanted.has(id),
    setWanted(ids) {
      const next = new Set(ids);
      for (const [key, job] of jobs) if (!next.has(job.noteId)) { stop(job); jobs.delete(key); }
      wanted = next;
      // Do not retain a reservoir for unrelated notes after their view closes.
      for (const id of notes.keys()) if (!wanted.has(id)) {notes.delete(id);windows.delete(id);}
      requestPlan();
    },
    envelope(id, env, hops) {
      if (!wanted.has(id)) return;
      store(id, env, hops, true); requestPlan(); changed(id);
    },
    snapshot(id, envelopes) {
      if (!wanted.has(id)) return;
      const n = note(id); n.snapshot = envelopes.filter(valid);
      for (const env of n.snapshot) store(id, env, undefined, false);
      for (const job of jobs.values()) if (job.noteId === id && !job.active && job.tries >= 3) job.tries = 0;
      requestPlan(); changed(id);
    },
    hops(id, rows) {
      if (!wanted.has(id)) return;
      const n = note(id), buckets = new Map();
      for (const row of rows) { if (!buckets.has(row.id)) buckets.set(row.id, []); buckets.get(row.id).push(row); }
      // Both companion arrays are emitted from the very same all-envs list.
      // That positional correspondence disambiguates equal millisecond IDs.
      const paired = rows.length === n.snapshot.length && rows.every((r, i) => r.id === n.snapshot[i].id);
      n.snapshot.forEach((env, i) => {
        const matches = buckets.get(env.id) ?? [];
        const row = env.msgIdRaw ? matches.find(r => r.msgIdRaw === env.msgIdRaw) : paired ? rows[i] : matches.length === 1 ? matches[0] : null;
        if (!row || !Number.isSafeInteger(row.hops) || row.hops < 0) return;
        const ref = find(n, env);
        if (ref) { ref.hops = row.hops; ref.raw = row.msgIdRaw; }
      });
      requestPlan(); changed(id);
    },
    content(id, incoming) {
      const ids = new Set(incoming.map(messageKey));
      const legacy = new Set(incoming.map(m => `${m.author}:${m.id}`));
      for (const [key, job] of jobs) if (job.noteId === id && (ids.has(messageKey(job.env)) || (!job.env.meta?.eid && legacy.has(`${job.env.author}:${job.env.id}`)))) {
        if(job.started!==undefined)metrics.maxContentMs=Math.max(metrics.maxContentMs,now()-job.started);
        stop(job); jobs.delete(key); authors.delete(job.env.author);
      }
      requestPlan();
    },
    /* Noltbook's answer that the author no longer holds this body. Stop asking:
     * the fetch cannot succeed, so the three retries and the author cooldown
     * that followed them only held up that author's other messages. Remembered
     * for this session, so a later snapshot does not start the job again. */
    unavailable(id, {eid, msgId}) {
      const n = note(id);
      n.missing.add(eid ?? `id:${msgId}`);
      for (const [key, job] of jobs) {
        if (job.noteId !== id) continue;
        if (eid ? job.env.meta?.eid === eid : job.env.id === msgId) {
          stop(job); jobs.delete(key);
          //  Not the author's failure, so never their backoff.
          authors.delete(job.env.author);
        }
      }
      requestPlan();
    },
    remove(id, {eid, msgId}) {
      const n = note(id); n.tombstones.add(eid ?? `id:${msgId}`);
      for (const [key, ref] of n.refs) if (eid ? ref.env.meta?.eid === eid : ref.env.id === msgId) n.refs.delete(key);
      requestPlan();
    },
    socialChanged() { requestPlan(); },
    close() { closed = true; cancel(wake); for (const job of jobs.values()) stop(job); jobs.clear(); sending.clear(); notes.clear(); },
  };
}
