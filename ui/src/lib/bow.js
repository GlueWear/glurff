/* One action packet, local flight/strike check, and a victim-owned response.
 * No damage/health/score state is saved or sent. Scene is part of each action. */
export const ARROW_SPEED = 12, ARROW_RANGE = 10, FIRE_COOLDOWN = 600;
export const SLING_SPEED = 10, SLING_RANGE = 7;
/* Reach is measured from the normal collision centre in map tiles. A longer
 * weapon can touch farther away; all use the SAME victim hitbox, whatever art
 * or premade body the player wears. */
export const MELEE_REACH = Object.freeze({
  axe: 1.2, dagger: .9, sword: 1.2, flail: 1.35, whip: 1.6,
  pitchfork: 1.65, spear: 1.75, longsword: 1.5, waraxe: 1.4,
});
export const VECTORS = {up:[0,-1], down:[0,1], left:[-1,0], right:[1,0]};
const keyOf = (ship,id) => ship+'/'+id;
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
  p.x>=0 && p.y>=0 && p.x<=1024 && p.y<=1024;
export function segmentHits(a,b,p,halfWidth=.25,halfHeight=.25) {
  let lo=0, hi=1;
  for (const [axis,half] of [['x',halfWidth],['y',halfHeight]]) {
    const d=b[axis]-a[axis], start=a[axis];
    if (!d) { if (Math.abs(start-p[axis])>half) return false; continue; }
    let near=(p[axis]-half-start)/d, far=(p[axis]+half-start)/d;
    if (near>far) [near,far]=[far,near];
    lo=Math.max(lo,near); hi=Math.min(hi,far);
    if(lo>hi)return false;
  }
  return true;
}
export function createBow({our, self, visible, blocked=()=>false, send, solid,
  hitBox=()=>({x:.25,y:.25}), now=Date.now, id=()=>crypto.randomUUID(),
  onShot=()=>{}, onHit=()=>{}}) {
  const shots=new Map(), seen=new Map(), lastReceived=new Map();
  let fired=-Infinity;
  const strikeHitsSelf = s => {
    const p=self();
    if (!p || p.locked || p.scene!==s.scene || s.who===our) return false;
    const [vx,vy]=VECTORS[s.dir], reach=MELEE_REACH[s.weapon];
    const end={x:s.from.x+vx*reach,y:s.from.y+vy*reach};
    const half=hitBox(s.scene), width=Math.max(.38,half.x), height=Math.max(.38,half.y);
    if (!segmentHits(s.from,end,p,width,height)) return false;
    // A swing stops at the first wall. Test only as far as the victim's near
    // edge; a wall BEHIND the victim must not eat an otherwise valid strike.
    const along=(p.x-s.from.x)*vx+(p.y-s.from.y)*vy;
    const near=Math.max(0,Math.min(reach,along-(vx ? width : height)));
    for (let step=1/32;step<=near+1e-9;step+=1/32)
      if (solid(s.from.x+vx*step,s.from.y+vy*step,s.scene)) return false;
    const event={kind:'strike-hit',id:s.id,by:s.who};
    if (!receive(our,event)) return false;
    Promise.resolve(send(event)).catch(()=>{});
    return true;
  };
  function receive(who,e) {
    if (who!==our && (!visible(who) || blocked(who)))return false;
    if (!e || typeof e.id!=='string' || !e.id.length || e.id.length>100)return false;
    const t=now();
    if (e.kind==='arrow' || e.kind==='strike') {
      if (!validPoint(e.from) || !Object.hasOwn(VECTORS,e.dir) || !['main','vatican'].includes(e.scene) ||
          !Number.isFinite(e.t0) || Math.abs(t-e.t0)>5000)return false;
      const weapon=e.kind==='strike' ? e.weapon : (e.weapon ?? 'bow');
      if (e.kind==='strike' ? !Object.hasOwn(MELEE_REACH,weapon) : !['bow','slingshot'].includes(weapon))return false;
      const key=keyOf(who,e.id);
      if(seen.has(key) || t-(lastReceived.get(who)??-Infinity)<FIRE_COOLDOWN-100)return false;
      lastReceived.set(who,t);
      const shot={...e,weapon,from:{...e.from},who,key,distance:0,
        /* Unsynchronised ship clocks cannot leave arrows hanging in midair. */
        began:t-Math.max(0,Math.min(350,t-e.t0)),point:{...e.from},stopped:false,hits:new Set()};
      seen.set(key,{shot,until:t+10000});
      if(e.kind==='arrow') shots.set(key,shot);
      onShot(who,shot);
      if(e.kind==='strike') strikeHitsSelf(shot);
      return true;
    }
    if((e.kind==='arrow-hit'||e.kind==='strike-hit') && typeof e.by==='string' && who!==e.by) {
      const record=seen.get(keyOf(e.by,e.id));
      if(!record || record.until<t || record.shot.hits.has(who) || blocked(e.by) ||
          e.kind!==(record.shot.kind==='strike'?'strike-hit':'arrow-hit'))return false;
      record.shot.hits.add(who); record.shot.stopped=true;
      onHit(who,record.shot); return true;
    }
    return false;
  }
  function fire() {
    const p=self(), t=now();
    const weapon=p?.weapon ?? (p?.bow ? 'bow' : null);
    if(!p || !weapon || p.locked || t-fired<FIRE_COOLDOWN ||
       !Object.hasOwn(VECTORS,p.dir) ||
       !['bow','slingshot'].includes(weapon) && !Object.hasOwn(MELEE_REACH,weapon))return false;
    const event={kind:Object.hasOwn(MELEE_REACH,weapon)?'strike':'arrow',
      id:id(),from:{x:p.x,y:p.y},dir:p.dir,scene:p.scene,t0:t};
    if(weapon!=='bow')event.weapon=weapon;
    if(!receive(our,event))return false;
    fired=t; Promise.resolve(send(event)).catch(()=>{}); return true;
  }
  function tick() {
    const t=now(), p=self();
    for(const [key,r] of seen)if(r.until<t)seen.delete(key);
    for(const [who,at] of lastReceived)if(t-at>10000)lastReceived.delete(who);
    for(const [key,s] of shots) {
      if(s.stopped || (s.who!==our && (!visible(s.who)||blocked(s.who)))) {shots.delete(key);continue;}
      const speed=s.weapon==='slingshot'?SLING_SPEED:ARROW_SPEED;
      const range=s.weapon==='slingshot'?SLING_RANGE:ARROW_RANGE;
      const target=Math.min(range,Math.max(0,(t-s.began)/1000*speed));
      const [vx,vy]=VECTORS[s.dir];
      // Small swept steps stop at thin walls and cannot skip a victim at low FPS.
      while(s.distance<target) {
        const next=Math.min(target,s.distance+1/32);
        const point={x:s.from.x+vx*next,y:s.from.y+vy*next};
        if(solid(point.x,point.y,s.scene)){s.stopped=true;break;}
        if(p && !self()?.locked && s.who!==our && p.scene===s.scene) {
          const half=hitBox(s.scene);
          if(segmentHits(s.point,point,p,half.x,half.y)) {
            const event={kind:'arrow-hit',id:s.id,by:s.who};
            receive(our,event); Promise.resolve(send(event)).catch(()=>{}); break;
          }
        }
        s.point=point; s.distance=next;
      }
      if(s.stopped || s.distance>=range)shots.delete(key);
    }
    return [...shots.values()];
  }
  return {fire,receive,tick,clear(){shots.clear();seen.clear();lastReceived.clear();}, shots};
}
