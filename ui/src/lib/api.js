/* The Eyre channel.
 *
 * One connection serves both agents: %glurff for the world, %noltbook for
 * everything social. The page is same-origin on the ship, so it can poke and
 * subscribe to any agent -- which is how Glurff uses Noltbook as a backend
 * without the %noltbook desk being modified at all.
 */
import Urbit from '@urbit/http-api';
import { maintainConnection } from 'lib/connection';

export let api = null;
export let our = null;
let exiting = false;
let exitPokes = [];

export function initApi() {
  if (!window.ship) throw new Error('No ship session. Sign in and reload Glurff.');
  our = '~' + String(window.ship).replace(/^~/, '');
  api = new Urbit('', '', 'glurff');
  api.ship = window.ship;
  api.verbose = false;
  /* The bundled http-api registers delete without binding its receiver, so a
   * page unload throws unless we bind it ourselves. */
  window.removeEventListener('beforeunload', api.delete);
  const connection = maintainConnection(api, {onRestore:()=>window.dispatchEvent(new Event('glurff-restored'))});
  // Send departure pokes and channel deletion in order in ONE unload beacon.
  window.addEventListener('pagehide', () => {
    exiting = true;
    window.dispatchEvent(new Event('glurff-exit'));
    connection.stop();
    const messages=[];
    let bytes=0;
    for(const p of exitPokes) {
      const n=new TextEncoder().encode(JSON.stringify(p)).length;
      if(bytes+n>60000)break; // Browser keepalive limit; leases cover the remainder.
      messages.push(p);bytes+=n;
    }
    messages.push({action:'delete'});
    const body=JSON.stringify(messages);
    if(!navigator.sendBeacon(api.channelUrl,body))fetch(api.channelUrl,{method:'PUT',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
    exitPokes=[];
  });
  window.addEventListener('pageshow', e => { if(e.persisted)location.reload(); });
  api.onOpen = () => window.dispatchEvent(new Event('glurff-reconnect'));
  window.api = api;   // debug handle for the headless harness
  return api;
}

/* Give the channel back without closing the page: a tab that has been
 * superseded by a newer one must stop holding subscriptions open. */
export const closeChannel = () => { try { api?.delete?.(); } catch {} };

export const poke = (app, mark, json) => {
  if(exiting) {
    exitPokes.push({id:api.getEventId(),action:'poke',ship:api.ship,app,mark,json});
    return Promise.resolve();
  }
  return api.poke({ app, mark, json, onError: (e) => console.error(`${app}/${mark}`, e) });
};

/* Facts arrive as single-key objects: {'peer-here': {...}}. Handlers get
 * (name, payload) so callers switch without unwrapping. */
export function subscribe(app, path, onFact, label = path) {
  return api.subscribe({
    app,
    path,
    event: (fact) => {
      if (!fact || typeof fact !== 'object') return;
      for (const name of Object.keys(fact)) onFact(name, fact[name]);
    },
    err: (e) => console.error(`subscription ${app}${label} failed`, e),
    quit: () => console.warn(`subscription ${app}${label} quit`),
  });
}
