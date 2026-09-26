/* Our own posts, shown the moment they are sent.
 *
 * A post is drawn grey until our ship reports it saved and sent, then in the
 * normal colour until the real message arrives and takes its place. "Sent" is
 * the most Noltbook can tell us: it does not report when other ships receive a
 * gossip post or a rumor.
 *
 * The real message is recognised by the eid Noltbook returns for the post.
 * Rumors have none -- they are identified by their text, and an identical
 * rumor is stored only once -- so for those the text is what matches.
 */
export function createPending({ now = Date.now, keepMs = 300000 } = {}) {
  const posts = new Map();
  let next = 0, revision = 0;
  const count = (messages, text) => messages.reduce((n, m) => n + (m?.text === text ? 1 : 0), 0);
  function arrived(p, messages) {
    // A remote group host replaces the sender's provisional EID. Its exact
    // original @da message ID and author survive that trip; text is not an ID.
    if (p.forwarded && p.msgId && p.author && messages.some(m =>
      m.author === p.author && m.msgIdRaw === p.msgId)) return true;
    if (p.eid) return messages.some((m) => m?.meta?.eid === p.eid);
    if (!p.byText) return false;
    const n = count(messages, p.text);
    return n > p.before || (p.sent && n > 0);
  }
  return {
    /* `before` is what the note held when we posted, so an older identical
     * rumor is not mistaken for this one. */
    add(note, text, parent = null, before = [], { byText = false, author = null } = {}) {
      const id = `pending:${++next}`;
      posts.set(id, { id, note, text, parent, author, at: now(), sent: false, sentAt: 0, eid: null, byText, before: count(before, text) });
      revision++;
      return id;
    },
    sent(id, result) {
      const p = posts.get(id);
      if (!p) return;
      p.sent = true; p.sentAt = now();
      p.eid = typeof result?.eid === 'string' && result.eid ? result.eid : null;
      p.forwarded = result?.code === 'forwarded';
      p.msgId = typeof result?.msgId === 'string' ? result.msgId : null;
      revision++;
    },
    failed(id) { if (posts.delete(id)) revision++; },
    revision: () => revision,
    lines(note, messages, { who = null } = {}) {
      const out = [];
      for (const p of posts.values()) {
        if (p.note !== note) continue;
        if (arrived(p, messages) || (p.sent && now() - p.sentAt > keepMs)) { posts.delete(p.id); revision++; continue; }
        out.push({ eid: p.id, sendEid: null, parent: p.parent, who, text: p.text, at: p.at, pending: !p.sent });
      }
      return out;
    },
  };
}
