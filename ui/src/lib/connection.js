/* Keep subscription handles stable across Eyre channel replacement. Never
 * replay pokes: a lost response does not mean a post wasn't saved. */
import { diagnostic } from './diagnostics.js';
export function maintainConnection(client, { onRestore = () => {} } = {}) {
  const rawSubscribe = client.subscribe.bind(client);
  const rawUnsubscribe = client.unsubscribe.bind(client);
  const rawSend = client.sendJSONtoChannel.bind(client);
  const subscriptions = new Map();
  const requests = new Set(), pokes = new Set();
  const operation = m => [m.action,m.app,m.mark,m.json?.op ?? m.json?.action].filter(s=>typeof s==='string').join('/').slice(0,128);
  let next = 0, epoch = 0, stopped = false, rebuilding = false, timer = null;
  let retry = 0;
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
    epoch++;
    requests.clear();pokes.clear();
    // Release promises for ambiguous in-flight writes; callers show failure.
    for (const p of [...client.outstandingPokes.values()]) p.onError({err:'Connection interrupted; delivery is unknown'});
    client.reset();
    try {
      for (const record of subscriptions.values()) {
        clearTimeout(record.timer);record.timer=null;
        if (stopped) break;
        await attach(record);
      }
      retry = 0;
      rebuilding = false;
      diagnostic('channel-restored',{channel:client.uid,count:subscriptions.size});
      if (!stopped) onRestore();
    } catch {
      rebuilding = false;
      recover();
    } finally { rebuilding = false; }
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
  let batch=null, batchChars=0;
  function flushBatch() {
    const items=batch;batch=null;batchChars=0;
    if(!items?.length)return;
    let sent;
    try {sent=client.sendJSONtoChannel(...items.map(i=>i.message));}
    catch(e){sent=Promise.reject(e);}
    Promise.resolve(sent).then(
      ()=>{for(const i of items)i.sent();},
      e=>{for(const i of items){client.outstandingPokes.delete(i.message.id);i.fail(e);}},
    );
  }
  const batchable=client.outstandingPokes instanceof Map && typeof client.getEventId==='function';
  function batchedPoke({app,mark,json,ship=client.ship,onSuccess=()=>{},onError=()=>{}}) {
    const message={id:client.getEventId(),action:'poke',ship,app,mark,json};
    let sentOk,sentFail;
    const sent=new Promise((resolve,reject)=>{sentOk=resolve;sentFail=reject;});
    const acked=new Promise((resolve,reject)=>{
      client.outstandingPokes.set(message.id,{
        onSuccess:()=>{onSuccess();resolve(message.id);},
        onError:event=>{onError(event);reject(event?.err ?? event);},
      });
    });
    const chars=JSON.stringify(message).length;
    if(batch && (batch.length>=MAX_BATCH || batchChars+chars>MAX_BATCH_CHARS))flushBatch();
    if(!batch){batch=[];queueMicrotask(flushBatch);}
    batch.push({message,sent:sentOk,fail:sentFail});batchChars+=chars;
    return Promise.all([sent,acked]).then(([,id])=>id);
  }
  if(client.poke) {
    const rawPoke=client.poke.bind(client);
    const send=batchable?batchedPoke:rawPoke;
    client.poke=async args=>{
      const request={generation:epoch,at:Date.now(),channel:client.uid,reason:operation({action:'poke',...args})};
      pokes.add(request);
      try {return await send(args);}
      finally {
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
    ![...requests, ...pokes].some(r=>r.generation === epoch && Date.now()-r.at >= 5000);
  client.connectionDiagnostics = () => ({
    generation:epoch, rebuilding:rebuilding || !!timer, backgroundReady:client.backgroundReady(),
    requests:[...requests].filter(r=>r.generation === epoch).slice(0,100).map(r=>({operation:r.reason,age:Date.now()-r.at})),
    pokes:[...pokes].filter(r=>r.generation === epoch).slice(0,100).map(r=>({operation:r.reason,age:Date.now()-r.at})),
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
