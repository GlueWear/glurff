export class MotionBuffer {
  constructor(position, at, stamp=at) {
    this.offset=at-stamp;this.samples=[{...position,t:at}];
  }
  push(position, at, stamp=at) {
    const last=this.samples.at(-1);
    this.offset=Math.min(this.offset,at-stamp);
    const t=Math.max(last.t+.001,stamp+this.offset);
    // Long gaps are discontinuities; avoid replaying a long journey on return.
    if(t-last.t>2000 || Math.hypot(position.x-last.x,position.y-last.y)>12) {
      this.samples=[{...position,t}];return;
    }
    this.samples.push({...position,t});if(this.samples.length>16)this.samples.shift();
  }
  at(now) {
    const t=now-250,s=this.samples;
    while(s.length>2 && s[1].t<=t)s.shift();
    if(t<=s[0].t)return s[0];
    for(let i=1;i<s.length;i++)if(s[i].t>=t) {
      const a=s[i-1],b=s[i],f=(t-a.t)/(b.t-a.t);
      return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,dir:b.dir};
    }
    return s.at(-1); // No unbounded prediction through walls or after a stop.
  }
}

// At most one in-flight movement plus its newest replacement per route.
export function latestSender(send) {
  const pending=new Map();let closed=false;
  async function drain(key,item) {
    while(item.next && !closed) {
      const value=item.next;item.next=null;
      try {await send(...value);}catch{}
    }
    pending.delete(key);
  }
  return {
    put(key,...args) {
      if(closed)return;
      const existing=pending.get(key);
      if(existing){existing.next=args;return;}
      if(pending.size>=256)return;
      const item={next:args};pending.set(key,item);void drain(key,item);
    },
    cancel(key){const item=pending.get(key);if(item)item.next=null;},
    close(){closed=true;for(const item of pending.values())item.next=null;},
  };
}
