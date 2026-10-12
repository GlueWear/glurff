/* One action packet, local flight/strike check, and a victim-owned response.
 * No damage/health/score state is saved or sent. Scene is part of each action. */
export const FIRE_COOLDOWN = 600;
/* EVERY SHOT ALIKE (2026-10-12): an arrow, a stone and a spell fly at one
 * speed, a little faster than arrows did, and keep going until they hit a
 * wall (off the map counts as one). The range only stops one that somehow
 * finds none. A spell is what a ready-made caster sends; older clients drop
 * it rather than draw an arrow. */
export const SHOT_SPEED = 14, SHOT_RANGE = 100;
export const ARROW_SPEED = SHOT_SPEED, ARROW_RANGE = SHOT_RANGE;
export const SLING_SPEED = SHOT_SPEED, SLING_RANGE = SHOT_RANGE;
export const SPELL_SPEED = SHOT_SPEED, SPELL_RANGE = SHOT_RANGE;
/* Reach is measured from the normal collision centre in map tiles. A longer
 * weapon can touch farther away; all use the SAME victim hitbox, whatever art
 * or premade body the player wears. */
export const MELEE_REACH = Object.freeze({
  axe: 1.2, dagger: .9, sword: 1.2, flail: 1.35, whip: 1.6,
  pitchfork: 1.65, spear: 1.75, longsword: 1.5, waraxe: 1.4,
});
export const VECTORS = {up:[0,-1], down:[0,1], left:[-1,0], right:[1,0]};
/* FREE AIM (2026-09-30). A projectile can fly at any angle: its shot carries
 * `aim`, a unit vector, AND `dir`, the nearest of the four -- which is how a
 * character faces, how a swing goes, and all an older client understands. */
export const PROJECTILES = ['bow','slingshot','spell'];
export const nearestDir = (vx,vy) => Math.abs(vx)>Math.abs(vy) ? (vx<0?'left':'right') : (vy<0?'up':'down');
const validAim = a => Array.isArray(a) && a.length===2 && a.every(Number.isFinite) &&
  Math.abs(Math.hypot(a[0],a[1])-1)<0.05;
/* The way from `p` to `target`, as a unit vector; null when there is none. */
export function aimAt(p,target) {
  if(!p || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y))return null;
  const dx=target.x-p.x, dy=target.y-p.y, d=Math.hypot(dx,dy);
  return d<1e-6 ? null : [dx/d,dy/d];
}
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
  hitBox=()=>({x:.25,y:.25}), shotBox=null, now=Date.now, id=()=>crypto.randomUUID(),
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
      /* A free-aimed shot must say which way, properly; a swing never does. */
      if (e.aim!==undefined && (e.kind!=='arrow' || !validAim(e.aim)))return false;
      const weapon=e.kind==='strike' ? e.weapon : (e.weapon ?? 'bow');
      if (e.kind==='strike' ? !Object.hasOwn(MELEE_REACH,weapon) : !PROJECTILES.includes(weapon))return false;
      /* RELEASE: a shot leaves the hand on the frame of the attack that lets it
       * go (see world/parts releaseMs), up to 1.5s after the attack begins.
       * Absent from older clients' shots, which leave at once. */
      if (e.release!==undefined && (!Number.isFinite(e.release) || e.release<0 || e.release>1500))return false;
      const key=keyOf(who,e.id);
      if(seen.has(key) || t-(lastReceived.get(who)??-Infinity)<FIRE_COOLDOWN-100)return false;
      lastReceived.set(who,t);
      const [ax,ay]=e.aim ?? VECTORS[e.dir], len=Math.hypot(ax,ay);
      const shot={...e,weapon,from:{...e.from},who,key,distance:0,vec:[ax/len,ay/len],
        /* Unsynchronised ship clocks cannot leave arrows hanging in midair. */
        began:t-Math.max(0,Math.min(350,t-e.t0))+(e.kind==='arrow'?e.release??0:0),point:{...e.from},stopped:false,hits:new Set()};
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
  /* Attack: the way we face, or -- given `target`, a point in the world --
   * toward it: a projectile exactly, a swing the nearest of the four ways. */
  function fire(target=null) {
    const p=self(), t=now();
    const weapon=p?.weapon ?? (p?.bow ? 'bow' : null);
    if(!p || !weapon || p.locked || t-fired<FIRE_COOLDOWN ||
       !Object.hasOwn(VECTORS,p.dir) ||
       !PROJECTILES.includes(weapon) && !Object.hasOwn(MELEE_REACH,weapon))return false;
    const aim=aimAt(p,target);
    const dir=aim ? nearestDir(aim[0],aim[1]) : p.dir;
    const event={kind:Object.hasOwn(MELEE_REACH,weapon)?'strike':'arrow',
      id:id(),from:{x:p.x,y:p.y},dir,scene:p.scene,t0:t};
    if(aim && event.kind==='arrow')event.aim=aim.map(v=>Math.round(v*1000)/1000);
    if(event.kind==='arrow' && p.release>0)event.release=Math.min(1500,Math.round(p.release));
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
      const speed=SHOT_SPEED, range=SHOT_RANGE;
      const target=Math.min(range,Math.max(0,(t-s.began)/1000*speed));
      const [vx,vy]=s.vec ?? VECTORS[s.dir];
      // Small swept steps stop at thin walls and cannot skip a victim at low FPS.
      while(s.distance<target) {
        const next=Math.min(target,s.distance+1/32);
        const point={x:s.from.x+vx*next,y:s.from.y+vy*next};
        if(solid(point.x,point.y,s.scene)){s.stopped=true;break;}
        if(p && !self()?.locked && s.who!==our && p.scene===s.scene) {
          /* What a shot can hit is the victim's body as drawn (`shotBox`:
           * half sizes, and how far above the feet its middle is in a shot's
           * terms), else the square at the feet a swing uses. */
          const box=shotBox ? shotBox(s.scene) : {...hitBox(s.scene),up:0};
          if(segmentHits(s.point,point,{x:p.x,y:p.y-box.up},box.x,box.y)) {
            const event={kind:'arrow-hit',id:s.id,by:s.who};
            receive(our,event); Promise.resolve(send(event)).catch(()=>{}); break;
          }
        }
        s.point=point; s.distance=next;
      }
      if(s.stopped || s.distance>=range)shots.delete(key);
    }
    /* Not yet released: still in the hand, so not drawn. */
    return [...shots.values()].filter((s)=>t>=s.began);
  }
  return {fire,receive,tick,clear(){shots.clear();seen.clear();lastReceived.clear();}, shots};
}
