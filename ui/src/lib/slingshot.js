export const SHOT_RANGE=8, SHOT_COOLDOWN=1500, STUN_MS=1000;
export function validShot(event, origin) {
  const point=p=>p && Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<64&&p.y>=0&&p.y<46;
  return event?.kind==='shot' && typeof event.id==='string' && event.id.length<=80 && point(event.from)&&point(event.to) && origin && Math.hypot(event.from.x-origin.x,event.from.y-origin.y)<=2 && Math.hypot(event.from.x-event.to.x,event.from.y-event.to.y)<=SHOT_RANGE+0.01;
}
export function aimShot(from,to,solid) {
 const dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy),length=Math.min(d,SHOT_RANGE);
 let end={...from};
 for(let t=.1;t<=length+.001;t+=.1){const p={x:from.x+dx/(d||1)*t,y:from.y+dy/(d||1)*t};if(solid(p.x,p.y))break;end=p;}
 return end;
}
