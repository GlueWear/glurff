/* Calls progress independently of avatar movement. Retrying delivery keeps
 * the same operation ID; a new ID means a genuinely new join/renewal attempt.
 *
 * EVERY CALL IS ON THE GLURFF'S HOST (2026-10-31). This only ever ASKS: a
 * knock to the host's ship -- our own agent, when we are that host -- which
 * lets us in or says why not, and a leave when we go. It never opens, renews
 * or admits anything itself; the host's agent does all of that. */
/* How long each side gets before the readout names it. Our own ship taking a
 * poke is usually instant; a host that has heard us answers within a beat. */
const OWN_SHIP_MS = 5000, HOST_SILENT_MS = 9000;
/* Refusals that asking again will not change while this call lasts. */
const FINAL = new Set(['booted', 'not-a-member']);
export class CallController {
  constructor({our, transport, sfu, changed, trace=()=>{}, now=Date.now,
    later=(fn,ms)=>setTimeout(fn,ms), cancel=id=>clearTimeout(id), fresh=()=>Date.now()*1000+Math.floor(Math.random()*1000)}) {
    Object.assign(this,{our,transport,sfu,changed,trace,now,later,cancel,fresh});
    this.current=null;this.phase='idle';this.closed=false;
    this.pendingSends=new Map();
  }
  emit(phase,reason=null) {
    this.phase=phase;
    this.trace('call-state',{phase,reason:reason??'',place:this.current?.place??0,attempt:this.current?.attempt??0,host:this.current?.host??''});
    this.changed(phase,reason);
  }
  clearTimers(c=this.current) {if(c)for(const k of ['retry','joining','renew']){this.cancel(c[k]);c[k]=null;}}
  select(target,{preserve=false}={}) {
    if(this.closed)return;
    if(target && this.current?.place===target.place && this.current.host===target.host)return;
    const old=this.current;
    /* The call actually carrying audio: the current one once connected, or --
     * while its replacement is being authorised or joining beside it -- the
     * one it would replace. `previous` is only ever held while it is live
     * (its socket dying clears it), so it is the one to keep. */
    const live=!old?null:this.phase==='connected'?old:(old.previous??null);
    const keeping=!!(preserve && target && live);
    const leave=r=>this.leave(r);
    this.clearTimers();this.current=null;
    if(!keeping){leave(old);if(old?.previous)leave(old.previous);this.sfu.close(null);}
    else if(live!==old){
      /* Changing our mind mid-switch: the half-joined replacement goes, the
       * call still carrying audio stays. */
      leave(old);this.sfu.abandonNext?.(null);
      if(live.place===target.place && live.host===target.host){
        this.current=live;this.trace('call-transition-reverted',{place:live.place,host:live.host,reason:'reselected'});
        this.emit('connected');this.scheduleRenew();return;
      }
    }
    if(!target){this.emit('idle');return;}
    this.current={...target,attempt:this.fresh(),mode:'renew-access',tries:0,failures:0,capacityFailures:0,grant:null,
                  began:this.now(),acceptedHere:false,heardHost:false,previous:keeping?live:null};
    this.emit(keeping?'transitioning':'requesting');this.request();
  }
  bounded(pending,key,send) {
    if(this.closed)return false;
    const busy=pending.get(key);
    if(busy) {
      /* THE NEWEST WAITS, THE OLDER ONES DO NOT. A newer request for the same
       * thing used to be dropped while an older one was stuck in flight -- for
       * as long as that took. It is kept now, replacing anything already
       * waiting, and goes the moment the one in flight settles. */
      busy.next=send;
      this.trace('call-send-skipped',{reason:'queued',count:pending.size});
      return false;
    }
    if(pending.size>=16) {
      /* A skipped send used to leave no trace, so a retry that never left the
       * browser looked identical to one the host ignored. */
      this.trace('call-send-skipped',{reason:'full',count:pending.size});
      return false;
    }
    const flight={next:null};pending.set(key,flight);
    const done=()=>{
      if(pending.get(key)!==flight)return;
      pending.delete(key);
      const next=flight.next;
      if(next && !this.closed)this.bounded(pending,key,next);
    };
    try {const p=send();if(p?.then)Promise.resolve(p).then(done,done);else done();}
    catch{done();return false;}
    return true;
  }
  /* We have left this call: the host hears it from our ship, ours included. */
  leave(r) {
    if(!r)return;
    try{Promise.resolve(this.transport.leave?.(r.host,r.place,r.attempt)).catch(()=>{});}catch{}
  }
  /* ASK THE HOST'S SHIP, agent to agent over Ames -- the way the credential
   * comes back. Same attempt, same retries. */
  ask(c,mode) {
    return this.bounded(this.pendingSends,`${c.host}/call-request/${c.place}`,()=>{
      const p=this.transport.knock(c.host,c.place,c.attempt,mode);
      Promise.resolve(p).then(()=>{if(this.current===c)c.acceptedHere=true;},()=>{});
      return p;
    });
  }
  /* What the person is actually waiting on, for the readout. Phases say what
   * the call is doing; this says who has not answered yet. */
  stage() {
    const c=this.current;
    if(!c)return 'idle';
    if(this.phase!=='requesting' && this.phase!=='transitioning')return this.phase;
    const waited=this.now()-(c.began??this.now());
    if(c.host===this.our)return c.acceptedHere||waited<=OWN_SHIP_MS?'requesting':'waiting-ship';
    if(!c.acceptedHere)return waited<=OWN_SHIP_MS?'requesting':'waiting-ship';
    if(!c.heardHost)return waited<=HOST_SILENT_MS?'requesting':'waiting-host';
    return 'requesting';
  }
  request() {
    const c=this.current;if(!c || this.closed || this.phase==='connected' || this.phase==='connecting' || this.phase==='blocked')return;
    this.cancel(c.retry);c.tries++;
    this.trace('call-request',{place:c.place,host:c.host,attempt:c.attempt,count:c.tries});
    this.ask(c,c.mode);
    c.retry=this.later(()=>{if(this.current===c)this.request();},Math.min(30000,4000*2**Math.min(c.tries-1,3)));
  }
  /* The host's answer to us, when it is not a credential: a refusal, with
   * why. Anything at all from it means it is there and has heard us. */
  receive(who,event) {
    const c=this.current;
    if(!Number.isSafeInteger(event.place) || !Number.isSafeInteger(event.attempt) || event.attempt<=0)return;
    if(!c || who!==c.host || event.place!==c.place || event.attempt!==c.attempt)return;
    c.heardHost=true;
    if(event.kind==='call-refused' && typeof event.reason==='string'){this.refusedBy(event.reason);return;}
    if(event.kind==='call-error' && typeof event.error==='string')this.fail(event.error);
  }
  /* The host turned us away. Removed from this call, or not in the Glurff:
   * that is the answer until something changes, and we stop asking. Anything
   * else -- a huddle's members not registered yet, or not including us yet --
   * settles within a second or two, so retry soon, a few times, instead of
   * backing off. */
  refusedBy(reason) {
    const c=this.current;
    if(!c || this.phase==='connected' || this.phase==='connecting' || this.phase==='blocked')return;
    if(FINAL.has(reason)){
      this.trace('call-refused',{place:c.place,attempt:c.attempt,reason,count:0});
      this.clearTimers();c.error=reason;this.emit('blocked',reason);return;
    }
    c.refusals=(c.refusals??0)+1;
    this.trace('call-refused',{place:c.place,attempt:c.attempt,reason,count:c.refusals});
    if(c.refusals>5)return;            //  back to the ordinary backoff
    this.cancel(c.retry);
    c.retry=this.later(()=>{if(this.current===c){c.tries=Math.max(0,c.tries-1);this.request();}},2000);
  }
  result(name,p) {
    const [rawPlace,who,rawAttempt]=String(p.context??'').split('/');
    const place=Number(rawPlace?.replace(/\./g,'')),attempt=Number(rawAttempt?.replace(/\./g,''));
    if(!Number.isSafeInteger(place)||!Number.isSafeInteger(attempt)||!attempt)return;
    const participant=name==='call-granted'?p.participant:(p.who||who);
    if(participant!==this.our)return;
    const c=this.current;
    if(!c || c.place!==place || c.attempt!==attempt || who!==this.our)return;
    if(name==='call-failed'){this.fail(p.err);return;}
    if(name!=='call-granted')return;
    if(c.grant && p.group===c.grant.group && p.sfu===c.grant.sfu &&
      ((p.gen??0)<(c.grant.gen??0) || p.expires<c.grant.expires))return;
    this.cancel(c.retry);c.retry=null;
    const hadError=!!c.error;
    c.capacityFailures=0;c.error=null;c.lastFailure=null;
    c.grant=p;
    if(Number.isFinite(p.expires) && p.expires<=this.now()+5000){this.reconnect('expired');return;}
    if(this.phase==='connected') {
      if(this.sfu.refreshGrant?.(p)===false){this.reconnect('room-changed');return;}
      if(hadError)this.emit('connected');
      this.scheduleRenew();return;
    }
    if(this.phase==='connecting')return;
    /* CONNECT BEFORE BREAK. The old conversation stays audible while the
     * replacement credential is minted AND while the new socket joins beside
     * it; the commit point is the call server accepting us into the new room
     * (see `status`). A replacement that cannot join is abandoned and we go
     * back to the call we never left. With no live old call to keep, there is
     * nothing to overlap and the old host is told now. */
    this.emit('connecting');
    this.sfu.connect(p,{overlap:!!c.previous});
    if(c.previous && !this.sfu.switching?.()){const old=c.previous;c.previous=null;this.leave(old);}
    if(this.phase==='connecting')c.joining=this.later(()=>{if(this.current===c && this.phase==='connecting')this.reconnect('join-timeout');},45000);
  }
  status(phase,reason) {
    const c=this.current;
    if(!c)return;
    if(phase==='connected') {
      /* The replacement joined: this is the commit point. Only now is the old
       * host told we have gone. */
      if(c.previous){const old=c.previous;c.previous=null;
        if(!(old.host===c.host && old.place===c.place))this.leave(old);
        this.trace('call-transition-committed',{place:c.place,host:c.host,reason:`${old.place}/${old.host}`});}
      this.cancel(c.joining);c.joining=null;c.failures=0;
      this.emit('connected');this.scheduleRenew();return;
    }
    if(phase==='handoff-failed'){
      /* The new room would not have us. The old call is still up -- go back
       * to it, and tell the new host we are not coming after all. */
      this.trace('call-handoff-failed',{place:c.place,host:c.host,reason:reason??''});
      this.leave(c);
      if(this.revertTransition(reason||'handoff-failed'))return;
      this.reconnect(reason||'handoff-failed');
      return;
    }
    if(phase==='failed' || phase==='closed'){
      /* While authorising a replacement, SFU status still belongs to the old
       * socket. If that socket dies there is nothing left to preserve -- but a
       * replacement already joining beside it is left to finish. */
      if(c.previous){const old=c.previous;c.previous=null;this.leave(old);}
      if(this.sfu.switching?.())return;
      this.reconnect(reason||'disconnected');
    }
  }
  scheduleRenew() {
    const c=this.current;if(!c)return;
    this.cancel(c.renew);
    // The room lease is deliberately short. Refresh while actually occupied;
    // idle rooms expire instead of consuming quota for an hour.
    const due=Number.isFinite(c.grant?.renewAfter)?c.grant.renewAfter-this.now():60000;
    const expiry=Number.isFinite(c.grant?.expires)?(c.grant.expires-this.now())/2:60000;
    c.renew=this.later(()=>{
      if(this.current!==c || this.phase!=='connected')return;
      // The host renews the room's lease itself when it renews our access.
      c.attempt=this.fresh();c.mode='renew-access';c.tries=0;
      // Keep the live SFU connection while refreshing credentials.
      const refresh=()=>{
        if(this.current!==c || this.phase!=='connected')return;
        this.ask(c,'renew-access');
        c.retry=this.later(refresh,30000);
      };
      refresh();
    },Math.max(1000,Math.min(60000,due,expiry)));
  }
  fail(error) {
    const c=this.current;if(!c)return;
    // The same broker failure may arrive directly and via the host's relay.
    const failure=`${c.attempt}/${error}`;
    if(c.lastFailure===failure)return;
    c.lastFailure=failure;
    this.trace('call-failed',{place:c.place,attempt:c.attempt,reason:error});
    if(['quota','rate-limited','participant-limit','service-unavailable'].includes(error)) {
      const live=this.phase==='connected' || !!c.previous;
      this.clearTimers();c.error=error;c.capacityFailures++;
      if(c.previous && c.capacityFailures>3){this.revertTransition(error);return;}
      this.emit(c.previous?'transitioning':live?'connected':'blocked',error);
      // Three spaced probes, then an explicit Retry button. A renewal failure
      // does not tear down media that is still flowing.
      if(c.capacityFailures<=3)c.retry=this.later(()=>{
        if(this.current!==c)return;
        c.retry=null;c.attempt=this.fresh();c.mode='renew-access';c.tries=0;c.reconnecting=false;
        if(live){
          this.ask(c,c.mode);
          // A lost response consumes a bounded probe too. Do not schedule from
          // an already-expired grant and accidentally renew every second.
          c.retry=this.later(()=>{if(this.current===c)this.fail(error);},30000);
        }else{c.began=this.now();c.acceptedHere=false;c.heardHost=false;this.emit('requesting');this.request();}
      },[15000,30000,60000][c.capacityFailures-1]);
      return;
    }
    if(error==='unauthorized') {
      if(this.revertTransition(error))return;
      this.clearTimers();c.error=error;this.emit('blocked',error);return;
    }
    this.reconnect(error);
  }
  reconnect(reason) {
    const c=this.current;if(!c || this.closed || this.phase==='blocked' || c.reconnecting)return;
    const preserving=!!c.previous;
    c.reconnecting=true;this.clearTimers();if(!preserving)this.sfu.close(null);
    c.failures++;this.emit(preserving?'transitioning':'retrying',reason);
    if(c.failures>4){c.reconnecting=false;if(this.revertTransition(reason))return;c.error=reason;this.emit('blocked',reason);return;}
    c.retry=this.later(()=>{
      if(this.current!==c)return;
      c.reconnecting=false;c.attempt=this.fresh();c.tries=0;c.mode='renew-access';c.grant=null;
      c.began=this.now();c.acceptedHere=false;c.heardHost=false;
      this.emit(preserving?'transitioning':'requesting');this.request();
    },Math.min(30000,2000*2**(c.failures-1)));
  }
  revertTransition(reason) {
    const c=this.current,old=c?.previous;
    if(!old)return false;
    this.clearTimers(c);
    this.trace('call-transition-reverted',{place:c.place,host:c.host,reason});
    this.current=old;
    this.emit('connected');
    this.scheduleRenew();
    return true;
  }
  /* Fresh credentials for the call we are in, now, without touching media:
   * the call watchdog's second repair. A grant for a different room on the
   * server reconnects; the same room just keeps the new token. */
  refresh() {
    const c=this.current;if(!c || this.closed || this.phase!=='connected')return false;
    this.cancel(c.retry);
    c.attempt=this.fresh();c.mode='renew-access';c.tries=0;
    this.trace('call-refresh',{place:c.place,host:c.host,attempt:c.attempt});
    this.ask(c,'renew-access');
    return true;
  }
  restored() {if(this.current && this.phase!=='connected' && this.phase!=='connecting' && this.phase!=='blocked')this.request();}
  retry() {
    const target=this.current?{place:this.current.place,host:this.current.host}:null;
    if(!target)return;
    this.select(null);this.select(target);
  }
  diagnostics(){const c=this.current;return c?{place:c.place,host:c.host,phase:this.phase,
    attempt:c.attempt,preserving:!!c.previous,previous:c.previous?`${c.previous.place}/${c.previous.host}`:null}:null;}
  close() {this.select(null);this.closed=true;}
}
