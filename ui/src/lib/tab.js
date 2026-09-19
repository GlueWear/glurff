/* ONE LIVE GLURFF PER BROWSER.
 *
 * Two tabs of the same ship are not two people. The older one keeps a relay
 * connection, an Eyre channel and a presence session that nobody is looking at:
 * it never acknowledges positions, so everyone who can see that ship falls back
 * to sending positions over their ships, and it shows up beside the live tab as
 * a second copy of the same person.
 *
 * NEWEST WINS, because that is the one the person is looking at -- a reload
 * simply replaces itself. Two signals, either of which is enough:
 *
 *   Web Locks  the new tab STEALS the lock, which rejects the old holder's
 *              request. This works even where storage events do not.
 *   storage    the new tab writes its claim; other tabs hear the write.
 *
 * The old tab is then told to stand down. It says goodbye, closes what it is
 * holding and offers to take over again.
 */
export function createTabGuard({locks=null, storage=null, id, name='glurff-live',
                                onSuperseded=()=>{}, now=Date.now}={}) {
  let held=false, superseded=false, release=null;
  function standDown(reason) {
    if(superseded || !held)return;
    superseded=true;held=false;
    try {release?.();} catch {}
    release=null;
    try {onSuperseded(reason);} catch {}
  }
  return {
    /* Become the live tab. Any older tab of this ship stands down. */
    claim() {
      if(superseded)return false;
      held=true;
      try {storage?.setItem(name,JSON.stringify({id,at:now()}));} catch {}
      if(locks?.request) {
        try {
          const p=locks.request(name,{mode:'exclusive',steal:true},()=>new Promise(done=>{release=done;}));
          /* Stolen by a newer tab: our own request rejects. Any other failure
           * leaves the storage claim as the remaining signal. */
          p?.catch?.(()=>standDown('lock-stolen'));
        } catch {}
      }
      return true;
    },
    /* A storage event for our key. Another tab of this ship has claimed it. */
    heard(raw) {
      if(typeof raw!=='string')return;
      let claim;
      try {claim=JSON.parse(raw);} catch {return;}
      if(claim && claim.id && claim.id!==id)standDown('another-tab');
    },
    live:()=>held && !superseded,
    superseded:()=>superseded,
    /* Leaving on our own terms -- closing the tab. Not a takeover. */
    close() {
      held=false;
      try {release?.();} catch {}
      release=null;
    },
  };
}
