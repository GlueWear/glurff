/* Keep subscription handles stable across Eyre channel replacement. Never
 * replay pokes: a lost response does not mean a post wasn't saved. */
import { diagnostic } from './diagnostics.js';
/* A poke whose PUT went through but whose ack never arrives. Eyre normally
 * answers within a second; thirty is far past slow. The poke is NOT replayed --
 * a lost ack does not mean it was not delivered -- it is settled as unknown, so
 * callers that allow one request at a time are not held hostage by it. */
export const ACK_TIMEOUT_MS = 30000;
/* Call control cannot wait thirty seconds: a newer call request would queue
 * behind a stalled one that long. These ask for a much shorter wait, and a
 * short wait running out is NOT counted as the channel failing -- a busy ship
 * can be slow to take a poke without anything being broken. */
export const CONTROL_ACK_MS = 6000;
/* Two unanswered acks in this long means the channel, not the poke, is broken. */
const ACK_STALL_WINDOW_MS = 60000;
/* Restore order after a rebuild: what calls and movement need first. */
export const watchPriority = (args) => {
  if (Number.isFinite(args?.priority)) return args.priority;
  if (args?.path === '/call-access') return 3;
  if (args?.app === 'glurff' && args?.path === '/world') return 3;
  if (args?.app === 'noltbook' && args?.path === '/notes') return 2;
  return 1;
};
/* THE CONTROL LANE. Calls and movement share one Eyre channel with chat,
 * profiles and presence. These are the pokes a call or a walk cannot wait
 * behind: credentials and call operations, call signalling between ships,
 * departures, and movement access. They go out at once in their own PUT;
 * everything else is batched and may hold at most MAX_BULK_PUTS connections.
 * A browser allows six per host and the event stream holds one, so bulk
 * traffic can no longer fill every slot a call needs. */
const NOLTBOOK_CALL = new Set(['start-call', 'join-call', 'renew-call-access', 'leave-call', 'call-heartbeat']);
const GLURFF_CONTROL = new Set(['claim', 'release', 'knock', 'seat', 'lease', 'unlease', 'session',
  'admits', 'call-knock', 'lease-door', 'lease-ask']);
export const controlPoke = ({ app, mark, json } = {}) => {
  if (app === 'glurff' && mark === 'glurff-room') return true;
  if (app === 'glurff' && mark === 'glurff-action') {
    if (GLURFF_CONTROL.has(json?.op)) return true;
    if (json?.op === 'presence-event' && typeof json.body === 'string' && json.body.length < 4096) {
      try {
        const e = JSON.parse(json.body);
        return (typeof e?.kind === 'string' && e.kind.startsWith('call-')) || (e?.kind === 'state' && e.here === null);
      } catch { return false; }
    }
    return false;
  }
  return app === 'noltbook' && mark === 'noltbook-action' && NOLTBOOK_CALL.has(json?.action);
};
export const MAX_BULK_PUTS = 2;
/* A bulk PUT that has not come back in this long gives its slot up: one hung
 * request must not become the lane's ceiling. */
const BULK_SLOT_MS = 10000;
export function maintainConnection(client, { onRestore = () => {} } = {}) {
  const rawSubscribe = client.subscribe.bind(client);
  const rawUnsubscribe = client.unsubscribe.bind(client);
  const rawSend = client.sendJSONtoChannel.bind(client);
  const subscriptions = new Map();
  const requests = new Set(), pokes = new Set();
  const operation = m => [m.action,m.app,m.mark,m.json?.op ?? m.json?.action].filter(s=>typeof s==='string').join('/').slice(0,128);
  let next = 0, epoch = 0, stopped = false, rebuilding = false, timer = null;
  let retry = 0;
  let ackMisses = [];               //  ms of recent unanswered acks, this epoch
  let bulkInFlight = 0;
  const bulkWaiting = [];           //  bulk batches waiting for a slot
  function restoreWatch(record) {
    if(stopped || !subscriptions.has(record.id) || record.timer)return;
    record.timer=setTimeout(async()=>{
      record.timer=null;
      if(stopped || !subscriptions.has(record.id) || rebuilding || timer)return;
      try {if(await attach(record))onRestore();}
      catch {restoreWatch(record);}
    },1000);
  }
  let acknowledging = null;
  client.ack = async eventId => {
    if (stopped || acknowledging?.generation === epoch) return;
    const generation = epoch;
    const token = acknowledging = {generation, at:Date.now()};
    try {
      await client.sendJSONtoChannel({action:'ack','event-id':eventId});
      if (epoch === generation) client.lastAcknowledgedEventId = Math.max(client.lastAcknowledgedEventId, eventId);
    } catch { if(epoch === generation)recover(); }
    finally { if(acknowledging === token)acknowledging = null; }
  };
  function recover() {
    if (stopped || timer || rebuilding) return;
    timer = setTimeout(rebuild, Math.min(8000, 500 * 2 ** retry++));
  }
  async function attach(record) {
    const generation = epoch;
    const attempt = record.attempt = (record.attempt ?? 0) + 1;
    record.wire = null;
    const wire = await rawSubscribe({ ...record.args,
      event: (...args) => {
        if (!stopped && epoch === generation && record.attempt===attempt && subscriptions.has(record.id)) record.args.event?.(...args);
      },
      quit: (...args) => {
        if (epoch !== generation || record.attempt!==attempt || !subscriptions.has(record.id)) return;
        record.args.quit?.(...args);
        diagnostic('watch-quit',{channel:client.uid,reason:record.args.app+'/'+record.args.path});
        record.wire=null;
        restoreWatch(record);
      },
      err: (...args) => {
        if (!stopped && epoch === generation && record.attempt===attempt && subscriptions.has(record.id)) record.args.err?.(...args);
      },
    });
    if (stopped || epoch !== generation || record.attempt !== attempt) return false;
    if (!subscriptions.has(record.id)) { await rawUnsubscribe(wire); return false; }
    record.wire = wire;
    record.args.onRestored?.();
    return true;
  }
  async function rebuild() {
    timer = null;
    if (stopped) return;
    rebuilding = true;
    diagnostic('channel-rebuild',{channel:client.uid,count:subscriptions.size});
    const generation = ++epoch;
    requests.clear();pokes.clear();
    /* Bulk batches still waiting for a slot belong to the old channel. They
     * were never sent; say so, rather than sending them on the new one after
     * their callers have been told delivery is unknown. */
    bulkInFlight=0;
    for(const items of bulkWaiting.splice(0))for(const i of items){client.outstandingPokes.delete(i.message.id);i.fail(new Error('Connection interrupted; not sent'));}
    // Release promises for ambiguous in-flight writes; callers show failure.
    for (const p of [...client.outstandingPokes.values()]) p.onError({err:'Connection interrupted; delivery is unknown'});
    client.reset();
    ackMisses = [];
    /* INDEPENDENTLY, and call-critical first. This used to attach every watch
     * in turn inside one try: the first one that failed -- often an optional
     * one -- abandoned the rest, so a broken per-note watch could keep the
     * call-access and world watches from ever coming back. Each now succeeds
     * or retries on its own, and the ones calls depend on go first. */
    const order = [...subscriptions.values()]
      .sort((a, b) => watchPriority(b.args) - watchPriority(a.args) || a.id - b.id);
    const failed = [];
    for (const record of order) {
      clearTimeout(record.timer);record.timer=null;
      if (stopped) break;
      try { await attach(record); }
      catch { failed.push(record); }
      if (epoch !== generation) break;
    }
    rebuilding = false;
    if (stopped || epoch !== generation) return;
    /* Nothing came back: the channel, not a watch, is what is broken. Back off
     * and replace it again rather than hammering every watch once a second. */
    if (failed.length && failed.length === subscriptions.size) {
      diagnostic('channel-restore-failed',{channel:client.uid,count:failed.length});
      recover();
      return;
    }
    retry = 0;
    for (const record of failed) restoreWatch(record);
    diagnostic('channel-restored',{channel:client.uid,count:subscriptions.size,failed:failed.length});
    onRestore();
  }
  client.sendJSONtoChannel = async (...messages) => {
    if (stopped) throw new Error('Connection closed');
    if ((timer || rebuilding) && messages.some(m=>m.action==='poke'))
      throw new Error('Reconnecting; please try again shortly');
    // A slow request is not evidence of a dead channel. Only actual transport
    // failure or terminal SSE failure replaces it.
    const generation = epoch, at = Date.now(), channel = client.uid;
    const reason = messages.map(operation).join(',').slice(0,128);
    const request = {generation,at,channel,reason};requests.add(request);
    try { return await rawSend(...messages); }
    catch (e) {
      diagnostic('channel-request-failed',{channel,reason,gap:Date.now()-at,generation});
      if(epoch === generation)recover();
      throw e;
    } finally {
      requests.delete(request);
      if(Date.now()-at >= 1000)diagnostic('channel-request-slow',{channel,reason,gap:Date.now()-at,generation});
    }
  };
  /* Pokes made in the same instant share ONE channel PUT.
   *
   * The ship is served over plain HTTP/1.1, so a browser allows it six
   * connections, one of them held by the event stream. One PUT per poke meant a
   * presence fan-out or a burst of history fetches filled every connection, and
   * ACKs, discovery and call control queued behind them for seconds. Eyre's
   * channel PUT already accepts a list of actions -- the unload beacon relies
   * on it -- so a burst now costs one request.
   *
   * Each poke keeps its own event id and settles on its own ack, exactly as the
   * library does it: registered in outstandingPokes, resolved when Eyre reports
   * that id. If the shared PUT fails, every poke in it fails, as a lone poke
   * would have. Flushed on a microtask, which background tabs do not throttle. */
  const MAX_BATCH=32, MAX_BATCH_CHARS=200000;
  let batch=null, batchChars=0, urgent=null;
  function put(items,bulk) {
    const generation=epoch;
    let slot=null,freed=false;
    const free=()=>{if(freed)return;freed=true;clearTimeout(slot);
      if(generation===epoch){bulkInFlight=Math.max(0,bulkInFlight-1);drainBulk();}};
    if(bulk){bulkInFlight++;slot=setTimeout(free,BULK_SLOT_MS);slot?.unref?.();}
    let sent;
    try {sent=client.sendJSONtoChannel(...items.map(i=>i.message));}
    catch(e){sent=Promise.reject(e);}
    Promise.resolve(sent).then(
      ()=>{for(const i of items)i.sent();},
      e=>{for(const i of items){client.outstandingPokes.delete(i.message.id);i.fail(e);}},
    ).finally(()=>{if(bulk)free();});
  }
  function drainBulk() {
    while(bulkInFlight<MAX_BULK_PUTS && bulkWaiting.length)put(bulkWaiting.shift(),true);
  }
  function flushBatch() {
    const items=batch;batch=null;batchChars=0;
    if(!items?.length)return;
    if(bulkInFlight>=MAX_BULK_PUTS){bulkWaiting.push(items);return;}
    put(items,true);
  }
  function flushUrgent() {
    const items=urgent;urgent=null;
    if(items?.length)put(items,false);
  }
  const batchable=client.outstandingPokes instanceof Map && typeof client.getEventId==='function';
  function batchedPoke({app,mark,json,ship=client.ship,onSuccess=()=>{},onError=()=>{},ackTimeout=ACK_TIMEOUT_MS}) {
    const message={id:client.getEventId(),action:'poke',ship,app,mark,json};
    let sentOk,sentFail;
    const sent=new Promise((resolve,reject)=>{sentOk=resolve;sentFail=reject;});
    let noAck=null;
    const acked=new Promise((resolve,reject)=>{
      client.outstandingPokes.set(message.id,{
        onSuccess:()=>{clearTimeout(noAck);onSuccess();resolve(message.id);},
        onError:event=>{clearTimeout(noAck);onError(event);reject(event?.err ?? event);},
      });
      /* Started once the PUT has gone: an ack cannot be late for a request
       * that has not been sent yet. */
      sent.then(()=>{
        if(!client.outstandingPokes.has(message.id))return;   //  answered with the PUT
        noAck=setTimeout(()=>{
          if(!client.outstandingPokes.has(message.id))return;
          client.outstandingPokes.delete(message.id);
          const err=new Error('No acknowledgement; delivery is unknown');err.noAck=true;err.short=ackTimeout<ACK_TIMEOUT_MS;
          onError({err:err.message});reject(err);
        },ackTimeout);
        noAck?.unref?.();
      },()=>{});
    });
    const item={message,sent:sentOk,fail:sentFail};
    if(controlPoke(message)){
      if(!urgent){urgent=[];queueMicrotask(flushUrgent);}
      urgent.push(item);
    } else {
      const chars=JSON.stringify(message).length;
      if(batch && (batch.length>=MAX_BATCH || batchChars+chars>MAX_BATCH_CHARS))flushBatch();
      if(!batch){batch=[];queueMicrotask(flushBatch);}
      batch.push(item);batchChars+=chars;
    }
    return Promise.all([sent,acked]).then(([,id])=>id);
  }
  if(client.poke) {
    const rawPoke=client.poke.bind(client);
    const send=batchable?batchedPoke:rawPoke;
    client.poke=async args=>{
      const request={generation:epoch,at:Date.now(),channel:client.uid,reason:operation({action:'poke',...args}),
        control:controlPoke(args)};
      pokes.add(request);
      try {
        /* The unbatched path has no hook for the ack, so bound it here. */
        if(batchable)return await send(args);
        let t;
        const wait=args?.ackTimeout??ACK_TIMEOUT_MS;
        return await Promise.race([send(args),new Promise((_,reject)=>{t=setTimeout(()=>{
          const err=new Error('No acknowledgement; delivery is unknown');err.noAck=true;err.short=wait<ACK_TIMEOUT_MS;reject(err);
        },wait);t?.unref?.();})]).finally(()=>clearTimeout(t));
      } catch(e) {
        if(e?.noAck && !e.short && request.generation===epoch){
          const now=Date.now();
          ackMisses=ackMisses.filter(at=>now-at<ACK_STALL_WINDOW_MS);ackMisses.push(now);
          diagnostic('channel-ack-timeout',{channel:request.channel,reason:request.reason,generation:request.generation,count:ackMisses.length});
          /* One lost ack is a lost ack. Two in a minute is a channel that has
           * stopped answering, and only replacing it will fix that. */
          if(ackMisses.length>=2)recover();
        }
        throw e;
      } finally {
        pokes.delete(request);
        if(Date.now()-request.at >= 1000)diagnostic('channel-poke-slow',{
          channel:request.channel,reason:request.reason,gap:Date.now()-request.at,generation:request.generation,
        });
      }
    };
  }
  // Pause background history while an HTTP write or event ACK is stalled.
  // Slowness alone still never deletes the channel or retries a user's post.
  client.backgroundReady = () => !stopped && !timer && !rebuilding &&
    !(acknowledging?.generation === epoch && Date.now()-acknowledging.at >= 5000) &&
    ![...requests, ...pokes].some(r=>r.generation === epoch && Date.now()-r.at >= 5000) &&
    /* Background history waits while call control is slow to leave. */
    ![...pokes].some(r=>r.control && r.generation === epoch && Date.now()-r.at >= 1000);
  client.connectionDiagnostics = () => ({
    generation:epoch, rebuilding:rebuilding || !!timer, backgroundReady:client.backgroundReady(),
    requests:[...requests].filter(r=>r.generation === epoch).slice(0,100).map(r=>({operation:r.reason,age:Date.now()-r.at})),
    pokes:[...pokes].filter(r=>r.generation === epoch).slice(0,100).map(r=>({operation:r.reason,age:Date.now()-r.at,control:!!r.control})),
    bulk:{inFlight:bulkInFlight,waiting:bulkWaiting.length},
  });
  client.subscribe = async args => {
    const record = {id:++next,args,wire:null};
    subscriptions.set(record.id,record);
    if (!rebuilding && !timer) {
      const generation=epoch;
      try { await attach(record); } catch { if(epoch === generation)recover(); }
    }
    return record.id;
  };
  client.unsubscribe = async id => {
    const record = subscriptions.get(id);
    if (!record) return;
    subscriptions.delete(id);
    clearTimeout(record.timer);
    if (record.wire != null && !rebuilding && !timer) await rawUnsubscribe(record.wire);
  };
  client.onError = recover;
  // Acknowledge low-volume streams too. The library otherwise waits 21 events.
  const ackTimer = setInterval(() => {
    if (!stopped && !rebuilding && !timer && client.lastHeardEventId > client.lastAcknowledgedEventId)
      client.ack(client.lastHeardEventId).catch(recover);
  }, 1000);
  return { recover, stop() { stopped=true;requests.clear();pokes.clear();clearTimeout(timer);clearInterval(ackTimer);for(const r of subscriptions.values())clearTimeout(r.timer);client.abort.abort(); } };
}
