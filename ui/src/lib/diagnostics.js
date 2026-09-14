// Bounded, opt-in-readable history. Never accept arbitrary payloads or grants.
const events=[];
const gaps={};
const fields=new Set(['who','place','host','attempt','reason','gap','sequence','generation','count','hidden','phase','channel','state','kind','context','op','detail']);
const pick=details=>{const out={};for(const [k,v] of Object.entries(details))if(fields.has(k) && ['string','number','boolean'].includes(typeof v))out[k]=typeof v==='string'?v.slice(0,128):v;return out;};

/* Startup as a timeline. Each milestone keeps only its FIRST occurrence, in
 * milliseconds since the page began loading, so a capture from a bad start
 * shows exactly which step never happened. Bounded. */
const startup={};
const origin=typeof performance!=='undefined' && performance.timeOrigin ? performance.timeOrigin : Date.now();
export function milestone(name, details={}) {
  if(name in startup || Object.keys(startup).length>=96)return;
  startup[name]={ms:Math.round(Date.now()-origin),...pick(details)};
  saveSoon();
}
/* Kept across a reload. A problem is usually noticed after it has happened, and
 * reloading to look used to erase the evidence; the page before this one comes
 * back as `previous`. This browser's storage only -- nothing is sent anywhere. */
const STORE='glurff-diagnostics';
let previous=null, saveTimer=null;
try {previous=JSON.parse(globalThis.localStorage?.getItem(STORE)??'null');} catch {previous=null;}
function saveDiagnostics() {
  clearTimeout(saveTimer);saveTimer=null;
  try {globalThis.localStorage?.setItem(STORE,JSON.stringify({savedAt:Date.now(),startup,events,receiveGaps:gaps}));} catch {}
}
function saveSoon() {
  if(saveTimer!==null || !globalThis.localStorage)return;
  saveTimer=setTimeout(saveDiagnostics,2000);saveTimer?.unref?.();
}
if(typeof window!=='undefined')window.addEventListener?.('pagehide',saveDiagnostics);
const MILESTONES={
  'presence-discover':()=>'discovery-sent',
  'presence-first':d=>'answered:'+d.who,
  'movement-session':d=>'movement-'+(d.reason||'session'),
  'movement-relay':d=>d.state==='live'?'relay-live':null,
  'call-request':()=>'call-requested',
  'call-state':d=>d.phase==='connected'?'call-connected':null,
  'call-request-dropped':d=>'call-dropped:'+d.reason,
  'call-refused':d=>'call-refused:'+d.reason,
};
/* Too frequent to keep as rows; the milestone records the first one. */
const QUIET=new Set(['presence-discover']);

const QUOTA_DETAILS=new Set(['room','room-host','room-global','ticket','ticket-room','ticket-host','command']);
const CALL_OPS=new Set(['ensure-room','issue-access','renew-access','renew-room','end-room','room-status','evict-participant']);
/* The feed covers every app using local Noltbook calls. Only Glurff's own
 * place/participant/attempt contexts belong in this bounded history. Keep the
 * original context to join it to the failure even if the facts arrive apart.
 * Movement contexts additionally carry the host ship. No grants are accepted. */
export function recordCallQuota(p, reporter) {
  if(!p || typeof p.context!=='string' || p.context.length>128 ||
    !QUOTA_DETAILS.has(p.detail) || !CALL_OPS.has(p.op))return false;
  const match=/^([0-9][0-9.]*)\/(~[a-z-]+)\/([0-9][0-9.]*)(?:\/(~[a-z-]+))?$/.exec(p.context);
  if(!match)return false;
  const [,rawPlace,who,rawAttempt,host]=match;
  const place=Number(rawPlace.replace(/\./g,'')),attempt=Number(rawAttempt.replace(/\./g,''));
  if(!Number.isSafeInteger(place) || place<=0 || !Number.isSafeInteger(attempt) || attempt<0 ||
    (p.who!=null && p.who!==who))return false;
  diagnostic('call-quota',{context:p.context,who,place,attempt,host:host??reporter,op:p.op,detail:p.detail});
  return true;
}

export function diagnostic(type, details={}) {
  const named=MILESTONES[type]?.(details);
  if(named)milestone(named,details);
  if(QUIET.has(type))return;
  if(type==='presence-received') {
    const old=gaps[details.who]??{count:0,max:0};
    gaps[details.who]={count:old.count+1,max:Math.max(old.max,details.gap),last:details.gap,at:Date.now()};
    if(Object.keys(gaps).length>128)delete gaps[Object.keys(gaps)[0]];
    // Movement no longer rides presence, so a ten-second beat is the expected
    // gap. Only a gap well past that is worth a row in the bounded history.
    if(details.gap<15000)return;
  }
  events.push({at:Date.now(),type,...pick(details)});if(events.length>300)events.shift();
  saveSoon();
}

/* Urbit traffic by operation class. "presence-event" covers discovery, call
 * control, world events and positions alike; lumping them together is what made
 * the original capture impossible to read. Rates are per rolling ten seconds;
 * pending is work started and not yet settled. No payloads are recorded. */
const traffic={};
export function trafficStart(kind) {
  const t=traffic[kind]??={sent:0,pending:0,maxPending:0,slow:0,failed:0,lastMs:0,maxMs:0,recent:[]};
  const at=Date.now();
  t.sent++;t.pending++;t.maxPending=Math.max(t.maxPending,t.pending);
  t.recent.push(at);
  while(t.recent.length && at-t.recent[0]>10000)t.recent.shift();
  if(t.recent.length>4000)t.recent.splice(0,t.recent.length-4000);
  let done=false;
  return (ok=true)=>{
    if(done)return;done=true;
    const gap=Date.now()-at;
    t.pending--;t.lastMs=gap;t.maxMs=Math.max(t.maxMs,gap);
    if(gap>=1000)t.slow++;
    if(!ok)t.failed++;
  };
}
function trafficSummary() {
  const now=Date.now(),out={};
  for(const [kind,t] of Object.entries(traffic)) {
    while(t.recent.length && now-t.recent[0]>10000)t.recent.shift();
    out[kind]={sent:t.sent,per10s:t.recent.length,pending:t.pending,maxPending:t.maxPending,slow:t.slow,failed:t.failed,lastMs:t.lastMs,maxMs:t.maxMs};
  }
  return out;
}
let movementStats=()=>null;
export const setMovementDiagnostics=fn=>{movementStats=fn;};
if(typeof window!=='undefined')window.glurffDiagnostics=()=>({capturedAt:Date.now(),hidden:globalThis.document?.hidden,previous,startup:structuredClone(startup),events:events.map(e=>({...e})),receiveGaps:structuredClone(gaps),connection:window.api?.connectionDiagnostics?.(),traffic:trafficSummary(),chat:window.glurffChatDiagnostics?.(),movement:(()=>{try{return movementStats();}catch{return null;}})()});

/* Everything above as text on the clipboard, for sending to whoever is fixing a
 * problem. Falls back to the old copy command where the clipboard API is not
 * allowed. */
export async function copyDiagnostics() {
  const text=JSON.stringify(window.glurffDiagnostics(),null,1);
  try {await navigator.clipboard.writeText(text);return true;} catch {}
  try {
    const area=document.createElement('textarea');
    area.value=text;area.style.position='fixed';area.style.opacity='0';
    document.body.appendChild(area);area.select();
    const ok=document.execCommand('copy');area.remove();return ok;
  } catch {return false;}
}
