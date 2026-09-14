// Noltbook keeps gossip refreshes local and enforces a 90-second minimum TTL.
export const ACTIVE_TTL = 120;
export const ACTIVE_REFRESH_MS = 30000;
// Browser-only bookkeeping keeps its existing cadence; it sends no ship poke.
export const TAB_REFRESH_MS = 5000;

// Local browser tab leases prevent one closing tab clearing another's badge.
// Failure to access storage falls back to the server's expiry.
export function tabLease(storage, prefix, id, now = Date.now) {
  const key=prefix+id;
  let tracked=false;
  return {
    touch() {try {storage.setItem(key,String(now()));tracked=true;} catch {}},
    close() {
      if(!tracked)return false;
      try {
        storage.removeItem(key);
        for(let i=storage.length-1;i>=0;i--) {
          const k=storage.key(i);
          if(!k?.startsWith(prefix))continue;
          if(now()-Number(storage.getItem(k))<60000)return false;
        }
        return true;
      } catch {return false;}
    },
  };
}
