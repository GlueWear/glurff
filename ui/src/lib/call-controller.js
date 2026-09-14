/* Calls progress independently of avatar movement. Retrying delivery keeps
 * the same operation ID; a new ID means a genuinely new join/renewal attempt. */
export class CallController {
  constructor({our, transport, sfu, accepts, changed, known=()=>true, trace=()=>{}, now=Date.now,
    later=(fn,ms)=>setTimeout(fn,ms), cancel=id=>clearTimeout(id), fresh=()=>Date.now()*1000+Math.floor(Math.random()*1000)}) {
    Object.assign(this,{our,transport,sfu,accepts,changed,known,trace,now,later,cancel,fresh});
    this.current=null;this.phase='idle';this.admissions=new Map();this.hosted=new Map();this.closed=false;
    this.pendingOperations=new Map();this.pendingSends=new Map();this.refusals=new Map();
  }
  emit(phase,reason=null) {
    this.phase=phase;
    this.trace('call-state',{phase,reason:reason??'',place:this.current?.place??0,attempt:this.current?.attempt??0,host:this.current?.host??''});
    this.changed(phase,reason);
  }
  clearTimers(c=this.current) {if(c)for(const k of ['retry','joining','renew']){this.cancel(c[k]);c[k]=null;}}
  select(target) {
    if(this.closed)return;
    if(target && this.current?.place===target.place && this.current.host===target.host)return;
    const old=this.current;
    this.clearTimers();this.current=null;
    if(old && old.host!==this.our)this.send(old.host,{kind:'call-leave',place:old.place,attempt:old.attempt});
    this.sfu.close(null);
    if(!target){this.emit('idle');return;}
    for(const [place,r] of this.hosted)if(r.until<this.now())this.hosted.delete(place);
    this.current={...target,attempt:this.fresh(),mode:'renew-access',tries:0,failures:0,capacityFailures:0,grant:null};
    this.emit('requesting');this.request();
  }
  bounded(pending,key,send) {
    if(this.closed)return false;
    if(pending.has(key) || pending.size>=16) {
      /* A skipped send used to leave no trace, so a retry that never left the
       * browser looked identical to one the host ignored. */
      this.trace('call-send-skipped',{reason:pending.has(key)?'pending':'full',count:pending.size});
      return false;
    }
    const flight={};pending.set(key,flight);
    const done=()=>{if(pending.get(key)===flight)pending.delete(key);};
    try {const p=send();if(p?.then)Promise.resolve(p).then(done,done);else done();}
    catch{done();return false;}
    return true;
  }
  send(who,event) {return this.bounded(this.pendingSends,`${who}/${event.kind}/${event.place}`,()=>this.transport.send(who,event));}
  request() {
    const c=this.current;if(!c || this.closed || this.phase==='connected' || this.phase==='connecting' || this.phase==='blocked')return;
    this.cancel(c.retry);c.tries++;
    this.trace('call-request',{place:c.place,host:c.host,attempt:c.attempt,count:c.tries});
    if(c.host===this.our) {
      let room=this.hosted.get(c.place);
      if(!room) {
        room={ready:false,openAttempt:c.attempt,until:this.now()+180000};
        this.hosted.set(c.place,room);
      }
      const op=room.ready?'renew-access':'open';
      this.operation(op,c.place,this.our,c.attempt);
    } else this.send(c.host,{kind:'call-request',place:c.place,attempt:c.attempt,mode:c.mode});
    c.retry=this.later(()=>{if(this.current===c)this.request();},Math.min(30000,4000*2**Math.min(c.tries-1,3)));
  }
  operation(op,place,who,attempt) {
    // The slot survives call transitions: a slow local ACK must not let every
    // new join attempt add another operation for the same participant/room.
    return this.bounded(this.pendingOperations,`${place}/${who}`,()=>this.transport.operation(op,place,who,attempt));
  }
  receive(who,event) {
    const c=this.current;
    if(!Number.isSafeInteger(event.place) || !Number.isSafeInteger(event.attempt) || event.attempt<=0)return;
    if(event.kind==='call-request') {
      const reason=!c?'not-hosting':c.host!==this.our?'not-host':c.place!==event.place?'place-mismatch':!this.accepts(who,event.place)?'not-present':null;
      if(reason) {
        this.trace('call-request-dropped',{who,place:event.place,attempt:event.attempt,reason});
        /* Answer rather than go silent. A guest whose request vanishes cannot
         * tell "the host sees you somewhere else" from "the host is slow", so it
         * backs off towards thirty seconds; told why, it retries as soon as the
         * two views of the world agree. Only people we can see get an answer,
         * and at most one every two seconds per guest and place. */
        if(!this.known(who))return;
        const key=`${who}/${event.place}`,last=this.refusals.get(key)??-Infinity;
        if(this.now()-last<2000)return;
        this.refusals.set(key,this.now());
        if(this.refusals.size>128)this.refusals.delete(this.refusals.keys().next().value);
        this.send(who,{kind:'call-refused',place:event.place,attempt:event.attempt,reason});
        return;
      }
      const key=event.place+'/'+who;
      let a=this.admissions.get(key);
      if(a && event.attempt<a.attempt)return;
      if(!a || a.attempt!==event.attempt) {
        if(a && this.now()-a.started<2000)return;
        a={who,place:event.place,attempt:event.attempt,mode:'renew-access',started:this.now(),sent:-Infinity,tries:0};
        this.admissions.set(key,a);
        if(this.admissions.size>128)this.admissions.delete(this.admissions.keys().next().value);
      }
      this.send(who,{kind:'call-wait',place:a.place,attempt:a.attempt});
      if(this.phase==='blocked') {
        this.send(who,{kind:'call-error',place:a.place,attempt:a.attempt,error:c.error});return;
      }
      this.admit(a);return;
    }
    if(event.kind==='call-leave') {
      const key=event.place+'/'+who,a=this.admissions.get(key);
      if(a?.attempt===event.attempt)this.admissions.delete(key);
      return;
    }
    if(!c || who!==c.host || event.place!==c.place || event.attempt!==c.attempt)return;
    if(event.kind==='call-refused' && typeof event.reason==='string'){this.refusedBy(event.reason);return;}
    if(event.kind==='call-error' && typeof event.error==='string')this.fail(event.error);
    // Acknowledgement means the elected host is alive. Never elect another
    // host merely because ticket delivery or the SFU connection is slow.
  }
  /* The host saw our request and turned it away because its view of where we
   * are disagrees with ours. That settles within a second or two once positions
   * agree, so retry soon -- a few times -- instead of backing off. */
  refusedBy(reason) {
    const c=this.current;
    if(!c || this.phase==='connected' || this.phase==='connecting' || this.phase==='blocked')return;
    c.refusals=(c.refusals??0)+1;
    this.trace('call-refused',{place:c.place,attempt:c.attempt,reason,count:c.refusals});
    if(c.refusals>5)return;            //  back to the ordinary backoff
    this.cancel(c.retry);
    c.retry=this.later(()=>{if(this.current===c){c.tries=Math.max(0,c.tries-1);this.request();}},2000);
  }
  admit(a) {
    if(!this.hosted.get(a.place)?.ready || !this.accepts(a.who,a.place))return;
    if(this.now()-a.sent<Math.min(30000,4000*2**Math.min(a.tries,3)))return;
    if(a.error){this.send(a.who,{kind:'call-error',place:a.place,attempt:a.attempt,error:a.error});return;}
    if(this.operation(a.mode,a.place,a.who,a.attempt)){a.sent=this.now();a.tries++;}
  }
  result(name,p) {
    const [rawPlace,who,rawAttempt]=String(p.context??'').split('/');
    const place=Number(rawPlace?.replace(/\./g,'')),attempt=Number(rawAttempt?.replace(/\./g,''));
    if(!Number.isSafeInteger(place)||!Number.isSafeInteger(attempt)||!attempt)return;
    const participant=name==='call-granted'?p.participant:(p.who||who);
    if(participant!==this.our) {
      const a=this.admissions.get(place+'/'+participant);
      if(a?.attempt===attempt && name==='call-failed') {
        a.error=p.err;this.send(participant,{kind:'call-error',place,attempt,error:p.err});
      }
      return;
    }
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
    if(c.host===this.our) {
      const room=this.hosted.get(c.place);
      if(room){room.ready=true;room.until=this.now()+180000;}
      for(const a of this.admissions.values())if(a.place===c.place)this.admit(a);
    }
    if(Number.isFinite(p.expires) && p.expires<=this.now()+5000){this.reconnect('expired');return;}
    if(this.phase==='connected') {
      if(this.sfu.refreshGrant?.(p)===false){this.reconnect('room-changed');return;}
      if(hadError)this.emit('connected');
      this.scheduleRenew();return;
    }
    if(this.phase==='connecting')return;
    this.emit('connecting');
    this.sfu.connect(p);
    if(this.phase==='connecting')c.joining=this.later(()=>{if(this.current===c && this.phase==='connecting')this.reconnect('join-timeout');},45000);
  }
  status(phase,reason) {
    if(!this.current)return;
    if(phase==='connected') {
      this.cancel(this.current.joining);this.current.joining=null;this.current.failures=0;
      this.emit('connected');this.scheduleRenew();return;
    }
    if(phase==='failed' || phase==='closed')this.reconnect(reason||'disconnected');
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
      // Lease and access use independent slots but are sent in this order.
      // Local ACKs do not prove broker completion; gen-only replies are safe.
      if(c.host===this.our)this.bounded(this.pendingOperations,`lease/${c.place}`,()=>this.transport.operation('renew-room',c.place,this.our,this.fresh()));
      c.attempt=this.fresh();c.mode='renew-access';c.tries=0;
      // Keep the live SFU connection while refreshing credentials.
      const refresh=()=>{
        if(this.current!==c || this.phase!=='connected')return;
        if(c.host===this.our)this.operation('renew-access',c.place,this.our,c.attempt);
        else this.send(c.host,{kind:'call-request',place:c.place,attempt:c.attempt,mode:'renew-access'});
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
      const live=this.phase==='connected';
      this.clearTimers();c.error=error;c.capacityFailures++;
      this.emit(live?'connected':'blocked',error);
      // Three spaced probes, then an explicit Retry button. A renewal failure
      // does not tear down media that is still flowing.
      if(c.capacityFailures<=3)c.retry=this.later(()=>{
        if(this.current!==c)return;
        c.retry=null;c.attempt=this.fresh();c.mode='renew-access';c.tries=0;c.reconnecting=false;
        if(live){
          if(c.host===this.our)this.operation('renew-access',c.place,this.our,c.attempt);
          else this.send(c.host,{kind:'call-request',place:c.place,attempt:c.attempt,mode:c.mode});
          // A lost response consumes a bounded probe too. Do not schedule from
          // an already-expired grant and accidentally renew every second.
          c.retry=this.later(()=>{if(this.current===c)this.fail(error);},30000);
        }else{this.emit('requesting');this.request();}
      },[15000,30000,60000][c.capacityFailures-1]);
      return;
    }
    if(error==='unauthorized') {
      this.clearTimers();c.error=error;this.emit('blocked',error);return;
    }
    if(['room-unavailable','room-ended','expired'].includes(error) && c.host===this.our)this.hosted.delete(c.place);
    this.reconnect(error);
  }
  reconnect(reason) {
    const c=this.current;if(!c || this.closed || this.phase==='blocked' || c.reconnecting)return;
    c.reconnecting=true;this.clearTimers();this.sfu.close(null);
    c.failures++;this.emit('retrying',reason);
    if(c.failures>4){c.reconnecting=false;c.error=reason;this.emit('blocked',reason);return;}
    c.retry=this.later(()=>{
      if(this.current!==c)return;
      c.reconnecting=false;c.attempt=this.fresh();c.tries=0;c.mode='renew-access';c.grant=null;
      this.emit('requesting');this.request();
    },Math.min(30000,2000*2**(c.failures-1)));
  }
  restored() {if(this.current && this.phase!=='connected' && this.phase!=='connecting' && this.phase!=='blocked')this.request();}
  retry() {
    const target=this.current?{place:this.current.place,host:this.current.host}:null;
    if(!target)return;
    this.select(null);this.select(target);
  }
  close() {this.select(null);this.closed=true;this.admissions.clear();this.hosted.clear();}
}
