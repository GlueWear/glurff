/* Noltbook owns world membership. A successful request-join result means only
 * that the request was sent: admission requires its authoritative /notes feed.
 * This module never creates notes, pals, or a second membership roster. */
export const JOIN_CONFIRM_MS = 20000;
export const JOIN_RETRY_MS = 2000;
export const JOIN_RETRY_MAX_MS = 60000;

export function createWorldMembership({
  our, host, noteId, requestJoin, refresh = () => {}, changed = () => {},
  trace = () => {}, now = Date.now, later = setTimeout, cancel = clearTimeout,
}) {
  let active = false, opened = false, ready = false, note = null;
  let phase = 'waiting', reason = 'noltbook', members = [], attempt = 0;
  let timer = null, nextRetryAt = 0, generation = 0, published = '';
  // Once removed, an unchanged cached member record cannot override the denial.
  let removalObserved = false;

  const state = () => ({phase, reason, members: [...members], attempt,
    nextRetryAt, ready, joined: phase === 'member'});
  function publish() {
    const snapshot = state(), signature = JSON.stringify(snapshot);
    if (signature === published) return;
    published = signature;
    trace('world-membership', snapshot);
    changed(snapshot);
  }
  function clear() {
    if (timer !== null) cancel(timer);
    timer = null; nextRetryAt = 0; generation++;
  }
  function move(next, why = '', peers = []) {
    phase = next; reason = why; members = peers; publish();
  }
  function validNote() {
    return note?.id === noteId && note?.creator === host && note?.type === 'group';
  }
  function roster() {
    const excluded = new Set(note?.removed ?? []);
    return [...new Set(note?.users ?? [])].filter(ship =>
      typeof ship === 'string' && ship.startsWith('~') && !excluded.has(ship)).sort();
  }
  function refreshNote() {
    try { Promise.resolve(refresh({noteId, host})).catch(() => {}); } catch {}
  }
  function schedule(ms, fn) {
    if (timer !== null) cancel(timer);
    const token = generation;
    nextRetryAt = now() + ms;
    timer = later(() => {
      if (!active || !ready || token !== generation) return;
      timer = null; nextRetryAt = 0;
      fn();
    }, ms);
  }
  function retryLater(why) {
    clear();
    const delay = Math.min(JOIN_RETRY_MAX_MS, JOIN_RETRY_MS * 2 ** Math.min(attempt - 1, 5));
    schedule(delay, join);
    move('retrying', why);
    refreshNote();
  }
  function join() {
    if (!active || !ready || ['member', 'banned', 'denied', 'left', 'config-error'].includes(phase)) return;
    clear(); attempt++;
    const token = generation;
    schedule(JOIN_CONFIRM_MS, () => retryLater('no-answer'));
    move('joining', 'awaiting-membership');
    // Recheck after the synchronous notification: the caller may stop or feed
    // a freshly received membership snapshot while updating its UI.
    if (!active || token !== generation) return;
    let result;
    try { result = requestJoin({noteId, host}); }
    catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(() => {
      // Deliberately do not transition to member on the API's local ACK.
    }, error => {
      if (!active || !ready || token !== generation) return;
      const code = error?.result?.code ?? error?.code;
      if (code === 'removed' || code === 'join-removed') deny('removed');
      else if (code === 'denied' || code === 'join-denied') deny('denied');
      else retryLater('request-failed');
    });
  }
  function evaluate() {
    if (!active) return;
    if (!ready) {
      clear();
      // An interrupted local subscription does not revoke confirmed membership.
      if (phase === 'member') publish();
      else if (!['banned', 'denied', 'left'].includes(phase)) move('waiting', 'noltbook');
      else publish();
      return;
    }
    if (note && !validNote()) {
      clear(); move('config-error', 'wrong-world-note'); return;
    }
    if (validNote()) {
      const peers = roster(), included = peers.includes(our);
      if ((note.removed ?? []).includes(our)) {
        removalObserved = true;
        clear(); move('banned', 'removed'); return;
      }
      if (!included) removalObserved = true;
      if (included && (phase !== 'banned' || removalObserved)) {
        clear(); attempt = 0; removalObserved = false;
        move('member', '', peers); return;
      }
    } else removalObserved = true;
    if (our === host) {
      clear(); move('config-error', note ? 'host-not-member' : 'host-note-missing'); return;
    }
    if (phase === 'member') {
      clear(); move('left', 'reopen-to-rejoin'); return;
    }
    if (['banned', 'denied', 'left'].includes(phase)) { publish(); return; }
    // Membership events from other notes cannot restart an outstanding request.
    if (timer !== null) { publish(); return; }
    join();
  }
  function update({ready: isReady, notes}) {
    if (opened && !active) return state();
    ready = !!isReady;
    if (ready && notes !== undefined) {
      note = Array.isArray(notes) ? notes.find(n => n?.id === noteId) ?? null
        : notes?.[noteId] ?? null;
    }
    // A corrected official note can recover a configuration error.
    if (phase === 'config-error' && validNote()) phase = 'waiting';
    evaluate();
    return state();
  }
  function deny(why = 'removed') {
    if (!active) return;
    removalObserved = !validNote() || !roster().includes(our);
    clear(); move(why === 'removed' ? 'banned' : 'denied', why);
  }
  return {
    state, update, deny,
    start() {
      if (active) return state();
      active = true; opened = true;
      if (phase === 'stopped') { phase = 'waiting'; reason = 'noltbook'; }
      evaluate(); return state();
    },
    retry() {
      if (!active || ['member', 'banned', 'left'].includes(phase)) return state();
      clear(); phase = 'waiting'; refreshNote(); evaluate(); return state();
    },
    stop() {
      if (!active) return;
      active = false; clear(); move('stopped');
    },
  };
}
