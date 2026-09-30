/* The call in a leased room: Noltbook's own note call, joined from the world.
 *
 * ONE NOTE, TWO DOORS. A leased room's call is not a Glurff call at all -- it
 * is the call in the note the room is leased to. Somebody sitting in Noltbook
 * joins it from the note; somebody in Glurff joins it by walking into the
 * room; and they are in the same conversation, because there is one room on
 * the call server and both doors lead to it.
 *
 * That is the whole reason this module exists. Glurff opening its own room for
 * a leased room would produce TWO rooms on the call server: Glurff people in
 * one, Noltbook people in the other, each side told "a call is happening" and
 * unable to hear the other. The obvious implementation is the wrong one.
 *
 * WHO ALLOCATES. Not us, unless the note is ours. Noltbook's `%start-call`
 * sends `%remote-call-start` to the note's creator when we are not it, and
 * only the creator's ship allocates and mints. So a leased room's call needs
 * the note owner's SHIP to be up -- not their browser, and not their presence
 * in the world.
 *
 * WHAT WE DO NOT DO. No membership check, no admission, no moderation record.
 * Noltbook gates joining by note membership and posting by its own rules, and
 * a note call's moderation is Noltbook's `call-mod`. This module asks, waits,
 * and hands over a credential.
 */
/* Noltbook's own cadence, mirrored rather than invented: its agent expects a
 * heartbeat on this interval and drops a participant that goes quiet. */
export const HEARTBEAT_MS = 20000;
/* How long to wait for the note owner's ship to answer before saying so. A
 * remote allocation is an Ames round trip, so it is not instant. */
export const ANSWER_MS = 12000;
/* Asking again when nobody answered, or when the call server would not keep
 * us: a few times, further apart each time, then stop and say so. The note's
 * own snapshots still re-ask the moment its call changes -- that is news, and
 * news is always worth acting on; silence is not. */
export const RETRY_MS = [2000, 6000, 15000, 30000, 60000];
/* Re-making the private credential watch after it failed. Without it a grant
 * has nowhere to arrive, so this one does not give up while we are in a room. */
export const WATCH_RETRY_MS = [1000, 3000, 8000, 20000];

/* Noltbook's grant, in the shape SfuSession already speaks. Nothing is
 * reinterpreted: the same token, the same group, the same ICE servers. */
export const grantOf = (f) => ({
  sfu: f.sfu, group: f.group, token: f.token, participant: f.participant,
  ice: f.iceServers ?? [], gen: f.generation ?? 0,
  expires: f.expires, renewAfter: f.renewAfter,
  room: f.room, noteId: f.noteId, callId: f.callId,
});

export function createNoteCall({ our, onGrant, onStatus, calls = () => ({}),
  /* `action` pokes Noltbook and `watch` subscribes to its private credential
   * path; both are supplied, so this module never reaches for either itself
   * and can be tested without a browser. */
  action, watch,
  trace = () => {}, now = Date.now,
  later = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id),
  every = (fn, ms) => setInterval(fn, ms), stopEvery = (id) => clearInterval(id) } = {}) {
  let note = null;          //  the note whose call we are in, or want to be
  let callId = null;        //  the incarnation we were granted
  let beat = null, waiting = null, asked = 0, askedKind = null, askedCallId = null;
  /* Said "ended" already: a note with no live call keeps arriving, and
   * reporting it every time would be noise. */
  let ended = false;
  let subscribed = null;
  let tries = 0, retrying = null, watchTries = 0, rewatch = null;

  const poke = (a, data) => { try { Promise.resolve(action(a, data)).catch(() => {}); } catch {} };
  const say = (status, why = null) => { trace('note-call', { note: note ?? '', status, reason: why ?? '' }); onStatus?.(status, why); };

  function stopBeat() { if (beat) stopEvery(beat); beat = null; }
  function stopWaiting() { cancel(waiting); waiting = null; }
  function stopRetry() { cancel(retrying); retrying = null; }

  /* ONE path for every automatic re-ask, so a failing call server and a
   * silent note owner cannot, between them, turn into a request per event. */
  function again(reason) {
    if (!note || retrying) return false;
    if (tries >= RETRY_MS.length) {
      trace('note-call', { note, status: 'gave-up', reason, tries });
      say('failed', reason === 'no answer' ? 'note owner not answering' : 'call unreachable');
      return false;
    }
    const delay = RETRY_MS[tries++];
    trace('note-call', { note, status: 'retry', reason, delay, tries });
    retrying = later(() => { retrying = null; if (note) { callId = null; ask(); } }, delay);
    return true;
  }

  /* The credential path. A failure here used to be rethrown into a promise
   * nobody held -- an unhandled rejection -- and then nothing tried again, so
   * a grant minted afterwards had nowhere to land. */
  function subscribe() {
    if (subscribed) return;
    cancel(rewatch); rewatch = null;
    let made;
    try { made = Promise.resolve(watch((fact) => api.receive(fact))); }
    catch (e) { made = Promise.reject(e); }
    subscribed = made.then(() => { watchTries = 0; }, (e) => {
      subscribed = null;
      trace('note-call', { note: note ?? '', status: 'watch-failed', reason: String(e?.message ?? e ?? '').slice(0, 80) });
      if (!note) return;
      say('waiting', 'no credential channel');
      const delay = WATCH_RETRY_MS[Math.min(watchTries++, WATCH_RETRY_MS.length - 1)];
      rewatch = later(() => { rewatch = null; if (note) { subscribe(); ask(); } }, delay);
    });
  }

  /* Ask for the call. Starting and joining are the same intent from here --
   * Noltbook decides which it is, and does the right thing when somebody beat
   * us to it. */
  function ask(known = null) {
    if (!note) return;
    const live = known ?? calls()[note];
    const kind = live?.call ? 'join-call' : 'start-call';
    asked = now();
    askedKind = kind;
    askedCallId = live?.call?.callId ?? null;
    trace('note-call', { note, status: 'asking', reason: kind });
    poke(kind, { noteId: note });
    stopWaiting();
    waiting = later(() => {
      waiting = null;
      if (note && !callId) { say('waiting', 'no answer'); again('no answer'); }
    }, ANSWER_MS);
  }

  const api = {
    /* The room we are standing in is leased to this note. */
    async enter(next) {
      if (note === next) return;
      this.leave();
      note = next;
      ended = false;
      if (!note) return;
      say('requesting');
      /* One subscription for the life of the tab: the credential path is
       * same-ship and carries no backlog, so re-subscribing would only lose
       * grants that arrive while it is being re-made. */
      subscribe();
      ask();
      stopBeat();
      beat = every(() => { if (note) poke('call-heartbeat', { noteId: note }); }, HEARTBEAT_MS);
    },

    /* A credential, or a refusal, from our own Noltbook. The fact arrives
     * WHOLE rather than split by key: it is not fronded. */
    receive(p) {
      if (!note || !p || p.noteId !== note) return false;
      if (p.type === 'failed') {
        say('failed', typeof p.reason === 'string' ? p.reason : 'refused');
        return true;
      }
      if (p.type !== 'granted') return false;
      if (p.participant && p.participant !== our) return false;
      stopWaiting();
      stopRetry();
      callId = p.callId ?? null;
      onGrant?.(grantOf(p));
      return true;
    },

    /* Noltbook says the note's call changed under us -- it ended, or it is a
     * new incarnation. A different call-id is a different call. */
    snapshot(snap) {
      if (!note || !snap || snap.noteId !== note) return;
      const live = snap.call;
      if (!live || live.status !== 'active') {
        /* The call is over, whether or not we ever held a credential for it --
         * asking and being told "there is nothing there" is still an ending. */
        if (!ended) { callId = null; ended = true; say('ended'); }
        return;
      }
      ended = false;
      /* A live call where there was none, or a new one: news. Ask now, and
       * let the back-off start again from the beginning. */
      if (callId && live.callId !== callId) { callId = null; tries = 0; stopRetry(); ask(snap); }
      else if (!callId) {
        const participants = Array.isArray(live.participants) ? live.participants : [];
        const admitted = participants.includes(our);
        const joiningThis = askedKind === 'join-call' && askedCallId === live.callId;
        /* A fresh member can enter while the note subscription is still
         * delivering its initial call snapshot. We may already have sent
         * START, then learn that somebody else's call is live. START is a
         * deliberate no-op at the host in that case; switch immediately to
         * JOIN instead of waiting forever for an answer that cannot exist.
         * If the snapshot already lists us, access is being minted and a
         * second request would only duplicate it. */
        if (!admitted && (!joiningThis || now() - asked > ANSWER_MS)) ask(snap);
        else if (admitted && now() - asked > ANSWER_MS) ask(snap);
      }
    },

    /* The credential is short-lived; Noltbook reissues on request. */
    renew() { if (note) poke('renew-call-access', { noteId: note }); },
    /* The call server would not keep us: re-ask, backed off. */
    retry(reason = 'call failed') { return again(reason); },
    /* Media actually flowing: whatever went wrong before is over. */
    connected() { tries = 0; stopRetry(); },

    leave() {
      stopBeat();
      stopWaiting();
      stopRetry();
      cancel(rewatch); rewatch = null;
      tries = 0;
      if (note) poke('leave-call', { noteId: note });
      note = null;
      callId = null;
      asked = 0;
      askedKind = null;
      askedCallId = null;
      ended = false;
    },
    note: () => note,
    callId: () => callId,
    inCall: () => !!note && !!callId,
    retries: () => tries,
  };
  return api;
}
