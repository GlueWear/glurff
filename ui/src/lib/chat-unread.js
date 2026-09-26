/* Session-local badge for the chat currently being visited. History snapshots,
 * edits and own sends are not new incoming messages. */
export function createChatUnread(our) {
  let count = 0, open = false;
  const seen = new Set();
  return {
    count: () => count,
    reset() { count = 0; seen.clear(); },
    open(value) { open = value; if (open) count = 0; },
    receive(id, author) {
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (seen.size > 1000) seen.delete(seen.values().next().value);
      if (!open && author !== our) count++;
    },
  };
}
