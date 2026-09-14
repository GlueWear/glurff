/* Transient, viewer-directed presence. A route is a short-lived subscription,
 * not a saved roster. Ames authenticates each adjacent sender; as with the pal
 * graph itself, introductions trust the pals forwarding them.
 *
 * Two ways to run.
 *
 * TARGETED -- the app. The app says which pals are in it right now: Glurff reads
 * Noltbook's "In Glurff" list, and Noltbook announces to your pals when someone
 * opens it, closes it, or their tab stops and their ship says so. Presence then
 * runs on those events instead of repeating itself. A pal who appears on the
 * list is asked once and answers once; after that only changes are sent. A pal
 * who leaves the list is dropped at once, with everything seen through them.
 * A pal who is not in the app is never asked anything.
 *
 * LEASED -- no list (tests, and anything older). Every pal is asked every
 * DISCOVER_MS, and anything not renewed within LEASE_MS expires.
 */
/* Leased: how long a peer, a route or a discovery request lives without
 * renewal. Nine missed beats, so a slow ship, a connection being rebuilt or a
 * browser throttling a background tab does not make somebody vanish. Leaving is
 * never waited out -- a departure, a cut or a block removes someone at once. */
export const LEASE_MS = 90000;
export const DISCOVER_MS = 10000;
/* Targeted: how long to wait for the app's list before asking every pal
 * anyway, and how often after that. A list that never arrives must not leave
 * everybody invisible. */
export const LIST_WAIT_MS = 60000;
export const SWEEP_MS = 180000;
/* Targeted: a pal who answers but is not on the list -- a list that has not
 * caught up, or an older Noltbook -- is kept the leased way, renewed this often. */
export const UNLISTED_RENEW_MS = 30000;
/* Targeted: coming back to the tab asks again at most this often. */
const RESTART_MS = 30000;
const MAX_ROUTES = 256, MAX_SESSIONS = 1024, MAX_FANOUT = 64;
const id = s => typeof s === 'string' && s.length > 0 && s.length <= 100;
const ship = s => typeof s === 'string' && /^~[a-z-]{3,70}$/.test(s);
const num = n => Number.isSafeInteger(n) && n >= 0;
const prefix = (a,b) => a.length <= b.length && a.every((s,i)=>s===b[i]);
export function createPresence({our, session, social, snapshot, send, changed, trace=()=>{}, now=Date.now, targeted=false}) {
  let active=false, greeting=0, generation=0, sequence=0, queryAt=0, signature='';
  let present=new Set(), listed=false, startedAt=0, lastSweep=-Infinity, renewAt=0;
  const routes=new Map(), members=new Map(), neighbors=new Map();
  const queries=new Map(), previousRoutes=new Map(), asked=new Set();
  const graph=()=>social().pals;
  const blocked=s=>graph()[s]==='blocked';
  /* Every pal we may ask. The fan-out cap applies to what is SENT, never to who
   * counts: a cap here hid everyone past the sixty-fourth pal. */
  const direct=()=>Object.keys(graph()).filter(s=>s!==our && ['mutual','requesting'].includes(graph()[s])).sort();
  const trusted=s=>['mutual','requesting','requested'].includes(graph()[s]);
  /* Whether we would still accept this route's query today. */
  const routeAllowed=r=>!blocked(r.origin) && !r.path.some(blocked) && (r.path.length===2 ? trusted(r.path[0]) : graph()[r.path.at(-2)]==='mutual');
  const depth=()=>Math.max(0,Math.min(3,Number(social().dial)||0))+1;
  const emit=(to,p)=> { if(to===our || blocked(to))return;try {Promise.resolve(send(to,p)).catch(()=>{});}catch{} };
  const routeKey=p=>p.origin+'/'+p.viewer;
  const validPath=p=>Array.isArray(p) && p.length>=1 && p.length<=5 && p.every(ship) && new Set(p).size===p.length && !p.some(blocked);
  /* Targeted: a member or route lives while the pal it comes through is in the
   * app. Anything else -- and everything, leased -- lives by its lease. */
  const anchored=hop=>targeted && present.has(hop);
  const memberLive=m=>anchored(m.path[1]) || now()-m.at<LEASE_MS;
  const routeLive=r=>anchored(r.path.at(-2)) || now()-r.at<LEASE_MS;
  /* Targeted, with no list after the wait: behave as if everyone may be in. */
  const sweeping=()=>targeted && !listed && now()-startedAt>=LIST_WAIT_MS;
  const seenThrough=s=>{for(const m of members.values())if(!m.gone && m.path[1]===s)return true;return false;};
  /* Whom a discovery goes to, and whom a viewer's discovery is passed on to. */
  const targets=(all=false)=>(!targeted || all ? direct() : direct().filter(s=>present.has(s) || seenThrough(s))).slice(0,MAX_FANOUT);
  const reach=s=>!targeted || sweeping() || present.has(s);
  function list() {
    const ships=new Map(), allowed=new Set(direct());
    for(const m of members.values()) {
      if(m.gone || !memberLive(m) || m.path.length-1>depth() || !allowed.has(m.path[1]) || m.path.some(blocked))continue;
      const prev=ships.get(m.who);
      if(!prev || m.at>prev.at)ships.set(m.who,m);
    }
    return ships;
  }
  const notify=()=>changed(list());
  function reply(r, here) {
    emit(r.path.at(-2),{kind:'state',origin:r.origin,viewer:r.viewer,generation:r.generation,path:r.path,session,sequence:++sequence,here});
  }
  function discardRoute(r) {
    emit(r.path.at(-2),{kind:'cut',origin:r.origin,viewer:r.viewer,generation:r.generation,path:r.path});
    for(const child of r.children)emit(child,{kind:'cancel',origin:r.origin,viewer:r.viewer,generation:r.generation});
  }
  const query=()=>({kind:'query',origin:our,viewer:session,generation,greeting,max:depth(),path:[our]});
  function queryTo(ships) {
    for(const s of ships){asked.add(s);emit(s,query());}
  }
  /* A new discovery. Older ones stay valid while anyone we see still answers
   * on them: targeted, an answer can come long after it was asked for. */
  function discover(all=false) {
    if(!active)return;
    generation++;queryAt=now();
    queries.set(generation,queryAt);
    const inUse=new Set([...members.values()].map(m=>m.generation));
    for(const [g,at] of queries)if(g!==generation && now()-at>=LEASE_MS && !inUse.has(g))queries.delete(g);
    const to=targets(all);
    trace('presence-discover',{generation,count:to.length});
    queryTo(to);
  }
  /* One pal, on the current discovery. */
  function ask(s) {
    if(!active)return;
    if(!generation){discover();return;}
    queryTo([s]);
  }
  function update() {
    if(!active)return;
    const next=JSON.stringify([social().dial,Object.entries(graph()).sort()]);
    if(next===signature)return;
    const first=signature==='';
    signature=next;
    if(first){discover();return;}
    /* A pal or dial change used to forget everyone AND tell every viewer to forget
     * us, so one pal request anywhere dropped every avatar and every call until
     * discovery answered again. Now only what the change revokes is cut: our own
     * view is filtered on every read (list), routes we answer for somebody no
     * longer trusted are cut, and branches through a pal we no longer forward to
     * are withdrawn. Everyone else stays while we ask again. */
    let cut=0;
    for(const [k,r] of routes) {
      if(!routeAllowed(r)) {
        discardRoute(r);routes.delete(k);cut++;
        /* A viewer we have just blocked is still told: emit() sends nothing to
         * a blocked ship, and without this cut they would keep a frozen copy of
         * us. Only the cut goes -- never a position. */
        if(blocked(r.path.at(-2)))try{Promise.resolve(send(r.path.at(-2),{kind:'cut',origin:r.origin,viewer:r.viewer,generation:r.generation,path:r.path})).catch(()=>{});}catch{}
        continue;
      }
      r.children=r.children.filter(child=>{
        if(graph()[child]==='mutual' && !blocked(child))return true;
        emit(child,{kind:'cancel',origin:r.origin,viewer:r.viewer,generation:r.generation});
        emit(r.path.at(-2),{kind:'cut',origin:r.origin,viewer:r.viewer,generation:r.generation,path:[...r.path,child]});
        cut++;return false;
      });
    }
    trace('presence-graph-changed',{count:cut});
    notify();discover();
  }
  /* Targeted: the app's list of pals in it. Arrivals are asked once and passed
   * on to viewers who asked for pals of pals; leavers are dropped. */
  function setPresent(ships) {
    const next=new Set([...ships].filter(s=>ship(s) && s!==our));
    const added=[...next].filter(s=>!present.has(s)), left=[...present].filter(s=>!next.has(s));
    present=next;listed=true;
    if(!active || !targeted || (!added.length && !left.length))return;
    trace('presence-list',{count:next.size,reason:`+${added.length}/-${left.length}`});
    for(const s of left)leftApp(s);
    for(const s of added){if(direct().includes(s))ask(s);introduce(s);}
  }
  /* They closed the app, or their tab stopped and their ship said so. Drop them
   * and whatever we saw through them, stop answering for them, and withdraw them
   * from anyone we passed their way. */
  function leftApp(s) {
    let lost=false, indirect=false;
    for(const [k,m] of members)if(m.who===s || m.path.includes(s)){if(m.who!==s)indirect=true;members.delete(k);lost=true;}
    for(const [k,r] of routes) {
      if(r.origin===s || r.path.includes(s)) {
        if(r.path.at(-2)===s)for(const child of r.children)emit(child,{kind:'cancel',origin:r.origin,viewer:r.viewer,generation:r.generation});
        else discardRoute(r);
        routes.delete(k);continue;
      }
      if(r.children.includes(s)) {
        r.children=r.children.filter(c=>c!==s);
        emit(r.path.at(-2),{kind:'cut',origin:r.origin,viewer:r.viewer,generation:r.generation,path:[...r.path,s]});
      }
    }
    asked.delete(s);
    if(lost){trace('presence-left',{who:s});notify();}
    /* Somebody seen only through them may still be reachable another way. */
    if(indirect)discover();
  }
  /* A pal who just arrived is passed every viewer's discovery that wants pals
   * of pals, once -- not at the viewer's next repeat, which no longer comes. */
  function introduce(s) {
    if(graph()[s]!=='mutual' || blocked(s))return;
    for(const r of routes.values()) {
      if(!routeLive(r) || r.path.length-1>=r.max || r.path.includes(s) || r.children.includes(s) || r.children.length>=MAX_FANOUT)continue;
      r.children.push(s);
      emit(s,{kind:'query',origin:r.origin,viewer:r.viewer,generation:r.generation,greeting:r.greeting,max:r.max,path:r.path});
    }
  }
  function receive(from,p) {
    if(!active || !ship(from) || !p || !ship(p.origin) || !id(p.viewer) || !num(p.generation) || blocked(from) || blocked(p.origin))return;
    const key=routeKey(p);
    if(p.kind==='query') {
      if(!num(p.greeting) || !trusted(from) || !validPath(p.path) || p.path[0]!==p.origin || p.path.at(-1)!==from || p.path.includes(our) || !num(p.max) || p.max<1 || p.max>4 || p.path.length>p.max)return;
      // Beyond the first edge, only mutual pals may introduce another hop.
      if(p.path.length>1 && graph()[from]!=='mutual')return;
      const old=routes.get(key);
      if(old && (p.generation<old.generation || (p.generation===old.generation && p.path.length+1>=old.path.length)))return;
      if(!old && routes.size>=MAX_ROUTES)return;
      if(old){previousRoutes.set(key+'/'+old.generation,old);if(previousRoutes.size>MAX_ROUTES)previousRoutes.delete(previousRoutes.keys().next().value);}
      if(old)for(const child of old.children)emit(child,{kind:'cancel',origin:old.origin,viewer:old.viewer,generation:old.generation});
      const r={...p,path:[...p.path,our],at:now(),children:[]};
      routes.set(key,r);
      reply(r,snapshot());
      if(r.path.length-1<p.max) {
        r.children=Object.keys(graph()).filter(s=>graph()[s]==='mutual' && !r.path.includes(s) && reach(s)).sort().slice(0,MAX_FANOUT);
        for(const child of r.children)emit(child,{...p,path:r.path});
      }
      // A newly ready neighbor gets our discovery request immediately too.
      const newGreeting = neighbors.get(key)?.greeting!==p.greeting;
      if(p.path.length===1) {
        neighbors.set(key,{at:now(),greeting:p.greeting});
        if(neighbors.size>MAX_ROUTES)neighbors.delete(neighbors.keys().next().value);
        if(newGreeting) {
          if(!targeted)discover();
          else if(direct().includes(from))ask(from);
        }
      }
      return;
    }
    if(p.kind==='cancel') {
      const r=routes.get(key);
      /* The canceller already knows: pass the cancel on, never a cut back. */
      if(r && r.path.at(-2)===from && p.generation===r.generation) {
        for(const child of r.children)emit(child,{kind:'cancel',origin:r.origin,viewer:r.viewer,generation:r.generation});
        routes.delete(key);
      }
      return;
    }
    if(!['state','cut'].includes(p.kind) || !validPath(p.path) || p.path[0]!==p.origin)return;
    if(p.origin===our && p.viewer===session) {
      if(!queries.has(p.generation) || (p.generation!==generation && !targeted && now()-queries.get(p.generation)>=LEASE_MS) || p.path[1]!==from || !direct().includes(from) || p.path.length-1>depth()){trace('presence-rejected',{who:p.path.at(-1),reason:'discovery-or-visibility',generation:p.generation});return;}
      if(p.kind==='cut') {
        for(const [k,m] of members)if(p.generation>=m.generation && prefix(p.path,m.path)){trace('presence-cut',{who:m.who,generation:p.generation});members.delete(k);}
        notify();return;
      }
      if(!id(p.session) || !num(p.sequence))return;
      const who=p.path.at(-1), mk=who+'/'+p.session;
      const prev=members.get(mk);
      // Leased only: targeted, a long silence between changes is normal.
      if(prev && !targeted)trace('presence-received',{who,gap:now()-prev.at,sequence:p.sequence,generation:p.generation});
      if(prev && p.sequence<=prev.sequence)return;
      if(!prev && members.size>=MAX_SESSIONS)return;
      if(p.here===null) {
        trace('presence-departed',{who});
        // Keep the sequence tombstone briefly so a delayed movement cannot resurrect it.
        members.set(mk,{who,generation:p.generation,path:p.path,sequence:p.sequence,at:now(),gone:true});notify();return;
      }
      const h=p.here;
      if(h?.stamp!==undefined && !Number.isFinite(h.stamp))return;
      if(!h || !h.spot || h.spot.place!==0 || !num(h.spot.x) || !num(h.spot.y) || h.spot.x>1024 || h.spot.y>736 || !['up','down','left','right'].includes(h.spot.dir) || !num(h.rev) || (h.host!==null && !ship(h.host)))return;
      if(!prev)trace('presence-first',{who,generation:p.generation});
      members.set(mk,{who,...h,generation:p.generation,path:p.path,sequence:p.sequence,at:now()});notify();return;
    }
    const current=routes.get(key);
    const r=current?.generation===p.generation?current:previousRoutes.get(key+'/'+p.generation);
    if(!r || !routeLive(r) || p.generation!==r.generation || !prefix(r.path,p.path) || p.path[r.path.length]!==from || !r.children.includes(from) || graph()[from]!=='mutual' || p.path.length-1>r.max)return;
    emit(r.path.at(-2),p);
  }
  /* Our snapshot to everyone who may see us. Leased, on every beat; targeted,
   * only when something in it changed -- the app calls this. */
  function publish() {
    if(!active)return;
    for(const r of routes.values())if(routeLive(r))reply(r,snapshot());
  }
  function tick() {
    if(!active)return;
    const t=now();
    for(const [k,r] of previousRoutes)if(t-r.at>=LEASE_MS)previousRoutes.delete(k);
    for(const [k,r] of routes)if(!routeLive(r)){trace('movement-route-expired',{who:r.origin,gap:t-r.at,generation:r.generation});routes.delete(k);}
    for(const [k,m] of members) {
      if(m.gone ? t-m.at<LEASE_MS : memberLive(m))continue;
      if(!m.gone)trace('presence-expired',{who:m.who,gap:t-m.at});
      members.delete(k);
    }
    for(const [k,n] of neighbors)if(t-n.at>=LEASE_MS*2)neighbors.delete(k);
    notify();
    if(!targeted) {
      if(t-queryAt>=DISCOVER_MS){discover();publish();}
      return;
    }
    if(sweeping() && t-lastSweep>=SWEEP_MS){lastSweep=t;discover(true);return;}
    /* Answering pals who are not on the list are renewed the leased way, and
     * only them: a fresh discovery to those pals, and our snapshot to their
     * routes. Listed pals hear nothing. */
    if(t-renewAt>=UNLISTED_RENEW_MS) {
      renewAt=t;
      const hops=new Set();
      for(const m of members.values())if(!m.gone && !present.has(m.path[1]) && direct().includes(m.path[1]))hops.add(m.path[1]);
      if(hops.size) {
        generation++;queryAt=t;queries.set(generation,t);
        queryTo([...hops].slice(0,MAX_FANOUT));
      }
      for(const r of routes.values())if(!present.has(r.path.at(-2)) && routeLive(r))reply(r,snapshot());
    }
  }
  function stop() {
    if(!active)return;
    for(const r of routes.values())reply(r,null);
    /* Only pals we actually asked have a route for us to drop. */
    for(const to of targeted ? [...asked] : direct().slice(0,MAX_FANOUT))emit(to,{kind:'cancel',origin:our,viewer:session,generation});
    active=false;routes.clear();previousRoutes.clear();queries.clear();members.clear();neighbors.clear();asked.clear();notify();
  }
  /* Publish only to the named viewers. Positions travel over the movement relay
   * now; this is the slow fallback for viewers who are not on it yet, so the
   * full movement stream never returns to Eyre and Ames. */
  function publishTo(ships) {
    if(!active)return;
    for(const r of routes.values())if(routeLive(r) && ships.has(r.origin))reply(r,snapshot());
  }
  /* Who may see us: the origin of every live route. A route exists only because
   * that viewer's own pals/dial discovery reached us, so this is exactly the
   * authorised audience -- the set the movement relay addresses positions to. */
  function viewers() {
    const out=new Set();
    for(const r of routes.values())if(routeLive(r) && r.origin!==our && !blocked(r.origin))out.add(r.origin);
    return out;
  }
  return {receive,publish,publishTo,viewers,tick,update,stop,present:setPresent,
    /* `force` after a lost connection: anything sent meanwhile may be gone. */
    start(force=false){
      greeting++;
      if(active){if(!targeted || force || now()-queryAt>=RESTART_MS){discover();publish();}return;}
      active=true;startedAt=now();lastSweep=-Infinity;renewAt=now();signature='';update();
    },
    // A closed session is retained only as an anti-replay tombstone.
    peers:()=>new Map([...list()].filter(([,m])=>!m.gone)),
  };
}
